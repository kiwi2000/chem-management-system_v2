import { propertyDefSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toPropertyDefDto } from "@/lib/property-def-service";

export const dynamic = "force-dynamic";

/** GET /api/admin/substance-property-defs — 管理画面用（使わない項目も含む） */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const items = await prisma.substancePropertyDef.findMany({
    orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
    include: { _count: { select: { values: true } } },
  });
  return Response.json({ items: items.map(toPropertyDefDto) });
}

/** POST /api/admin/substance-property-defs — 項目の追加 */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = propertyDefSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  if (await prisma.substancePropertyDef.findUnique({ where: { key: v.key } })) {
    return jsonError(409, "duplicate_key", m.errors.duplicateKey(v.key));
  }

  const created = await prisma.substancePropertyDef.create({
    data: {
      key: v.key,
      labelJa: v.labelJa,
      labelEn: v.labelEn ?? null,
      dataType: v.dataType,
      defaultUnit: v.defaultUnit ?? null,
      displayOrder: v.displayOrder,
      activeFlag: v.activeFlag,
    },
  });

  await writeAudit({
    entity: "substance_property_defs",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { key: v.key, labelJa: v.labelJa, dataType: v.dataType },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
