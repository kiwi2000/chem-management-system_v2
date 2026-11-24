import { metalFactorSchema, normalizeCas } from "@chem/shared";
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
import { findSubstancesByCas } from "@/lib/metal-factor-service";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/metal-factors/[id] — CAS・金属元素・係数の変更 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.metalConversionFactor.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = metalFactorSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const casNormalized = normalizeCas(v.casNumber);
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  // キー（CAS × 金属元素）を変えるときは、その組が空いているか確かめる
  const keyChanged =
    casNormalized !== existing.casNormalized || v.metalElement !== existing.metalElement;
  let clashId: string | null = null;
  const clash = async () => {
    if (!keyChanged) return null;
    const live = await prisma.metalConversionFactor.findFirst({
      where: { casNormalized, metalElement: v.metalElement, deletedAt: null, id: { not: id } },
    });
    return live
      ? jsonError(
          409,
          "duplicate_metal_factor",
          m.errors.duplicateMetalFactor(casNormalized, v.metalElement),
        )
      : null;
  };
  if (keyChanged) {
    const clash = await prisma.metalConversionFactor.findUnique({
      where: { casNormalized_metalElement: { casNormalized, metalElement: v.metalElement } },
    });
    if (clash && clash.deletedAt === null) {
      return jsonError(
        409,
        "duplicate_metal_factor",
        m.errors.duplicateMetalFactor(casNormalized, v.metalElement),
      );
    }
    // 論理削除済みの行が居座っている場合は、先に片付けてキーを空ける
    if (clash) clashId = clash.id;
  }

  /*
    居座っている行の片付けとこの行の書き換えを 1 つのトランザクションに入れ、
    先頭の門番で食い違いを見る（食い違っていたら片付けもしない）
  */
  try {
    // 同じ組へほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
    const saved = await guardUnique(m, clash, () =>
      prisma.$transaction(async (tx) => {
        const gate = await tx.metalConversionFactor.updateMany({
          where: { id, ...stampWhere(lock) },
          data: { updatedBy: actor.user.id },
        });
        if (gate.count === 0) throw new StaleError();
        if (clashId) await tx.metalConversionFactor.delete({ where: { id: clashId } });
        await tx.metalConversionFactor.update({
          where: { id },
          data: {
            casNumber: casNormalized,
            casNormalized,
            metalElement: v.metalElement,
            ratioPct: v.ratioPct,
            updatedBy: actor.user.id,
          },
        });
      }),
    );
    if (saved instanceof Response) return saved;
  } catch (err) {
    if (err instanceof StaleError) {
      return staleFromRow(
        m,
        await prisma.metalConversionFactor.findUnique({ where: { id }, select: STAMP_SELECT }),
      );
    }
    throw err;
  }

  const warnings: string[] = [];
  const matched = await findSubstancesByCas([casNormalized]);
  if ((matched.get(casNormalized) ?? []).length === 0) {
    warnings.push(m.metalFactors.warnUnknownCas);
  }

  await writeAudit({
    entity: "metal_conversion_factors",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { casNumber: casNormalized, metalElement: v.metalElement, ratioPct: v.ratioPct },
  });
  const after = await prisma.metalConversionFactor.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, warnings, stamp: rowStamp(after) });
}
