/**
 * RoHS 附属書IIの10物質に、適用条件を1行入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/set-rohs-exemption.ts
 *   ... scripts/set-rohs-exemption.ts --write
 *
 * **`seed-rohs.ts` と同じ文面を、既にあるデータへ入れ直すためのもの。**
 * 取り込みをやり直すと名前や閾値まで書き換わるので、この欄だけを入れる。
 *
 * 附属書IIIとIVの適用除外は番号46まであって枝番にも分かれ、全部で80件を超える。
 * そのまま写すと数万字になり、しかも**物質ではなく用途に対する除外**なので、
 * 10物質すべてに同じ表を書くことになる。
 * 判定でできるのは「条件があると知らせる」ところまでで、
 * どの除外に当たるかは用途を知っている人が附属書を見て決める。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 第4条第1項の但し書きを、条文の言い方で1行だけ */
const EXEMPTION =
  "附属書III及び附属書IVに掲げる用途については、同附属書に定める期限まで適用しない（第4条第1項）";

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const where = {
    deletedAt: null,
    regulationClass: { category: { law: { nameJa: { contains: "RoHS" } } } },
    officialNumber: { startsWith: "附属書II " },
  };
  const rows = await prisma.statutorySubstance.findMany({
    where,
    select: { officialNumber: true, nameOriginal: true, applicableCondition: true },
    orderBy: { displayOrder: "asc" },
  });
  console.log(`RoHS 附属書IIの法文物質名: ${rows.length} 件`);
  for (const r of rows) {
    const now = (r.applicableCondition ?? "").trim();
    const mark =
      now === EXEMPTION
        ? "（入っています）"
        : now === ""
          ? "（空）"
          : `（別の文: ${now.slice(0, 20)}…）`;
    console.log(`  ${r.officialNumber} ${r.nameOriginal} ${mark}`);
  }

  if (write) {
    const done = await prisma.statutorySubstance.updateMany({
      where,
      data: { applicableCondition: EXEMPTION },
    });
    console.log(`\n入れました: ${done.count} 件`);
  } else {
    console.log("\n下見だけ。書き込むなら --write");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
