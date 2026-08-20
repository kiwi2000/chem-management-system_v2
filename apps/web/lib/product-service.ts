import { normalizeCode, type ProductInput } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { propertyWrites } from "@/lib/property-values";
import type { ProductDetailDto, ProductListItemDto } from "@/lib/types";

/** 一覧に必要な関連（別名は件数だけ使う） */
export const PRODUCT_LIST_INCLUDE = {
  _count: { select: { aliases: true } },
  uses: { orderBy: { displayOrder: "asc" } },
} satisfies Prisma.ProductInclude;

/** 詳細取得で必要になる関連 */
export const PRODUCT_INCLUDE = {
  _count: { select: { aliases: true } },
  uses: { orderBy: { displayOrder: "asc" } },
  aliases: { orderBy: { displayOrder: "asc" } },
  properties: { include: { def: true } },
} satisfies Prisma.ProductInclude;

type ProductListRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_LIST_INCLUDE }>;
type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/**
 * 一覧・詳細に出してよい製品の条件。
 *
 * 無効（廃番）とドラフトのものは、作成者と `INACTIVE_VIEW` を持つ人にだけ見せる。
 * 一覧・件数・詳細のすべてに同じ条件を掛けること
 * （詳細は 403 ではなく 404。403 だと「その ID の製品は在る」と分かってしまうため）。
 *
 * 組成の構成要素として名前を出す場面には掛けない。掛けると、無効な原材料を含む
 * 親製品の組成が読めなくなるため（S9 で決定）。
 */
export function visibilityWhere(actor: Actor): Prisma.ProductWhereInput {
  if (actor.has("INACTIVE_VIEW")) return {};
  return { OR: [{ status: "ACTIVE", draftFlag: false }, { createdBy: actor.user.id }] };
}

/** 書き換えてよいか。見えるだけでは足りず、無効・ドラフトは専用の権限が要る */
export function canEditProduct(
  actor: Actor,
  target: { status: string; draftFlag: boolean; createdBy: string | null },
): boolean {
  if (!actor.has("PRODUCT_EDIT")) return false;
  const restricted = target.status !== "ACTIVE" || target.draftFlag;
  if (!restricted) return true;
  return actor.has("INACTIVE_EDIT") || target.createdBy === actor.user.id;
}

export function toListItem(p: ProductListRow): ProductListItemDto {
  return {
    id: p.id,
    code: p.code,
    nameJa: p.nameJa,
    nameEn: p.nameEn,
    status: p.status,
    draftFlag: p.draftFlag,
    note: p.note,
    aliasCount: p._count.aliases,
    usableAsMaterial: p.usableAsMaterial,
    modelValue: p.modelValue,
    uses: p.uses.map((u) => u.value),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toDetail(p: ProductWithRelations): ProductDetailDto {
  return {
    ...toListItem(p),
    aliases: p.aliases.map((a) => ({ nameJa: a.nameJa, nameEn: a.nameEn })),
    properties: p.properties.map((v) => ({
      propertyDefId: v.propertyDefId,
      valueText: v.valueText,
      valueNum: v.valueNum?.toString() ?? null,
      unit: v.unit,
    })),
  };
}

/**
 * 入力から DB に書く値へ。正規化はここに集約する。
 * コードはユーザーが決める業務キーなので原文（大小文字）を残し、突合は正規化列で行う。
 */
export function normalizeInput(input: ProductInput) {
  return {
    code: input.code.trim(),
    codeNormalized: normalizeCode(input.code),
    nameJa: input.nameJa.trim(),
    nameEn: input.nameEn?.trim() || null,
    status: input.status,
    note: input.note?.trim() || null,
    usableAsMaterial: input.usableAsMaterial,
    modelValue: input.modelValue?.trim() || null,
  };
}

/** 別名・拡張属性は入れ替え方式（差分を追うより単純で事故が少ない） */
export function childWrites(input: ProductInput) {
  return {
    aliases: input.aliases.map((a, i) => ({
      nameJa: a.nameJa?.trim() || null,
      nameEn: a.nameEn?.trim() || null,
      displayOrder: i + 1,
    })),
    uses: input.uses.map((value, i) => ({ value: value.trim(), displayOrder: i + 1 })),
    properties: propertyWrites(input.properties),
  };
}
