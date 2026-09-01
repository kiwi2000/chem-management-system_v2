/**
 * 全物質のスコアとランクを計算し直す管理用スクリプト。
 *
 * 実行:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/rescore.ts
 *
 * 普段は要らない。**区分のスコアを保存したときも、ランクの対応表を入れ替えたときも
 * 画面の側で自動的に走る。**これを使うのは、
 *   - CASリンクを取り込みスクリプトで入れ替えたあと
 *   - 法規制バージョンを切り替えたあと
 *   - はじめて導入するとき
 *
 * **判定（`rejudge.ts`）とは別物。**あちらは製品の該非、こちらは物質そのものの点数。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { recomputeAllScores } = await import("../apps/web/lib/score-store");

  const bands = await prisma.substanceRankBand.count({ where: { deletedAt: null } });
  const scored = await prisma.regulationCategory.count({
    where: { deletedAt: null, judged: true, score: { not: 0 } },
  });
  console.log(`点の付いた区分: ${scored}件（判定に使うものだけ数える）`);
  console.log(
    `ランクの段: ${bands}件${bands === 0 ? "  ← 0件なので、ランクは空欄になります" : ""}`,
  );

  const started = Date.now();
  const n = await recomputeAllScores();
  console.log(
    `\n計算し直した物質: ${n.toLocaleString()}件（${((Date.now() - started) / 1000).toFixed(1)}秒）`,
  );

  const byRank = await prisma.substance.groupBy({
    by: ["scoreRank"],
    where: { deletedAt: null },
    _count: true,
  });
  byRank.sort((a, b) => (a.scoreRank ?? "").localeCompare(b.scoreRank ?? ""));
  for (const r of byRank) {
    console.log(`  ${(r.scoreRank ?? "（ランクなし）").padEnd(14)}${r._count.toLocaleString()}件`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
