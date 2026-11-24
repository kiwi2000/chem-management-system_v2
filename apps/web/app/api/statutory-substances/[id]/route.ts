import { normalizeCode, statutorySubstanceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";
import { CATEGORY_THRESHOLD_SELECT, thresholdOrderError } from "@/lib/law-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/** PUT /api/statutory-substances/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutorySubstance.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = statutorySubstanceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  const cls = await prisma.regulationClass.findFirst({
    where: { id: v.classId, deletedAt: null },
    include: { category: { select: CATEGORY_THRESHOLD_SELECT } },
  });
  if (!cls) return jsonError(404, "not_found", m.errors.notFound);
  const orderError = thresholdOrderError(v, cls.category, m);
  if (orderError) return orderError;

  // 自分自身とは重ならない
  const clash = async () => {
    const other = await prisma.statutorySubstance.findFirst({
      where: { classId: v.classId, codeNormalized, deletedAt: null, id: { not: id } },
    });
    return other
      ? jsonError(409, "duplicate_substance_code", m.statutorySubstances.duplicateCode(v.code))
      : null;
  };
  if (codeNormalized !== existing.codeNormalized || v.classId !== existing.classId) {
    const clashed = await clash();
    if (clashed) return clashed;
  }

  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.statutorySubstance.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        codeNormalized,
        classId: v.classId,
        officialNumber: v.officialNumber ?? null,
        nameOriginal: v.nameOriginal,
        nameLang: v.nameLang,
        nameJa: v.nameJa ?? null,
        nameEn: v.nameEn ?? null,
        thresholdLower: v.thresholdLower,
        lowerBound: v.lowerBound,
        thresholdUpper: v.thresholdUpper,
        upperBound: v.upperBound,
        effectiveFrom: toDate(v.effectiveFrom),
        effectiveTo: toDate(v.effectiveTo),
        displayOrder: v.displayOrder,
        applicableCondition: v.applicableCondition ?? null,
        note: v.note ?? null,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.statutorySubstance.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "statutory_substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal, classId: v.classId },
  });
  const after = await prisma.statutorySubstance.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
