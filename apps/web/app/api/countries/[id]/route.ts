import { countrySchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";

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

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.country.findFirst({ where: { codeNormalized, deletedAt: null } });
    if (clash) return jsonError(409, "duplicate_country_code", m.countries.duplicateCode(v.code));
  }

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.country.updateMany({
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
  });
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

/** DELETE /api/countries/[id] — 論理削除（同じコードで登録し直すと復活する） */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.country.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.country.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      // 一意制約を空けるための退避。原文の code はそのまま残す
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "countries",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameJa: existing.nameJa },
  });
  return Response.json({ ok: true });
}
