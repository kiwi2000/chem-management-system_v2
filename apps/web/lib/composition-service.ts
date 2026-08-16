import {
  validateCompositionSum,
  type AppSettings,
  type CompositionInput,
  type Messages,
} from "@chem/shared";
import type { Prisma, Product } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { CompositionLineDto, CompositionResponse } from "@/lib/types";

/** 表示に必要な関連（構成要素のコードと名称） */
export const COMPOSITION_INCLUDE = {
  substance: { select: { id: true, code: true, nameJa: true, nameEn: true } },
  childProduct: { select: { id: true, code: true, nameJa: true, nameEn: true } },
} satisfies Prisma.CompositionLineInclude;

type LineRow = Prisma.CompositionLineGetPayload<{ include: typeof COMPOSITION_INCLUDE }>;

/**
 * 組成を見られるか。
 * 「組成を見られる」権限に加えて、非開示の製品は専用の権限が要る。
 * 製品そのものが見えるかどうか（非公開フラグ）は product-service 側で別に判定する。
 */
export function canViewComposition(actor: Actor, product: Product): boolean {
  if (!actor.has("COMPOSITION_VIEW")) return false;
  return product.compositionPublicFlag || actor.has("COMPOSITION_VIEW_PRIVATE");
}

/** 組成を書き換えられるか。見えないものは編集させない */
export function canEditComposition(actor: Actor, product: Product): boolean {
  return actor.has("PRODUCT_EDIT") && canViewComposition(actor, product);
}

export function toLineDto(l: LineRow): CompositionLineDto {
  return {
    id: l.id,
    substanceId: l.substanceId,
    childProductId: l.childProductId,
    contentPct: l.contentPct?.toString() ?? null,
    isBalance: l.isBalance,
    note: l.note,
    element: l.substance
      ? {
          id: l.substance.id,
          code: l.substance.code,
          nameJa: l.substance.nameJa,
          nameEn: l.substance.nameEn,
        }
      : l.childProduct
        ? {
            id: l.childProduct.id,
            code: l.childProduct.code,
            nameJa: l.childProduct.nameJa,
            nameEn: l.childProduct.nameEn,
          }
        : null,
  };
}

/** 一覧と、そこから計算できる合計をまとめて返す */
export function toCompositionResponse(
  lines: LineRow[],
  settings: AppSettings,
  m: Messages,
): CompositionResponse {
  const items = lines.map(toLineDto);
  const sum = validateCompositionSum(
    items.map((l) => ({ contentPct: l.contentPct, isBalance: l.isBalance })),
    settings,
    m,
  );
  return { lines: items, totalPct: sum.totalPct, balancePct: sum.balancePct };
}

/**
 * 参照の整合と重複を見る。保存前に呼び、1件でもエラーがあれば保存しない。
 *
 * 原材料の候補は「有効・削除されていない・原材料利用可・（権限が無ければ非公開でない）」に限る。
 * 廃番のものを新しく組成に入れられないようにするのは、間違いに気づけるようにするため
 * （既に入っている行は触らないので、過去の組成は壊れない）。
 */
export async function validateReferences(
  input: CompositionInput,
  actor: Actor,
  m: Messages,
): Promise<string[]> {
  const errors: string[] = [];

  const substanceIds = input.lines.map((l) => l.substanceId).filter((id) => id != null);
  const productIds = input.lines.map((l) => l.childProductId).filter((id) => id != null);

  const substances = await prisma.substance.findMany({
    where: { id: { in: substanceIds }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      deletedAt: null,
      status: "ACTIVE",
      ...(actor.has("PRODUCT_VIEW_PRIVATE") ? {} : { privateFlag: false }),
    },
    select: { id: true, code: true, usableAsMaterial: true },
  });

  const substanceById = new Map(substances.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const seenSubstances = new Set<string>();
  for (const id of substanceIds) {
    const found = substanceById.get(id);
    if (!found) {
      errors.push(m.composition.errorSubstanceNotFound);
      continue;
    }
    if (seenSubstances.has(id)) errors.push(m.composition.errorDuplicateSubstance(found.code));
    seenSubstances.add(id);
  }

  const seenProducts = new Set<string>();
  for (const id of productIds) {
    const found = productById.get(id);
    if (!found) {
      errors.push(m.composition.errorProductNotFound);
      continue;
    }
    if (!found.usableAsMaterial) {
      errors.push(m.composition.errorNotUsableAsMaterial(found.code));
    }
    if (seenProducts.has(id)) errors.push(m.composition.errorDuplicateProduct(found.code));
    seenProducts.add(id);
  }

  // 同じ文言が並ぶと読みにくいので一度だけにする
  return [...new Set(errors)];
}

/**
 * 循環参照の検出。
 * 新しく入れようとしている子製品から組成をたどり、親製品自身に行き着いたら循環。
 * 訪問済みを持って無限ループを防ぐ。
 */
export async function wouldCreateCycle(
  parentProductId: string,
  childProductIds: string[],
): Promise<boolean> {
  if (childProductIds.includes(parentProductId)) return true;

  const visited = new Set<string>(childProductIds);
  let frontier = [...childProductIds];

  while (frontier.length > 0) {
    const rows = await prisma.compositionLine.findMany({
      where: { parentProductId: { in: frontier }, childProductId: { not: null } },
      select: { childProductId: true },
    });

    const next: string[] = [];
    for (const row of rows) {
      const id = row.childProductId;
      if (id === null) continue;
      if (id === parentProductId) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      next.push(id);
    }
    frontier = next;
  }
  return false;
}

/** この製品を原材料として使っている組成の数（削除済みの親は数えない） */
export function countUsesAsMaterial(productId: string): Promise<number> {
  return prisma.compositionLine.count({
    where: { childProductId: productId, parentProduct: { deletedAt: null } },
  });
}

/** この物質を使っている組成の数（削除済みの親は数えない） */
export function countUsesOfSubstance(substanceId: string): Promise<number> {
  return prisma.compositionLine.count({
    where: { substanceId, parentProduct: { deletedAt: null } },
  });
}

/** 入力から DB に書く行へ。残部の行は含有率を持たない */
export function lineWrites(input: CompositionInput) {
  return input.lines.map((l, i) => ({
    substanceId: l.substanceId ?? null,
    childProductId: l.childProductId ?? null,
    contentPct: l.isBalance ? null : (l.contentPct ?? null),
    isBalance: l.isBalance,
    note: l.note ?? null,
    displayOrder: i + 1,
  }));
}
