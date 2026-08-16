import { normalizeCode, type Messages, type ProductInput } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { propertyWrites } from "@/lib/property-values";
import type { ProductDetailDto, ProductListItemDto } from "@/lib/types";

/** 一覧に必要な関連（別名は件数だけ使う） */
export const PRODUCT_LIST_INCLUDE = {
  _count: { select: { aliases: true } },
} satisfies Prisma.ProductInclude;

/** 詳細取得で必要になる関連 */
export const PRODUCT_INCLUDE = {
  _count: { select: { aliases: true } },
  aliases: { orderBy: { displayOrder: "asc" } },
  properties: { include: { def: true } },
} satisfies Prisma.ProductInclude;

type ProductListRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_LIST_INCLUDE }>;
type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/**
 * 非公開製品の隠し方。
 * 権限が無い人には**存在ごと**見せないので、一覧・件数・詳細のすべてでこの条件を掛ける
 * （詳細は 403 ではなく 404。403 だと「その ID の製品は在る」と分かってしまう）。
 */
export function visibilityWhere(actor: Actor): Prisma.ProductWhereInput {
  return actor.has("PRODUCT_VIEW_PRIVATE") ? {} : { privateFlag: false };
}

export function toListItem(p: ProductListRow): ProductListItemDto {
  return {
    id: p.id,
    code: p.code,
    nameJa: p.nameJa,
    nameEn: p.nameEn,
    status: p.status,
    note: p.note,
    aliasCount: p._count.aliases,
    usableAsMaterial: p.usableAsMaterial,
    privateFlag: p.privateFlag,
    compositionPublicFlag: p.compositionPublicFlag,
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
 * 機密のフラグの初期値。
 * 新規登録でこれと違う値を送ってきた場合は、対応する閲覧権限を要求する。
 */
export const FLAG_DEFAULTS = { privateFlag: false, compositionPublicFlag: true } as const;

/**
 * 機密のフラグを変えてよいか。
 * 自分が見られない区分を切り替えられるのはおかしいので、対応する閲覧権限を要求する
 * （見えないものを非公開にする／非開示のものを公開にする、のどちらも防ぐ）。
 * 値を変えていなければ権限は要らない。
 */
export function checkFlagPermissions(
  input: ProductInput,
  before: { privateFlag: boolean; compositionPublicFlag: boolean },
  actor: Actor,
  m: Messages,
): string | null {
  if (input.privateFlag !== before.privateFlag && !actor.has("PRODUCT_VIEW_PRIVATE")) {
    return m.errors.forbiddenPrivateFlag;
  }
  if (
    input.compositionPublicFlag !== before.compositionPublicFlag &&
    !actor.has("COMPOSITION_VIEW_PRIVATE")
  ) {
    return m.errors.forbiddenCompositionFlag;
  }
  return null;
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
    privateFlag: input.privateFlag,
    compositionPublicFlag: input.compositionPublicFlag,
  };
}

/** 別名・拡張属性は入れ替え方式（差分を追うより単純で事故が少ない） */
export function childWrites(input: ProductInput) {
  return {
    aliases: input.aliases.map((a, i) => ({
      nameJa: a.nameJa.trim(),
      nameEn: a.nameEn?.trim() || null,
      displayOrder: i + 1,
    })),
    properties: propertyWrites(input.properties),
  };
}
