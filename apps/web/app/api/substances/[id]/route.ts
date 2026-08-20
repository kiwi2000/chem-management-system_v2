import { substanceSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { countUsesOfSubstance } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  SUBSTANCE_INCLUDE,
  childWrites,
  collectWarnings,
  hasDuplicateGazette,
  normalizeInput,
  toDetail,
  canEditSubstance,
  visibilityWhere,
  validateCas,
} from "@/lib/substance-service";
import { validatePropertyValues } from "@/lib/property-values";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/substances/[id] */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const item = await prisma.substance.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
    include: SUBSTANCE_INCLUDE,
  });
  if (!item) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toDetail(item) });
}

/** PUT /api/substances/[id] — 名称・整理番号・拡張属性は入れ替えで更新する */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.substance.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  // 作成中のものは、作成者か専用の権限を持つ人だけが書き換えられる
  if (!canEditSubstance(actor, existing)) return jsonError(403, "forbidden", m.errors.forbidden);

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

  const defs = await prisma.propertyDef.findMany({ where: { target: "SUBSTANCE" } });
  const propErrors = validatePropertyValues(input.properties, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  // 作成中かどうかは専用の操作でだけ変える（保存で意図せず完成にしない）
  const base = { ...normalizeInput(input), draftFlag: existing.draftFlag };
  const settings = await getAppSettings();
  const casError = validateCas(base.casNormalized, settings, m);
  if (casError) return jsonError(400, "validation_error", casError);

  if (base.codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.substance.findUnique({
      where: { codeNormalized: base.codeNormalized },
    });
    if (clash) return jsonError(409, "duplicate_code", m.errors.duplicateCode(base.code));
  }

  const children = childWrites(input);
  await prisma.$transaction([
    prisma.substanceAlias.deleteMany({ where: { substanceId: id } }),
    prisma.substanceGazetteNumber.deleteMany({ where: { substanceId: id } }),
    prisma.substanceProperty.deleteMany({ where: { substanceId: id } }),
    prisma.substance.update({
      where: { id },
      data: {
        ...base,
        updatedBy: actor.user.id,
        aliases: { create: children.aliases },
        gazetteNumbers: { create: children.gazetteNumbers },
        properties: { create: children.properties },
      },
    }),
  ]);

  await writeAudit({
    entity: "substances",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      code: base.code,
      casNumber: base.casNumber,
      status: base.status,
      mainNameJa: input.mainNameJa,
    },
  });

  // 更新でも同一CASの警告を出す（v1は登録時しか見ていなかった）
  const warnings = await collectWarnings(base.casNormalized, id, settings, m);
  return Response.json({ ok: true, warnings });
}

/**
 * DELETE /api/substances/[id] — 論理削除。
 * 正規化コードを退避して、同じコードを再登録できるようにする（v1はできなかった）。
 * 組成から使われている場合は断る（消すと製品の組成が壊れるため）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.substance.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);
  // 作成中のものは、作成者か専用の権限を持つ人だけが書き換えられる
  if (!canEditSubstance(actor, existing)) return jsonError(403, "forbidden", m.errors.forbidden);

  const uses = await countUsesOfSubstance(id);
  if (uses > 0) {
    return jsonError(409, "referenced", m.composition.referencedByProducts(uses));
  }

  await prisma.substance.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      // 一意制約を空けるための退避。原文の code はそのまま残す
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "substances",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ ok: true });
}
