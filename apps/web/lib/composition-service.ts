import {
  validateCompositionSum,
  type AppSettings,
  type CompositionInput,
  type Messages,
} from "@chem/shared";
import type { Prisma, Product } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { compositionAccess } from "@/lib/composition-access";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { prisma } from "@/lib/db";
import type { CompositionLineDto, CompositionResponse } from "@/lib/types";

/** 表示に必要な関連（構成要素のコード・名称・CAS番号） */
export const COMPOSITION_INCLUDE = {
  substance: {
    select: {
      id: true,
      code: true,
      nameJa: true,
      nameEn: true,
      casNumber: true,
      score: true,
      scoreRank: true,
      // 不純物種別（S21）。合算は CAS × 種別で分ける
      impurityTypeId: true,
    },
  },
  childProduct: {
    select: {
      id: true,
      code: true,
      nameJa: true,
      nameEn: true,
      // 中身を持っているかどうか。展開の印を出すかの判断に使う
      _count: { select: { compositionLines: true } },
    },
  },
} satisfies Prisma.CompositionLineInclude;

export type LineRow = Prisma.CompositionLineGetPayload<{ include: typeof COMPOSITION_INCLUDE }>;

/** 反応前組成（写し）も同じ関連で引く（S24）。列も関連名も登録組成と同じ */
export const PRE_REACTION_INCLUDE =
  COMPOSITION_INCLUDE satisfies Prisma.ProductPreReactionLineInclude;
export type PreLineRow = Prisma.ProductPreReactionLineGetPayload<{
  include: typeof PRE_REACTION_INCLUDE;
}>;

/**
 * 組成を見られるか（S31 仕様 10 章の 3 つの条件。lib/composition-access.ts）。
 * 製品の所属先の印と、組成の中身（物質・原材料）の所属先の印で決まる
 */
export async function canViewComposition(
  actor: Actor,
  product: Pick<Product, "id">,
): Promise<boolean> {
  return (await compositionAccess(actor, product.id)) !== "hidden";
}

/** 組成を書き換えられるか。所属先に「組成 編集」の印があり、中身が全部見えること */
export async function canEditComposition(
  actor: Actor,
  product: Pick<Product, "id">,
): Promise<boolean> {
  return (await compositionAccess(actor, product.id)) === "edit";
}

export function toLineDto(l: LineRow | PreLineRow): CompositionLineDto {
  return {
    id: l.id,
    substanceId: l.substanceId,
    childProductId: l.childProductId,
    contentPct: l.contentPct?.toString() ?? null,
    note: l.note,
    element: l.substance
      ? {
          id: l.substance.id,
          code: l.substance.code,
          nameJa: l.substance.nameJa,
          nameEn: l.substance.nameEn,
          casNumber: l.substance.casNumber,
          hasComposition: false,
        }
      : l.childProduct
        ? {
            id: l.childProduct.id,
            code: l.childProduct.code,
            nameJa: l.childProduct.nameJa,
            nameEn: l.childProduct.nameEn,
            // 原材料にCASは無い。表では「原材料」と示す
            casNumber: null,
            hasComposition: l.childProduct._count.compositionLines > 0,
          }
        : null,
  };
}

/** 一覧と、そこから計算できる合計をまとめて返す */
export function toCompositionResponse(
  lines: (LineRow | PreLineRow)[],
  settings: AppSettings,
  m: Messages,
): CompositionResponse {
  const items = lines.map(toLineDto);
  const sum = validateCompositionSum(
    items.map((l) => ({ contentPct: l.contentPct })),
    settings,
    m,
  );
  // 反応前の写しは呼ぶ側が足す（無ければ null のまま）
  return { lines: items, totalPct: sum.totalPct, preReaction: null };
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

/**
 * この製品を原材料として使っている組成の数（削除済みの親は数えない）。
 * 反応前組成（写し）からの参照も数える。写しだけに残っている原材料を消すと、反応前の表が欠けるため（S24）
 */
export async function countUsesAsMaterial(productId: string): Promise<number> {
  const [lines, pre] = await Promise.all([
    prisma.compositionLine.count({
      where: { childProductId: productId, parentProduct: { deletedAt: null } },
    }),
    prisma.productPreReactionLine.count({
      where: { childProductId: productId, product: { deletedAt: null } },
    }),
  ]);
  return lines + pre;
}

/** この物質を使っている組成の数（削除済みの親は数えない）。反応前の写しからの参照も数える */
export async function countUsesOfSubstance(substanceId: string): Promise<number> {
  const [lines, pre] = await Promise.all([
    prisma.compositionLine.count({
      where: { substanceId, parentProduct: { deletedAt: null } },
    }),
    prisma.productPreReactionLine.count({
      where: { substanceId, product: { deletedAt: null } },
    }),
  ]);
  return lines + pre;
}

/** 入力から DB に書く行へ */
export function lineWrites(input: CompositionInput) {
  return input.lines.map((l, i) => ({
    substanceId: l.substanceId ?? null,
    childProductId: l.childProductId ?? null,
    contentPct: l.contentPct ?? null,
    note: l.note ?? null,
    displayOrder: i + 1,
  }));
}

/**
 * この原材料・物質を組成に使っている製品（削除済みは除く。反応前の写しも含む）の id。
 * 消すとき・所属先を移すときに使う（S31）
 */
export async function productsUsing(by: { childProductId: string } | { substanceId: string }) {
  const where =
    "childProductId" in by
      ? { childProductId: by.childProductId }
      : { substanceId: by.substanceId };
  const [lines, pre] = await Promise.all([
    prisma.compositionLine.findMany({
      where: { ...where, parentProduct: { deletedAt: null } },
      select: { parentProductId: true },
    }),
    prisma.productPreReactionLine.findMany({
      where: { ...where, product: { deletedAt: null } },
      select: { productId: true },
    }),
  ]);
  return [...new Set([...lines.map((l) => l.parentProductId), ...pre.map((l) => l.productId)])];
}

/**
 * 消せないときの文（S31 仕様 7 章）。使っている製品にその人が見られないものがあれば、
 * 件数を言わずに「ほかで使われているため消せません」とだけ出す（見えないものの存在を知らせない）
 */
export async function referencedMessage(
  actor: Actor,
  users: string[],
  m: Messages,
): Promise<string> {
  if (actor.isSystemAdmin) return m.composition.referencedByProducts(users.length);
  const visible = await prisma.product.count({
    where: { id: { in: users }, deletedAt: null, ...productVisibility(actor) },
  });
  return visible === users.length
    ? m.composition.referencedByProducts(users.length)
    : m.owner.usedElsewhere;
}
