/**
 * 規制区分に「番号としての呼び名」を入れる。
 *
 *   npx tsx scripts/seed-number-labels.ts          下見
 *   npx tsx scripts/seed-number-labels.ts --write  書き込む
 *
 * 官報公示整理番号や政令番号は、**物質そのものの属性ではなく、
 * その法令の名簿が振っている番号**。物質側に書き写すと外部データベースとの
 * 二重管理になるので、区分に呼び名を入れておき、CASリンクをたどって
 * 物質の詳細に出す（決定 0008、`apps/web/lib/substance-numbers.ts`）。
 *
 * **呼び名を入れた区分だけが出る。**
 * どの区分にも番号は入っているが、全部出すと1物質で20行を超えて、
 * 本当に引きたい番号が埋もれる。**名簿の中でその物質を指す番号**に絞る。
 *
 * 呼び名は `docs/LOLI取り込み記録.md` の「突き合わせに使った鍵」に合わせてある。
 * そこに書いてある番号の正体と、画面に出る呼び名を食い違わせない。
 *
 * **人が画面から入れた呼び名は上書きしない。**
 */
import { normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface LabelDef {
  law: string;
  category: string;
  label: string;
}

const LABELS: LabelDef[] = [
  // 化審法。既存化学物質名簿の番号で、いわゆる「化審法番号」
  { law: "JP-CSCL", category: "SGN", label: "官報公示整理番号" },
  // 安衛法。通知対象物質は表示対象物質と同じ番号体系なので、片方だけ出す
  { law: "JP-ISHA", category: "SDS", label: "安衛法 則別表第2の号" },
  // 毒劇法。毒物と劇物で条が違うので、それぞれ出す
  { law: "JP-PDSCA", category: "TOX", label: "毒物 指定令1条の号" },
  { law: "JP-PDSCA", category: "DEL", label: "劇物 指定令2条の号" },
  /*
    化管法。特定第一種は第一種の一部で番号も同じなので、第一種だけ出す。
    第二種は別の番号体系なので分けて出す。
  */
  { law: "JP-PRTR", category: "C1", label: "化管法 政令番号" },
  { law: "JP-PRTR", category: "C2", label: "化管法 政令番号（第二種）" },
  // 中国。目録の序号がそのまま物質を指す
  { law: "CN-HAZCHEM", category: "HAZ", label: "危険化学品目録 序号" },
  { law: "CN-PRIORITY", category: "PRIORITY1", label: "優先管理化学品 管理番号" },
  { law: "CN-PRIORITY", category: "PRIORITY2", label: "優先管理化学品 管理番号" },
];

async function main() {
  const write = process.argv.includes("--write");
  const tally = { set: 0, kept: 0, missing: 0 };

  for (const def of LABELS) {
    const law = await prisma.law.findFirst({
      where: { codeNormalized: normalizeCode(def.law) },
      select: { id: true },
    });
    const category = law
      ? await prisma.regulationCategory.findFirst({
          where: { lawId: law.id, codeNormalized: normalizeCode(def.category), deletedAt: null },
          select: { id: true, numberLabel: true, nameJa: true, nameOriginal: true },
        })
      : null;
    if (!category) {
      console.log(`  ✗ ${def.law} / ${def.category} が見つかりません`);
      tally.missing += 1;
      continue;
    }
    if (category.numberLabel) {
      // 既に入っている。人が直したものかもしれないので触らない
      tally.kept += 1;
      continue;
    }
    console.log(`  ${category.nameJa ?? category.nameOriginal} → ${def.label}`);
    tally.set += 1;
    if (write) {
      await prisma.regulationCategory.update({
        where: { id: category.id },
        data: { numberLabel: def.label },
      });
    }
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  入れる            : ${tally.set}件`);
  console.log(`  既に入っている    : ${tally.kept}件`);
  console.log(`  区分が見つからない: ${tally.missing}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
