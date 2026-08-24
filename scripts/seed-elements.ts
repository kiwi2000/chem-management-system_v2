/**
 * 元素を投入する。法文物質名の「換算先」で選ぶための一覧。
 *
 * 中身は `scripts/data/elements.json`。原子番号1〜118と、
 * 元素ではないが換算先になるもの（シアン `CN`）を900番台で1件。
 *
 * 既にあるものは名前を更新し、無いものだけ足す。消しはしない。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-elements.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** [原子番号, 元素記号, 日本語名, 英語名] */
type Row = [number, string, string, string];

async function main() {
  const rows = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/elements.json"), "utf-8"),
  ) as Row[];

  let added = 0;
  let updated = 0;
  for (const [atomicNumber, symbol, nameJa, nameEn] of rows) {
    const existing = await prisma.element.findUnique({ where: { symbol } });
    if (existing) {
      await prisma.element.update({
        where: { symbol },
        data: { atomicNumber, nameJa, nameEn, deletedAt: null },
      });
      updated += 1;
    } else {
      await prisma.element.create({ data: { symbol, atomicNumber, nameJa, nameEn } });
      added += 1;
    }
  }
  console.log(`元素: ${added} 件を足し、${updated} 件を更新しました（合計 ${rows.length} 件）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
