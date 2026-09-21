import { prtrEntrySchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { loadEntry } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/entries?organisationId=&fiscalYear= — 所属 × 年度の届出データ（S22）。
 * 頭が無ければ entry は null（まだ何も入れていない）。所属していない組織は 404
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const url = new URL(req.url);
  const organisationId = url.searchParams.get("organisationId") ?? "";
  const fiscalYear = Number(url.searchParams.get("fiscalYear"));
  if (!organisationId || !Number.isInteger(fiscalYear)) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  const denied = await requirePrtrOrg(actor, organisationId);
  if (denied) return denied;
  return Response.json(await loadEntry(organisationId, fiscalYear));
}

/**
 * PUT /api/prtr/entries — 頭（方法・係数・備考）を入れる・直す。無ければ作る。
 * 方法を変えても、入れてある数量・実測値はそのまま残す（意味が変わることは画面で確かめる）
 */
export async function PUT(req: Request) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrEntrySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const denied = await requirePrtrOrg(actor, v.organisationId);
  if (denied) return denied;

  const factorPct = v.method === "FACTOR" && v.factorPct ? new Prisma.Decimal(v.factorPct) : null;
  const entry = await prisma.prtrEntry.upsert({
    where: {
      organisationId_fiscalYear: { organisationId: v.organisationId, fiscalYear: v.fiscalYear },
    },
    create: {
      organisationId: v.organisationId,
      fiscalYear: v.fiscalYear,
      method: v.method,
      factorPct,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    update: { method: v.method, factorPct, note: v.note ?? null, updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "prtr_entries",
    entityId: entry.id,
    action: "update",
    actorId: actor.user.id,
    diff: { fiscalYear: v.fiscalYear, method: v.method, factorPct: v.factorPct ?? null },
  });
  return Response.json(await loadEntry(v.organisationId, v.fiscalYear));
}
