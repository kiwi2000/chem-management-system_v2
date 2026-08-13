import { normalizeCas, normalizeCode, substanceSchema } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  SUBSTANCE_INCLUDE,
  childWrites,
  collectWarnings,
  hasDuplicateGazette,
  normalizeInput,
  toListItem,
  validateCas,
  validateProperties,
} from "@/lib/substance-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * GET /api/substances — 一覧。
 * 検索はコード・CAS番号（どちらも正規化値）・名称・備考を横断する。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);

  const where: Prisma.SubstanceWhereInput = { deletedAt: null };
  if (q) {
    where.OR = [
      { codeNormalized: { contains: normalizeCode(q) } },
      { casNormalized: { contains: normalizeCas(q) } },
      { note: { contains: q, mode: "insensitive" } },
      { names: { some: { nameJa: { contains: q, mode: "insensitive" } } } },
      { names: { some: { nameEn: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.substance.findMany({
      where,
      include: SUBSTANCE_INCLUDE,
      orderBy: { codeNormalized: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.substance.count({ where }),
  ]);

  return Response.json({
    items: items.map(toListItem),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}

/** POST /api/substances — 新規登録 */
export async function POST(req: Request) {
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = substanceSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  if (hasDuplicateGazette(input)) {
    return jsonError(400, "duplicate_gazette", m.errors.duplicateGazette);
  }

  const defs = await prisma.substancePropertyDef.findMany();
  const propErrors = validateProperties(input, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  const base = normalizeInput(input);
  const settings = await getAppSettings();
  const casError = validateCas(base.casNormalized, settings, m);
  if (casError) return jsonError(400, "validation_error", casError);

  if (await prisma.substance.findUnique({ where: { codeNormalized: base.codeNormalized } })) {
    return jsonError(409, "duplicate_code", m.errors.duplicateCode(base.code));
  }

  const children = childWrites(input);
  const created = await prisma.substance.create({
    data: {
      ...base,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
      names: { create: children.names },
      gazetteNumbers: { create: children.gazetteNumbers },
      properties: { create: children.properties },
    },
  });

  await writeAudit({
    entity: "substances",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: base.code, casNumber: base.casNumber, mainNameJa: input.mainNameJa },
  });

  const warnings = await collectWarnings(base.casNormalized, created.id, settings, m);
  return Response.json({ id: created.id, warnings }, { status: 201 });
}
