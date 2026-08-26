/**
 * 安衛法の法文物質名を、法令の原文に合わせて直す。
 *
 *   npx tsx scripts/fix-anei.ts          下見
 *   npx tsx scripts/fix-anei.ts --write  書き込む
 *
 * **原文が最も正しい。**取り込みに使った厚生労働省の一覧は、
 * 告示の裾切値まで載っている使いやすい資料だが、二次資料であり、
 * 原文の改正に遅れることがある（`docs/法規制データの作り方.md` 第3章）。
 *
 * ここで直すのは、原文（e-Gov 法令API）と突き合わせて見つかった食い違い。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 原文で「削除」になっている項。厚生労働省の一覧にはまだ残っていた */
interface Removal {
  /** 安衛則別表第2 の項番号 */
  number: string;
  name: string;
  why: string;
}

const REMOVALS: Removal[] = [
  {
    number: "1129",
    name: "ステアリン酸ナトリウム",
    why: "安衛則別表第2 第1129項は原文で「削除」。前後は1128スチレン・1130ステアリン酸鉛で、五十音順の位置も合う",
  },
  {
    number: "2268",
    name: "りん酸トリフェニル",
    why: "安衛則別表第2 第2268項は原文で「削除」。前後は2267りん酸トリ―ノルマル―ブチル・2269りん酸トリメチル",
  },
];

/** 裾切値の直し */
interface ThresholdFix {
  category: string;
  /** 直す対象。番号で選ぶ */
  numbers: string[];
  lower: string;
  why: string;
}

const THRESHOLDS: ThresholdFix[] = [
  {
    category: "MFG_PERMIT",
    numbers: ["1", "2", "3", "4", "5", "6"],
    lower: "1",
    why: "令別表第三第一号8「1から6までに掲げる物をその重量の一パーセントを超えて含有し…」。裾切値は原文にある",
  },
  {
    category: "MFG_PERMIT",
    numbers: ["7"],
    lower: "0.5",
    why: "令別表第三第一号8「…又は7に掲げる物をその重量の〇・五パーセントを超えて含有する製剤その他の物」",
  },
];

/**
 * 名前の直し。
 *
 * 製造許可の7件は、特化則第1類と**同じ令別表第三第一号**から来るのに、
 * 取り込み元が違ったせいで表記が割れていた。原文（＝第1類の側）に揃える。
 * 法令の原文は昭和期の書き方で、拗音を小書きにしない（`フア` `フエ`）
 */
interface NameFix {
  category: string;
  number: string;
  to: string;
}

const NAMES: NameFix[] = [
  { category: "MFG_PERMIT", number: "2", to: "アルフア―ナフチルアミン及びその塩" },
  { category: "MFG_PERMIT", number: "3", to: "塩素化ビフエニル（別名ＰＣＢ）" },
  { category: "MFG_PERMIT", number: "4", to: "オルト―トリジン及びその塩" },
];

const NAME_WHY = "令別表第三第一号の原文どおりにする。同じ号から作る特化則第1類と表記を揃える";

const PERMIT_NOTE =
  "安衛法第56条・令第17条。対象は令別表第三第一号の第1類物質。" +
  "裾切値は同号8（1〜6は1％超、7は0.5％超。合金はベリリウム3％超）";

async function main() {
  const write = process.argv.includes("--write");
  const tally = { removed: 0, threshold: 0, name: 0, missing: 0 };

  console.log("=== 原文で「削除」になった項を外す ===");
  for (const r of REMOVALS) {
    for (const category of ["LABEL", "SDS"]) {
      const rows = await prisma.statutorySubstance.findMany({
        where: {
          deletedAt: null,
          officialNumber: r.number,
          regulationClass: { category: { code: category, law: { code: "JP-ISHA" } } },
        },
        select: { id: true, nameOriginal: true, _count: { select: { links: true } } },
      });
      if (rows.length === 0) {
        console.log(`  － ${category} ${r.number}項 は既に外れています`);
        tally.missing += 1;
        continue;
      }
      for (const row of rows) {
        console.log(
          `  ${category} [${r.number}] ${row.nameOriginal}  CASリンク=${row._count.links}件`,
        );
        console.log(`    理由: ${r.why}`);
        tally.removed += 1;
        if (write) {
          await prisma.statutorySubstance.update({
            where: { id: row.id },
            data: { deletedAt: new Date(), note: `原文で削除。${r.why}` },
          });
        }
      }
    }
  }

  console.log("\n=== 裾切値を原文どおりにする ===");
  for (const t of THRESHOLDS) {
    const rows = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        officialNumber: { in: t.numbers },
        regulationClass: { category: { code: t.category, law: { code: "JP-ISHA" } } },
      },
      select: {
        id: true,
        officialNumber: true,
        nameOriginal: true,
        thresholdLower: true,
        lowerBound: true,
      },
      orderBy: { displayOrder: "asc" },
    });
    for (const row of rows) {
      const before = `${row.lowerBound === "EXCLUSIVE" ? ">" : ">="}${row.thresholdLower}`;
      if (before === `>${t.lower}`) {
        console.log(`  － ${t.category} [${row.officialNumber}] は既に ${before}`);
        continue;
      }
      console.log(
        `  ${t.category} [${row.officialNumber}] ${row.nameOriginal.slice(0, 30)}  ${before} → >${t.lower}`,
      );
      console.log(`    理由: ${t.why}`);
      tally.threshold += 1;
      if (write) {
        await prisma.statutorySubstance.update({
          where: { id: row.id },
          data: { thresholdLower: t.lower, lowerBound: "EXCLUSIVE" },
        });
      }
    }
  }

  console.log("\n=== 名前を原文どおりにする ===");
  for (const f of NAMES) {
    const rows = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        officialNumber: f.number,
        regulationClass: { category: { code: f.category, law: { code: "JP-ISHA" } } },
      },
      select: { id: true, nameOriginal: true, nameJa: true },
    });
    for (const row of rows) {
      if (row.nameOriginal === f.to) {
        console.log(`  － ${f.category} [${f.number}] は既に原文どおり`);
        continue;
      }
      console.log(`  ${f.category} [${f.number}]`);
      console.log(`    前: ${row.nameOriginal}`);
      console.log(`    後: ${f.to}`);
      console.log(`    理由: ${NAME_WHY}`);
      tally.name += 1;
      if (write) {
        await prisma.statutorySubstance.update({
          where: { id: row.id },
          // 名前は name_original に入っている。name_ja は空のことが多い
          data: { nameOriginal: f.to, ...(row.nameJa ? { nameJa: f.to } : {}) },
        });
      }
    }
  }

  if (write) {
    await prisma.regulationCategory.updateMany({
      where: { code: "MFG_PERMIT", law: { code: "JP-ISHA" } },
      data: { note: PERMIT_NOTE },
    });
  }
  console.log(`\n  区分 MFG_PERMIT の note → ${PERMIT_NOTE}`);

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  外す      : ${tally.removed}件`);
  console.log(`  裾切値    : ${tally.threshold}件`);
  console.log(`  名前      : ${tally.name}件`);
  console.log(`  対象なし  : ${tally.missing}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
