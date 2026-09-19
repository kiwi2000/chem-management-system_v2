import {
  IMPURITY_NONE,
  impurityExemptionSchema,
  impurityExemptionSubstanceSchema,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { recomputeScoresForPattern } from "@/lib/score-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 除外を変えたことを、種別の行の更新日時に残す。
 * 「要再計算」の印はこの日時を見る（`lib/rejudge-job.ts` の premisesChangedAt）。
 * あわせて、その種別の物質のスコアを計算し直す（除外した区分の点は数えない）
 */
async function touchPattern(patternId: string, userId: string) {
  await prisma.impurityPattern.update({
    where: { id: patternId },
    data: { updatedBy: userId, updatedAt: new Date() },
  });
  await recomputeScoresForPattern(patternId).catch((e) =>
    console.error("score recompute failed:", e),
  );
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
      where: { patternId: id, excluded: true },
      select: { categoryId: true },
    }),
    prisma.impurityExemptionSubstance.findMany({
      where: { patternId: id },
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

/** PUT — 区分の付け外し */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const pattern = await prisma.impurityPattern.findFirst({ where: { id, deletedAt: null } });
  if (!pattern) return jsonError(404, "not_found", m.errors.notFound);
  // 0「不純物ではない」は除外の設定を持たない
  if (id === IMPURITY_NONE) return jsonError(409, "builtin", m.impurityPatterns.noneHasNoExemption);

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

  if (excluded) {
    const now = new Date();
    await prisma.$transaction(
      categoryIds.map((categoryId) =>
        prisma.impurityExemption.upsert({
          where: { patternId_categoryId: { patternId: id, categoryId } },
          create: {
            patternId: id,
            categoryId,
            excluded: true,
            createdBy: actor.user.id,
            updatedBy: actor.user.id,
          },
          update: { excluded: true, updatedAt: now, updatedBy: actor.user.id },
        }),
      ),
    );
  } else {
    // 外すときは行ごと消す（「除外しない」は行が無い状態）
    await prisma.impurityExemption.deleteMany({
      where: { patternId: id, categoryId: { in: categoryIds } },
    });
  }

  /*
    **外したときも判定の前提が変わる。**外す操作は行を消すので、
    除外の表の更新日時だけを見ていると気づけない（「要再計算」が出ない）。
    種別の行を必ず触って、前提が変わったことを残す
  */
  await touchPattern(id, actor.user.id);

  await writeAudit({
    entity: "impurity_exemptions",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { categories: categoryIds.length, excluded },
  });
  return Response.json({ updated: categoryIds.length });
}

/** POST — 法文物質名ごとの上書き */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const pattern = await prisma.impurityPattern.findFirst({ where: { id, deletedAt: null } });
  if (!pattern) return jsonError(404, "not_found", m.errors.notFound);
  if (id === IMPURITY_NONE) return jsonError(409, "builtin", m.impurityPatterns.noneHasNoExemption);

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
      where: { patternId: id, statutorySubstanceId },
    });
  } else {
    await prisma.impurityExemptionSubstance.upsert({
      where: {
        patternId_statutorySubstanceId: { patternId: id, statutorySubstanceId },
      },
      create: {
        patternId: id,
        statutorySubstanceId,
        excluded,
        createdBy: actor.user.id,
        updatedBy: actor.user.id,
      },
      update: { excluded, updatedAt: new Date(), updatedBy: actor.user.id },
    });
  }

  await touchPattern(id, actor.user.id);

  await writeAudit({
    entity: "impurity_exemption_substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { statutorySubstanceId, excluded },
  });
  return Response.json({ statutorySubstanceId, excluded });
}
