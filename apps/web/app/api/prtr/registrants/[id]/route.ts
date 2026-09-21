import { prtrRegistrantSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toPrtrRegistrantDto } from "@/lib/prtr-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** [id] は組織（会社）の id。届出者の項目は組織に 1 つ添える */
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/prtr/registrants/[id] — 1 社ぶん（PRTR 管理者の編集画面用） */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const o = await prisma.organisation.findFirst({
    where: { id, kind: "COMPANY", deletedAt: null },
    select: { id: true, code: true, nameJa: true, nameEn: true, prtrRegistrant: true },
  });
  if (!o) return jsonError(404, "not_found", m.errors.notFound);
  const settings = await getAppSettings();
  return Response.json({
    item: toPrtrRegistrantDto(o, settings.prtrDefaultRegistrantOrganisationId),
  });
}

/** PUT /api/prtr/registrants/[id] — 届出者の項目を入れる・直す（PRTR 管理者）。無ければ作る */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ADMIN");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const o = await prisma.organisation.findFirst({
    where: { id, kind: "COMPANY", deletedAt: null },
    select: { id: true },
  });
  if (!o) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrRegistrantSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const data = {
    nameKana: v.nameKana ?? null,
    representName: v.representName ?? null,
    representNameKana: v.representNameKana ?? null,
    agentName: v.agentName ?? null,
    agentNameKana: v.agentNameKana ?? null,
    corporateNumber: v.corporateNumber ?? null,
    lastYearCompanyName: v.lastYearCompanyName ?? null,
    zip: v.zip ?? null,
    prefecture: v.prefecture ?? null,
    city: v.city ?? null,
    town: v.town ?? null,
    prefectureKana: v.prefectureKana ?? null,
    cityKana: v.cityKana ?? null,
    townKana: v.townKana ?? null,
    updatedBy: actor.user.id,
  };
  await prisma.prtrRegistrant.upsert({
    where: { organisationId: id },
    create: { organisationId: id, ...data },
    update: data,
  });
  await writeAudit({
    entity: "prtr_registrants",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { representName: v.representName ?? null, corporateNumber: v.corporateNumber ?? null },
  });
  return Response.json({ id });
}
