import { prtrEntrySchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { isConfirmed, loadEntry } from "@/lib/prtr-service";

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
 * PUT /api/prtr/entries — 頭（係数・備考）を入れる・直す。無ければ作る。
 * 方法（実測値・物質収支・排出係数）は数量の行が持つので、ここには無い（2026-09-30）。
 * 画面は係数と備考の両方を毎回送る（片方だけ送ると、もう片方が消える）
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
  // 集計が確定しているあいだは、係数も備考も変えられない（入力は読み取り専用）
  const existing = await prisma.prtrEntry.findUnique({
    where: {
      organisationId_fiscalYear: { organisationId: v.organisationId, fiscalYear: v.fiscalYear },
    },
    select: { id: true },
  });
  if (existing && (await isConfirmed(existing.id))) {
    return jsonError(409, "confirmed", m.prtr.locked);
  }

  const factorPct = v.factorPct ? new Prisma.Decimal(v.factorPct) : null;
  const entry = await prisma.prtrEntry.upsert({
    where: {
      organisationId_fiscalYear: { organisationId: v.organisationId, fiscalYear: v.fiscalYear },
    },
    create: {
      organisationId: v.organisationId,
      fiscalYear: v.fiscalYear,
      factorPct,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    update: { factorPct, note: v.note ?? null, updatedBy: actor.user.id },
  });
  await writeAudit({
    entity: "prtr_entries",
    entityId: entry.id,
    action: "update",
    actorId: actor.user.id,
    diff: { fiscalYear: v.fiscalYear, factorPct: v.factorPct ?? null },
  });
  return Response.json(await loadEntry(v.organisationId, v.fiscalYear));
}
