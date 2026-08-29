/**
 * 「残部」の行に、計算していた値を含有率として書き込む。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/fix-balance-lines.ts
 *   ... scripts/fix-balance-lines.ts --write
 *
 * **「残部」の機能をやめるための下ごしらえ。**
 * 残部の行は含有率を持たず、ほかの行の合計から「残り」を出して使っていた。
 * 機能をやめると、その行だけ含有率が空になり、そのぶんが
 * 「中身が分からない」扱いになって判定が変わってしまう。
 *
 * そこで、**やめる前に計算していた値をそのまま書き込む**。
 * 合計は100%のままで、判定も変わらない。表示から「（残部）」が消えるだけ。
 *
 * 合計が100%を超えている組成では、残りが負になる。
 * その行は**0%として書き込み、画面から直してもらう**（消すと行ごと失われる）。
 */
import { fromScaled, SCALED_HUNDRED, sumScaled } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const lines = await prisma.compositionLine.findMany({
    where: { isBalance: true },
    select: { id: true, parentProductId: true, parentProduct: { select: { code: true } } },
  });
  console.log(`残部の行: ${lines.length} 件`);
  if (lines.length === 0) {
    await prisma.$disconnect();
    return;
  }

  /** 同じ製品に残部が2行あると「残り」を分けようがない。念のため見る */
  const perProduct = new Map<string, number>();
  for (const l of lines)
    perProduct.set(l.parentProductId, (perProduct.get(l.parentProductId) ?? 0) + 1);
  const many = [...perProduct].filter(([, n]) => n > 1);
  if (many.length > 0) {
    throw new Error(`残部が2行以上ある製品があります: ${many.length} 件`);
  }

  let negative = 0;
  for (const l of lines) {
    // その製品の、残部以外の合計
    const others = await prisma.compositionLine.findMany({
      where: { parentProductId: l.parentProductId, isBalance: false },
      select: { contentPct: true },
    });
    const filled = sumScaled(others.map((o) => o.contentPct?.toString() ?? null));
    const rest = SCALED_HUNDRED - filled;
    const pct = rest > 0n ? fromScaled(rest) : "0";
    if (rest <= 0n) negative += 1;

    console.log(`  ${l.parentProduct.code.padEnd(12)} → ${pct}%`);
    if (write) {
      await prisma.compositionLine.update({
        where: { id: l.id },
        data: { contentPct: pct, isBalance: false },
      });
    }
  }

  if (negative > 0) {
    console.log(`\n  **残りが無い（合計が100%以上）製品が ${negative} 件。0% で書きました**`);
  }
  console.log(write ? "\n書き込みました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
