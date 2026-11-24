import { categoryScoreSchema, normalizeCode, regulationCategorySchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";
import { recomputeScoresForCategory } from "@/lib/score-store";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** 日付だけの入力（YYYY-MM-DD）を、日付列の値（UTC の 0 時）にする */
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/regulation-categories/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationCategory.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = regulationCategorySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  /*
    スコアの範囲はシステム設定で決まる。**画面の作りに関わらずサーバーで確かめる。**
    範囲を狭めた後に、前から入っていた値がそのまま保存されるのを防ぐ
  */
  const { categoryScoreMin, categoryScoreMax } = await getAppSettings();
  const score = categoryScoreSchema(m, {
    min: categoryScoreMin,
    max: categoryScoreMax,
  }).safeParse(v.score);
  if (!score.success) {
    return jsonError(400, "validation_error", m.errors.validation, {
      fieldErrors: { score: score.error.issues.map((i) => i.message) },
      formErrors: [],
    });
  }

  const law = await prisma.law.findFirst({ where: { id: v.lawId, deletedAt: null } });
  if (!law) return jsonError(404, "not_found", m.errors.notFound);

  // 自分自身とは重ならない
  const clash = async () => {
    const other = await prisma.regulationCategory.findFirst({
      where: { lawId: v.lawId, codeNormalized, deletedAt: null, id: { not: id } },
    });
    return other
      ? jsonError(409, "duplicate_category_code", m.regulationCategories.duplicateCode(v.code))
      : null;
  };
  if (codeNormalized !== existing.codeNormalized || v.lawId !== existing.lawId) {
    const clashed = await clash();
    if (clashed) return clashed;
  }

  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.regulationCategory.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        codeNormalized,
        lawId: v.lawId,
        nameOriginal: v.nameOriginal,
        nameLang: v.nameLang,
        nameJa: v.nameJa ?? null,
        nameEn: v.nameEn ?? null,
        thresholdLower: v.thresholdLower,
        lowerBound: v.lowerBound,
        thresholdUpper: v.thresholdUpper,
        upperBound: v.upperBound,
        thresholdBasis: v.thresholdBasis,
        judged: v.judged,
        effectiveFrom: toDate(v.effectiveFrom),
        effectiveTo: toDate(v.effectiveTo),
        score: score.data,
        interactionGroup: v.interactionGroup ?? null,
        rank: v.rank ?? null,
        displayOrder: v.displayOrder,
        note: v.note ?? null,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.regulationCategory.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  /*
    **スコアか「判定に使う」印が変わったら、その区分に当たっている物質を計算し直す。**
    どちらも合計の中身を変えるため。名前だけを直したときは計算しない
  */
  let rescored = 0;
  if (!existing.score.equals(score.data) || existing.judged !== v.judged) {
    rescored = await recomputeScoresForCategory(id);
  }

  await writeAudit({
    entity: "regulation_categories",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, lawId: v.lawId, score: score.data },
  });
  const after = await prisma.regulationCategory.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, rescored, stamp: rowStamp(after) });
}
