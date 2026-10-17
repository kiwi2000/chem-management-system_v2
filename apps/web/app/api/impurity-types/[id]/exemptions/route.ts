import {
  IMPURITY_NONE,
  impurityExemptionSchema,
  impurityExemptionSubstanceSchema,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  parseEditStamp,
  rowStamp,
  STAMP_SELECT,
  StaleError,
  staleFromRow,
  stampWhere,
} from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { recomputeScoresForType } from "@/lib/score-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 除外を変えたことを、種別の行の更新日時に残す。
 * 「要再計算」の印はこの日時を見る（`lib/rejudge-job.ts` の premisesChangedAt）。
 * あわせて、その種別の物質のスコアを計算し直す（除外した区分の点は数えない）
 */
async function touchType(typeId: string, userId: string) {
  await prisma.impurityType.update({
    where: { id: typeId },
    data: { updatedBy: userId, updatedAt: new Date() },
  });
  await recomputeScoresForType(typeId).catch((e) => console.error("score recompute failed:", e));
}

/**
 * 不純物種別ごとの除外の設定（S21）。
 *
 * GET  … その種別の、除外している区分の id と、法文物質名の上書き
 * PUT  … 区分の付け外し（法律の行でまとめて押せるよう、複数まとめて受ける）
 * POST … 法文物質名の上書き（`excluded: null` は「区分に従う」＝行を消す）
 *
 * **付け外しは 1 回ごとに保存する。**保存ボタンを押し忘れて設定が残らない、を防ぐ
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const [categories, substances] = await Promise.all([
    prisma.impurityExemption.findMany({
      where: { typeId: id, excluded: true },
      select: { categoryId: true },
    }),
    prisma.impurityExemptionSubstance.findMany({
      where: { typeId: id },
      // 画面が区分ごとに「例外 N 件」を出すので、区分もたどって返す
      select: {
        statutorySubstanceId: true,
        excluded: true,
        statutorySubstance: { select: { regulationClass: { select: { categoryId: true } } } },
      },
    }),
  ]);

  return Response.json({
    categoryIds: categories.map((c) => c.categoryId),
    substances: substances.map((s) => ({
      statutorySubstanceId: s.statutorySubstanceId,
      categoryId: s.statutorySubstance.regulationClass.categoryId,
      excluded: s.excluded,
    })),
  });
}

/**
 * PUT — 区分の付け外し。
 *
 * 楽観的ロックの印は**種別の行**のもの（除外の設定は種別の一部。付け外しのたびに種別の行を触るので、
 * ほかの人が先に付け外していれば印が食い違う）。応答の `stamp` で画面の種別の印を差し替える
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const type = await prisma.impurityType.findFirst({ where: { id, deletedAt: null } });
  if (!type) return jsonError(404, "not_found", m.errors.notFound);
  // 0「不純物ではない」は除外の設定を持たない
  if (id === IMPURITY_NONE) return jsonError(409, "builtin", m.impurityTypes.noneHasNoExemption);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = impurityExemptionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { categoryIds, excluded } = parsed.data;
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  /*
    先頭の門番で種別の行を書き換える（食い違っていれば何もしない）。
    **外したときも判定の前提が変わる。**外す操作は行を消すので、
    除外の表の更新日時だけを見ていると気づけない（「要再計算」が出ない）。
    種別の行を必ず触って、前提が変わったことを残す（門番がその役も兼ねる）
  */
  try {
    await prisma.$transaction(async (tx) => {
      const gate = await tx.impurityType.updateMany({
        where: { id, ...stampWhere(lock) },
        data: { updatedBy: actor.user.id, updatedAt: new Date() },
      });
      if (gate.count === 0) throw new StaleError();
      if (excluded) {
        const now = new Date();
        for (const categoryId of categoryIds) {
          await tx.impurityExemption.upsert({
            where: { typeId_categoryId: { typeId: id, categoryId } },
            create: {
              typeId: id,
              categoryId,
              excluded: true,
              createdBy: actor.user.id,
              updatedBy: actor.user.id,
            },
            update: { excluded: true, updatedAt: now, updatedBy: actor.user.id },
          });
        }
      } else {
        // 外すときは行ごと消す（「除外しない」は行が無い状態）
        await tx.impurityExemption.deleteMany({
          where: { typeId: id, categoryId: { in: categoryIds } },
        });
      }
    });
  } catch (err) {
    if (err instanceof StaleError) {
      return staleFromRow(
        m,
        await prisma.impurityType.findUnique({ where: { id }, select: STAMP_SELECT }),
      );
    }
    throw err;
  }
  // その種別の物質のスコアを計算し直す（除外した区分の点は数えない）
  await recomputeScoresForType(id).catch((e) => console.error("score recompute failed:", e));

  await writeAudit({
    entity: "impurity_exemptions",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { categories: categoryIds.length, excluded },
  });
  const after = await prisma.impurityType.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ updated: categoryIds.length, stamp: rowStamp(after) });
}

/** POST — 法文物質名ごとの上書き */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const type = await prisma.impurityType.findFirst({ where: { id, deletedAt: null } });
  if (!type) return jsonError(404, "not_found", m.errors.notFound);
  if (id === IMPURITY_NONE) return jsonError(409, "builtin", m.impurityTypes.noneHasNoExemption);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = impurityExemptionSubstanceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { statutorySubstanceId, excluded } = parsed.data;

  if (excluded === null) {
    // 「区分に従う」＝上書きを消す
    await prisma.impurityExemptionSubstance.deleteMany({
      where: { typeId: id, statutorySubstanceId },
    });
  } else {
    await prisma.impurityExemptionSubstance.upsert({
      where: {
        typeId_statutorySubstanceId: { typeId: id, statutorySubstanceId },
      },
      create: {
        typeId: id,
        statutorySubstanceId,
        excluded,
        createdBy: actor.user.id,
        updatedBy: actor.user.id,
      },
      update: { excluded, updatedAt: new Date(), updatedBy: actor.user.id },
    });
  }

  await touchType(id, actor.user.id);

  await writeAudit({
    entity: "impurity_exemption_substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { statutorySubstanceId, excluded },
  });
  return Response.json({ statutorySubstanceId, excluded });
}
