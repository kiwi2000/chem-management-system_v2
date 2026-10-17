import { normalizeCode, regionSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/regions/[id] — 名称・くくり・並び順・コードの変更 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.region.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = regionSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  const codeNormalized = normalizeCode(v.code);

  if (codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.region.findFirst({ where: { codeNormalized, deletedAt: null } });
    if (clash) return jsonError(409, "duplicate_region_code", m.regions.duplicateCode(v.code));
  }

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.region.updateMany({
    where: { id, ...stampWhere(lock) },
    data: {
      code: v.code,
      codeNormalized,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      updatedBy: actor.user.id,
    },
  });
  if (hit.count === 0) {
    return staleFromRow(m, await prisma.region.findUnique({ where: { id }, select: STAMP_SELECT }));
  }

  await writeAudit({
    entity: "regions",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  const after = await prisma.region.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/**
 * DELETE /api/regions/[id] — 論理削除。
 * 国や法律から使われているものは消せない（親を失った行ができてしまうため）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.region.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  // 法律は国にぶら下がるので、地域を守るには国の数だけ見ればよい
  const countries = await prisma.country.count({ where: { regionId: id, deletedAt: null } });
  if (countries > 0) return jsonError(409, "referenced", m.regions.inUseByCountries(countries));

  await prisma.region.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      // 一意制約を空けるための退避。原文の code はそのまま残す
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "regions",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameJa: existing.nameJa },
  });
  return Response.json({ ok: true });
}
