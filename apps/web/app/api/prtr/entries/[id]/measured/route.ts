import { emptyTableState, parseTableState, prtrMeasuredSchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_MEASURED_COLUMNS } from "@/lib/list-columns";
import { MEASURED_INCLUDE, resolveMeasuredSubstance, toMeasuredDto } from "@/lib/prtr-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_STATE = emptyTableState([{ column: "officialNumber", direction: "asc" }]);

/** GET /api/prtr/entries/[id]/measured — 実測値の一覧（絞り込み・並べ替え・ページ送り） */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  const state = parseTableState(
    new URL(req.url).searchParams,
    PRTR_MEASURED_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { AND: [buildWhere(PRTR_MEASURED_COLUMNS, state.filters)], entryId: id };
  const [items, total] = await Promise.all([
    prisma.prtrMeasured.findMany({
      where,
      orderBy: buildOrderBy(PRTR_MEASURED_COLUMNS, state.sort, { id: "asc" }),
      include: MEASURED_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.prtrMeasured.count({ where }),
  ]);
  return Response.json({
    items: items.map(toMeasuredDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/prtr/entries/[id]/measured — 実測値を 1 件足す（S22）。
 * 物質コードで物質を当て、化管法の第一種指定化学物質に変換して持つ。
 * 同じ第一種指定化学物質が既にあれば断る（行末の鉛筆で直してもらう）
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrMeasuredSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const resolved = await resolveMeasuredSubstance(v.substanceCode);
  if (!resolved.ok) {
    const message =
      resolved.reason === "substance_not_found"
        ? m.prtr.measured.substanceNotFound(v.substanceCode)
        : m.prtr.measured.notPrtrSubstance(v.substanceCode);
    return jsonError(400, "validation_error", message, {
      fieldErrors: { substanceCode: [message] },
    });
  }
  const dup = await prisma.prtrMeasured.findUnique({
    where: {
      entryId_statutorySubstanceId: {
        entryId: id,
        statutorySubstanceId: resolved.statutorySubstanceId,
      },
    },
  });
  if (dup) return jsonError(409, "duplicate", m.prtr.measured.alreadyThere);

  const row = await prisma.prtrMeasured.create({
    data: {
      entryId: id,
      statutorySubstanceId: resolved.statutorySubstanceId,
      substanceId: resolved.substance.id,
      measuredKg: new Prisma.Decimal(v.measuredKg),
      source: "MANUAL",
      updatedBy: actor.user.id,
    },
    include: MEASURED_INCLUDE,
  });
  await writeAudit({
    entity: "prtr_measured",
    entityId: row.id,
    action: "create",
    actorId: actor.user.id,
    diff: { substance: resolved.substance.code, measuredKg: v.measuredKg },
  });
  return Response.json({ item: toMeasuredDto(row) }, { status: 201 });
}
