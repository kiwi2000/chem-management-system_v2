import { normalizeCas, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { aggregateComposition } from "@/lib/composition-aggregate";
import { canEditComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { recomputeFrom } from "@/lib/expansion-store";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/products/[id]/composition/pre-reaction — 「反応後の組成入力」を始める（S24）。
 *
 * いまの登録組成を**反応前として写し取って凍結**し、登録組成そのものを以後「反応後」として編集してもらう。
 *
 * 反応後の出発点は、原材料が含まれていれば**原材料展開・CAS 合算の表**（物質ごと。2026-09-29 指示）。
 * 反応で原材料という単位は無くなるので、物質ごとの行から直し始めるほうが自然なため。
 * 展開できなかった原材料（中身が無い・見えない）は、失わないよう原材料の行のまま残す。
 * 原材料が無ければ登録組成はそのまま（写しを取るだけ）。
 *
 * 押せるのは組成を編集できる人。一度押した製品では 409（写しは 1 つ。戻す手段はまだ無い）
 */
export async function POST(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheldEdit);
  }
  if (product.preReactionAt) {
    return jsonError(409, "already_started", m.composition.postReaction.alreadyStarted);
  }

  const lines = await prisma.compositionLine.findMany({
    where: { parentProductId: id },
    orderBy: { displayOrder: "asc" },
  });
  const hasMaterials = lines.some((l) => l.childProductId !== null);

  // 反応後の出発点: 原材料があれば合算の表（物質ごと）、無ければ登録組成のまま
  let next:
    | {
        substanceId: string | null;
        childProductId: string | null;
        contentPct: string | null;
        note: string | null;
      }[]
    | null = null;
  /*
    展開・合算の結果は、原材料の有無にかかわらず写しと一緒に凍結する（product_pre_reaction_expansion_lines）。
    一覧の絞り込み「展開・合算後」が、反応後を入れた製品についても探せるようにするため（判定には使わない）
  */
  const agg = await aggregateComposition(actor, id);
  const codes = [...new Set(agg.rows.map((r) => normalizeCode(r.code)))];
  const substances = await prisma.substance.findMany({
    where: { codeNormalized: { in: codes }, deletedAt: null },
    select: { id: true, codeNormalized: true },
  });
  const idByCode = new Map(substances.map((s) => [s.codeNormalized, s.id]));
  const expansionRows = agg.rows.map((r) => ({
    productId: id,
    casNormalized: r.casNumber ? normalizeCas(r.casNumber) : null,
    substanceId: idByCode.get(normalizeCode(r.code)) ?? null,
    impurityTypeId: r.impurityTypeId,
    totalPct: r.totalPct,
  }));
  if (hasMaterials) {
    next = [];
    for (const r of agg.rows) {
      const substanceId = idByCode.get(normalizeCode(r.code));
      if (!substanceId) continue; // 代表物質が引けない（消された直後など）。要確認に残す
      next.push({ substanceId, childProductId: null, contentPct: r.totalPct, note: r.note });
    }
    // 展開できなかった原材料は、その行のまま残す（数字を失わない）
    if (agg.blocked.length > 0) {
      const blockedCodes = [...new Set(agg.blocked.map((b) => normalizeCode(b.code)))];
      const children = await prisma.product.findMany({
        where: { codeNormalized: { in: blockedCodes }, deletedAt: null },
        select: { id: true, codeNormalized: true },
      });
      const childByCode = new Map(children.map((c) => [c.codeNormalized, c.id]));
      for (const b of agg.blocked) {
        const childProductId = childByCode.get(normalizeCode(b.code));
        if (childProductId)
          next.push({ substanceId: null, childProductId, contentPct: b.pct, note: null });
      }
    }
  }

  const at = new Date();
  await prisma.$transaction([
    prisma.productPreReactionLine.deleteMany({ where: { productId: id } }),
    prisma.productPreReactionLine.createMany({
      data: lines.map((l) => ({
        productId: id,
        substanceId: l.substanceId,
        childProductId: l.childProductId,
        contentPct: l.contentPct,
        note: l.note,
        displayOrder: l.displayOrder,
      })),
    }),
    prisma.productPreReactionExpansionLine.deleteMany({ where: { productId: id } }),
    prisma.productPreReactionExpansionLine.createMany({ data: expansionRows }),
    ...(next
      ? [
          prisma.compositionLine.deleteMany({ where: { parentProductId: id } }),
          prisma.compositionLine.createMany({
            data: next.map((l, i) => ({ ...l, parentProductId: id, displayOrder: i })),
          }),
        ]
      : []),
    prisma.product.update({
      where: { id },
      data: { preReactionAt: at, preReactionBy: actor.user.id, updatedBy: actor.user.id },
    }),
  ]);
  // 登録組成を置き換えたときは展開結果も作り直す（中身は同じはずだが、行の形が変わっている）
  const recomputed = next
    ? await recomputeFrom(id).catch((e: unknown) => {
        console.error("展開結果の作り直しに失敗:", id, e);
        return 0;
      })
    : 0;
  await writeAudit({
    entity: "product_pre_reaction",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: {
      lineCount: lines.length,
      fromAggregate: next !== null,
      postLineCount: next?.length ?? lines.length,
      recomputed,
    },
  });
  return Response.json({
    ok: true,
    lineCount: lines.length,
    fromAggregate: next !== null,
    postLineCount: next?.length ?? lines.length,
    at: at.toISOString(),
  });
}

/**
 * DELETE /api/products/[id]/composition/pre-reaction — 反応前に戻す（反応後の入力の取り消し）。
 *
 * 写しを登録組成へ戻し、写しと印を消す。反応後に入れた内容は残らない（画面で確かめてから呼ぶ）。
 * 配合を直して反応後を作り直すときも、これで戻してから直し、もう一度「反応後の組成入力」を押す。
 * 展開結果は作り直す
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheldEdit);
  }
  if (!product.preReactionAt) return jsonError(404, "not_found", m.errors.notFound);

  const snapshot = await prisma.productPreReactionLine.findMany({
    where: { productId: id },
    orderBy: { displayOrder: "asc" },
  });
  const postCount = await prisma.compositionLine.count({ where: { parentProductId: id } });
  await prisma.$transaction([
    prisma.compositionLine.deleteMany({ where: { parentProductId: id } }),
    prisma.compositionLine.createMany({
      data: snapshot.map((l) => ({
        parentProductId: id,
        substanceId: l.substanceId,
        childProductId: l.childProductId,
        contentPct: l.contentPct,
        note: l.note,
        displayOrder: l.displayOrder,
      })),
    }),
    prisma.productPreReactionLine.deleteMany({ where: { productId: id } }),
    prisma.productPreReactionExpansionLine.deleteMany({ where: { productId: id } }),
    prisma.product.update({
      where: { id },
      data: { preReactionAt: null, preReactionBy: null, updatedBy: actor.user.id },
    }),
  ]);
  const recomputed = await recomputeFrom(id).catch((e: unknown) => {
    console.error("展開結果の作り直しに失敗:", id, e);
    return 0;
  });
  await writeAudit({
    entity: "product_pre_reaction",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { restoredLineCount: snapshot.length, discardedPostLineCount: postCount, recomputed },
  });
  return Response.json({ ok: true, restoredLineCount: snapshot.length });
}
