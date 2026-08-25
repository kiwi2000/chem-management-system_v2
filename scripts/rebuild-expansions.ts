/**
 * 展開結果を全製品ぶん作り直す管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/rebuild-expansions.ts
 *
 * 普段は組成を保存したときに自動で作り直される。これを使うのは、
 *   - はじめて導入するとき（既存の組成から一斉に作る）
 *   - 計算のしかたを直したとき
 *   - 何かの理由で作り直しを取りこぼしたと疑われるとき
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // アプリ側の関数をそのまま使う。計算が2通りになると必ず食い違う
  const { expandProduct, saveExpansion } = await import("../apps/web/lib/expansion-store");
  const { getAppSettings } = await import("../apps/web/lib/settings");
  const { getMessages } = await import("@chem/shared");

  const settings = await getAppSettings();
  /*
    画面からの呼び出しではないので、言語は Cookie から決められない。
    ここで使う文言は合計の検証のエラー文だけで、画面には出ないため日本語で固定する。
  */
  const m = getMessages("ja");

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });
  console.log(`製品 ${products.length}件を展開します`);

  let withUnknown = 0;
  for (const p of products) {
    const e = await expandProduct(p.id, settings, m);
    await saveExpansion(p.id, e);
    if (Number(e.unknownPct) > 0) withUnknown += 1;
  }
  console.log(`できました。うち中身の分からないぶんが残る製品: ${withUnknown}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
