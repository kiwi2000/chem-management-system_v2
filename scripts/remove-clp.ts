/**
 * CLP規則（調和分類・附属書VI 表3）を、判定から外す。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/remove-clp.ts
 *   ... scripts/remove-clp.ts --write
 *
 * **これは含有率で該非が決まる規制ではない。**
 * 附属書VI 表3は「EU全域で分類が決められている物質」の一覧で、
 * 分類そのもの（発がん性1Bなど）を定めるもの。製品が当たる・当たらないを
 * 含有率で判定する法規制とは性質が違うので、判定の一覧から外す。
 *
 * 消すのは CLP規則の法律そのもの（下にこの区分しか無い）。
 * 判定結果・CAS紐付け・法文物質名・分類・区分の順に消す。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LAW_CODE = "EU-CLP";

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "消します" : "下見（--write で実行）");

  const law = await prisma.law.findFirst({
    where: { codeNormalized: LAW_CODE },
    select: { id: true, nameJa: true, nameOriginal: true },
  });
  if (!law) {
    console.log(`${LAW_CODE} はありません（もう消えています）`);
    await prisma.$disconnect();
    return;
  }

  const classes = await prisma.regulationClass.findMany({
    where: { category: { lawId: law.id } },
    select: { id: true },
  });
  const classIds = classes.map((c) => c.id);
  const [subs, links, judgements] = await Promise.all([
    prisma.statutorySubstance.count({ where: { classId: { in: classIds } } }),
    prisma.statutoryCasLink.count({
      where: { statutorySubstance: { classId: { in: classIds } } },
    }),
    prisma.productJudgement.count({ where: { category: { lawId: law.id } } }),
  ]);

  console.log(`\n${law.nameJa ?? law.nameOriginal}`);
  console.log(
    `  規制区分   ${await prisma.regulationCategory.count({ where: { lawId: law.id } })} 件`,
  );
  console.log(`  分類       ${classes.length} 件`);
  console.log(`  法文物質名 ${subs} 件`);
  console.log(`  CAS紐付け  ${links} 件`);
  console.log(`  判定結果   ${judgements} 件`);

  if (!write) {
    console.log("\n下見だけ。消すなら --write");
    await prisma.$disconnect();
    return;
  }

  // 判定結果が先。法文物質名を消すと、当たりの行が行き場を失う
  await prisma.productJudgement.deleteMany({ where: { category: { lawId: law.id } } });
  await prisma.statutoryCasLink.deleteMany({
    where: { statutorySubstance: { classId: { in: classIds } } },
  });
  await prisma.statutorySubstance.deleteMany({ where: { classId: { in: classIds } } });
  await prisma.regulationClass.deleteMany({ where: { category: { lawId: law.id } } });
  await prisma.regulationCategory.deleteMany({ where: { lawId: law.id } });
  await prisma.law.delete({ where: { id: law.id } });
  console.log("\n消しました");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
