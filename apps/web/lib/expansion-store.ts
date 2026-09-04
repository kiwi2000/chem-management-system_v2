import { COMPOSITION_MAX_DEPTH } from "@chem/shared";
import { expandTree, type ExpandedProduct, type LineLoader } from "@/lib/expansion-calc";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { judgeProduct, loadFactors, loadRules } from "@/lib/judge-store";

/**
 * 展開結果の保存と、作り直し。
 *
 * 計算そのものは expansion-calc.ts にある（データベースを知らない形にしてある）。
 * こちらは、読み出し・保存・「どこまで作り直すか」を受け持つ。
 */

/**
 * データベースから読み出す係。
 * **権限で絞らない。**ここで絞ると、人によって違う結果ができてしまう。
 */
const dbLoader: LineLoader = async (productId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!product) return null;
  const lines = await prisma.compositionLine.findMany({
    where: { parentProductId: productId },
    include: { substance: { select: { id: true, casNumber: true } } },
    orderBy: { displayOrder: "asc" },
  });
  if (lines.length === 0) return null;
  return lines.map((l) => ({
    contentPct: l.contentPct?.toString() ?? null,
    substance: l.substance,
    childProductId: l.childProductId,
  }));
};

/** 1製品ぶんを展開する。**書き込みはしない。** */
export function expandProduct(rootProductId: string): Promise<ExpandedProduct> {
  return expandTree(rootProductId, dbLoader);
}

/**
 * 展開結果を保存する（作り直し）。
 *
 * 行はいったん全部消してから入れ直す。差分で当てると、消えた物質の行が
 * 残り続ける事故が起きる。件数が知れているので、素直に作り直す。
 */
export async function saveExpansion(productId: string, e: ExpandedProduct): Promise<void> {
  await prisma.$transaction([
    prisma.productExpansionLine.deleteMany({ where: { productId } }),
    prisma.productExpansion.upsert({
      where: { productId },
      create: {
        productId,
        totalPct: e.totalPct,
        unknownPct: e.unknownPct,
        truncated: e.truncated,
      },
      update: {
        totalPct: e.totalPct,
        unknownPct: e.unknownPct,
        truncated: e.truncated,
        computedAt: new Date(),
      },
    }),
    prisma.productExpansionLine.createMany({
      data: e.lines.map((l) => ({ productId, ...l })),
    }),
  ]);
}

/**
 * その製品を原材料に使っている製品を、何段でも上へたどって集める。
 *
 * **組成を変えた製品だけを作り直すのでは足りない。**
 * 原材料の中身が変われば、それを使っているすべての製品の中身も変わる。
 * ここを取りこぼすと、古い展開結果が静かに残る。
 */
export async function findAffected(productId: string): Promise<string[]> {
  const seen = new Set<string>([productId]);
  let ring = [productId];
  // 循環は組成の登録時に弾いているが、万一のために深さで止める
  for (let depth = 0; depth < COMPOSITION_MAX_DEPTH + 1 && ring.length > 0; depth += 1) {
    const parents = await prisma.compositionLine.findMany({
      where: { childProductId: { in: ring }, parentProduct: { deletedAt: null } },
      select: { parentProductId: true },
    });
    ring = [];
    for (const p of parents) {
      if (!seen.has(p.parentProductId)) {
        seen.add(p.parentProductId);
        ring.push(p.parentProductId);
      }
    }
  }
  return [...seen];
}

/**
 * 組成が変わったときの作り直し。**その製品と、それを使っている親製品すべて。**
 *
 * 深いところから順に計算する必要はない（親を計算するときに子の組成を
 * その場でたどるので、保存済みの結果には頼っていない）。
 */
export async function recomputeFrom(productId: string): Promise<number> {
  const targets = await findAffected(productId);
  for (const id of targets) {
    await saveExpansion(id, await expandProduct(id));
  }

  /*
    展開が変われば判定の前提が変わるので、判定もやり直す。
    **前の判定は確認済みの状態ごと捨てる。**判定をやり直すのは、
    新しい製品を判定するのと同じこと。前の確認結果だけ残るのは筋が通らない。

    法律側の決めごとは1回だけ読んで使い回す。製品ごとに引くと、
    親をたくさん抱えた原材料を直したときに同じものを何度も引くことになる。
  */
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (version) {
    const rules = await loadRules(version.id);
    const factors = await loadFactors();
    // 条件つきリンクの扱いも1回だけ読む
    const { conditionalLinkMode } = await getAppSettings();
    for (const id of targets) {
      await judgeProduct(id, rules, factors, conditionalLinkMode, version.id);
    }
  }

  return targets.length;
}
