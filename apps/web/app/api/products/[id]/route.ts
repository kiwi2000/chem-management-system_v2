import { productSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { countUsesAsMaterial } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  PRODUCT_INCLUDE,
  checkFlagPermissions,
  childWrites,
  normalizeInput,
  toDetail,
  visibilityWhere,
} from "@/lib/product-service";
import { validatePropertyValues } from "@/lib/property-values";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/products/[id]
 * 非公開の製品は、権限が無ければ 404（403 だと「その ID の製品は在る」と分かってしまう）。
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const item = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
    include: PRODUCT_INCLUDE,
  });
  if (!item) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toDetail(item) });
}

/** PUT /api/products/[id] — 別名・拡張属性は入れ替えで更新する */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = productSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  const flagError = checkFlagPermissions(input, existing, actor, m);
  if (flagError) return jsonError(403, "forbidden", flagError);

  const defs = await prisma.propertyDef.findMany({ where: { target: "PRODUCT" } });
  const propErrors = validatePropertyValues(input.properties, defs, m);
  if (propErrors.length > 0) {
    return jsonError(400, "validation_error", propErrors[0] ?? m.errors.validation);
  }

  const base = normalizeInput(input);
  if (base.codeNormalized !== existing.codeNormalized) {
    const clash = await prisma.product.findUnique({
      where: { codeNormalized: base.codeNormalized },
    });
    if (clash) return jsonError(409, "duplicate_code", m.errors.duplicateProductCode(base.code));
  }

  const children = childWrites(input);
  await prisma.$transaction([
    prisma.productAlias.deleteMany({ where: { productId: id } }),
    prisma.productProperty.deleteMany({ where: { productId: id } }),
    prisma.product.update({
      where: { id },
      data: {
        ...base,
        updatedBy: actor.user.id,
        aliases: { create: children.aliases },
        properties: { create: children.properties },
      },
    }),
  ]);

  await writeAudit({
    entity: "products",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      code: base.code,
      nameJa: base.nameJa,
      status: base.status,
      usableAsMaterial: base.usableAsMaterial,
      privateFlag: base.privateFlag,
      compositionPublicFlag: base.compositionPublicFlag,
    },
  });

  // 原材料利用可を外しても既存の参照は残る。気づけるように知らせる（保存は通す）
  const warnings: string[] = [];
  if (existing.usableAsMaterial && !base.usableAsMaterial) {
    const uses = await countUsesAsMaterial(id);
    if (uses > 0) warnings.push(m.composition.usedAsMaterialWarning(uses));
  }
  return Response.json({ ok: true, warnings });
}

/**
 * DELETE /api/products/[id] — 論理削除。
 * 正規化コードを退避して、同じコードを再登録できるようにする（v1はできなかった）。
 * 他の組成から原材料として使われている場合は断る（消すと親の組成が壊れるため）。
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const uses = await countUsesAsMaterial(id);
  if (uses > 0) {
    return jsonError(409, "referenced", m.composition.referencedByProducts(uses));
  }

  await prisma.product.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      updatedBy: actor.user.id,
      // 一意制約を空けるための退避。原文の code はそのまま残す
      codeNormalized: `${existing.codeNormalized}:${existing.id}`.slice(0, 64),
    },
  });

  await writeAudit({
    entity: "products",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code },
  });
  return Response.json({ ok: true });
}
