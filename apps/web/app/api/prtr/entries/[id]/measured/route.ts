import { emptyTableState, parseTableState, prtrMeasuredSchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_MEASURED_COLUMNS } from "@/lib/list-columns";
import {
  isConfirmed,
  MEASURED_INCLUDE,
  resolveMeasuredSubstance,
  toMeasuredDto,
  updaterNames,
} from "@/lib/prtr-service";
import { prtrMeasuredDelete } from "@/lib/prtr-delete";
import { runStampedDelete } from "@/lib/stamped-delete";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_STATE = emptyTableState([{ column: "officialNumber", direction: "asc" }]);

/** GET /api/prtr/entries/[id]/measured — 実測値の区画（物質ごとの取扱量・排出量）の一覧 */
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
  const names = await updaterNames(items);
  return Response.json({
    items: items.map((x) => toMeasuredDto(x, names)),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/prtr/entries/[id]/measured — 実測値の区画に物質を 1 件足す（S22）。
 * 物質コードで物質を当て、化管法の第一種指定化学物質に変換して持つ。
 * 同じ第一種指定化学物質が既にあれば断る（行末の鉛筆で直してもらう）。確定中は断る
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
  if (await isConfirmed(id)) return jsonError(409, "confirmed", m.prtr.locked);

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
  const clash = async () => {
    const dup = await prisma.prtrMeasured.findUnique({
      where: {
        entryId_statutorySubstanceId: {
          entryId: id,
          statutorySubstanceId: resolved.statutorySubstanceId,
        },
      },
    });
    return dup ? jsonError(409, "duplicate", m.prtr.measured.alreadyThere) : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じ物質をほぼ同時に足されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const row = await guardUnique(m, clash, () =>
    prisma.prtrMeasured.create({
      data: {
        entryId: id,
        statutorySubstanceId: resolved.statutorySubstanceId,
        substanceId: resolved.substance.id,
        handledKg: v.handledKg == null ? null : new Prisma.Decimal(v.handledKg),
        measuredKg: new Prisma.Decimal(v.measuredKg),
        source: "MANUAL",
        updatedBy: actor.user.id,
      },
      include: MEASURED_INCLUDE,
    }),
  );
  if (row instanceof Response) return row;
  await writeAudit({
    entity: "prtr_measured",
    entityId: row.id,
    action: "create",
    actorId: actor.user.id,
    diff: {
      substance: resolved.substance.code,
      handledKg: v.handledKg ?? null,
      measuredKg: v.measuredKg,
    },
  });
  return Response.json({ item: toMeasuredDto(row, await updaterNames([row])) }, { status: 201 });
}

/**
 * DELETE /api/prtr/entries/[id]/measured — 実測値の行をまとめて消す（本文 `{ items: [{ id, stamp }], force? }`。lib/stamped-delete.ts）。
 * 届出の組織を受け持つ人だけ。確定中は断る
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;
  if (await isConfirmed(id)) return jsonError(409, "confirmed", m.prtr.locked);
  return runStampedDelete(req, m, prtrMeasuredDelete(actor, id));
}
