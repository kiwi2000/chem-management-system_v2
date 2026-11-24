import { countrySchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/countries/[id] — コード・地域・名称・並び順の変更 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.country.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = countrySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  const codeNormalized = normalizeCode(v.code);

  const region = await prisma.region.findFirst({ where: { id: v.regionId, deletedAt: null } });
  if (!region) return jsonError(404, "not_found", m.errors.notFound);

  const clash = async () => {
    if (codeNormalized === existing.codeNormalized) return null;
    const other = await prisma.country.findFirst({ where: { codeNormalized, deletedAt: null } });
    return other
      ? jsonError(409, "duplicate_country_code", m.countries.duplicateCode(v.code))
      : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している。
  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.country.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        codeNormalized,
        regionId: v.regionId,
        nameJa: v.nameJa,
        nameEn: v.nameEn ?? null,
        displayOrder: v.displayOrder,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.country.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "countries",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa, regionId: v.regionId },
  });
  const after = await prisma.country.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
