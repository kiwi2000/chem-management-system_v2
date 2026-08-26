/**
 * 規制区分の `note` に、**その区分がどの条文で決まるか**を入れる。
 *
 *   npx tsx scripts/seed-category-notes.ts          下見
 *   npx tsx scripts/seed-category-notes.ts --write  書き込む
 *
 * 画面に出る説明であり、データを作り直すときの典拠でもある。
 * 中身は `docs/法規制データの作り方.md` 第8章の表と同じ。**片方だけ直さない。**
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Note {
  law: string;
  category: string;
  note: string;
}

const NOTES: Note[] = [
  // 化審法 ------------------------------------------------------------------
  {
    law: "JP-CSCL",
    category: "C1",
    note: "化審法第2条第2項・施行令第1条。40号。裾切値は無く、含有すれば該当",
  },
  {
    law: "JP-CSCL",
    category: "C2",
    note: "化審法第2条第3項・施行令第2条。24号。裾切値は無い",
  },
  {
    law: "JP-CSCL",
    category: "MON",
    note: "化審法第2条第4項。政令には載らず、厚生労働・経済産業・環境の三大臣が指定して公示する。一覧は NITE の J-CHECK",
  },
  {
    law: "JP-CSCL",
    category: "PRI",
    note: "化審法第2条第5項。三大臣が指定・公示。一覧は NITE の J-CHECK",
  },
  {
    law: "JP-CSCL",
    category: "SGN",
    note: "化審法第2条第8項。一般化学物質のうち要件に当たるもの。一覧は NITE の J-CHECK",
  },

  // 安衛法 ------------------------------------------------------------------
  {
    law: "JP-ISHA",
    category: "MFG_BAN",
    note: "安衛法第55条・令第16条第1項1〜8号。製造・輸入・譲渡・提供・使用が禁止される。裾切値は同項9号（石綿は0.1％超、他は1％超）",
  },
  {
    law: "JP-ISHA",
    category: "MFG_PERMIT",
    note: "安衛法第56条・令第17条。対象は令別表第三第一号の第1類物質。裾切値は同号8（1〜6は1％超、7は0.5％超。合金はベリリウム3％超）",
  },
  {
    law: "JP-ISHA",
    category: "SPEC1",
    note: "特化則第2条第1項第1号。令別表第三第一号。製造には厚生労働大臣の許可が要る",
  },
  {
    law: "JP-ISHA",
    category: "SPEC2",
    note: "特化則第2条第1項第2号。令別表第三第二号。裾切値は同号37を受けた特化則別表第一",
  },
  {
    law: "JP-ISHA",
    category: "SPEC3",
    note: "特化則第2条第1項第6号。令別表第三第三号。裾切値は同号9を受けた特化則別表第二（フェノールだけ5％超、他は1％超）",
  },
  {
    law: "JP-ISHA",
    category: "SPEC_MGMT",
    note: "特化則第38条の4。第1類と第2類の一部にかかる上乗せの指定なので、そちらにも同じ物質が入っている",
  },
  {
    law: "JP-ISHA",
    category: "ORG",
    note: "有機則第1条・令別表第六の二。55号のうち10号は削除、55号は混合物。5パーセントを超えて含有するものが有機溶剤含有物になる",
  },
  {
    law: "JP-ISHA",
    category: "LABEL",
    note: "安衛法第57条・令第18条。1号は令別表第九（33号の総称）、2号は安衛則第30条を受けた安衛則別表第2。裾切値は令第18条3号の「厚生労働大臣の定める基準」＝告示にあり、条文には載らない",
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    note: "安衛法第57条の2・令第18条の2。物質は表示対象と同じ（安衛則第34条の2）。裾切値は令第18条の2 3号の告示で、表示とは値が違う",
  },

  // 毒劇法 ------------------------------------------------------------------
  {
    law: "JP-PDSCA",
    category: "TOX",
    note: "毒劇法第2条第1項。法別表第一（28号）と毒物及び劇物指定令第1条（106号）の2か所に分かれる。裾切値は号ごとの但し書き",
  },
  {
    law: "JP-PDSCA",
    category: "DEL",
    note: "毒劇法第2条第2項。法別表第二（94号）と指定令第2条（340号）の2か所。裾切値は号ごとの但し書き",
  },
  {
    law: "JP-PDSCA",
    category: "SPT",
    note: "毒劇法第2条第3項。法別表第三（10号）と指定令第3条（10号）の2か所",
  },

  // 化管法 ------------------------------------------------------------------
  {
    law: "JP-PRTR",
    category: "C1",
    note: "化管法第2条第2項・令第1条・令別表第一（515号）。裾切値は令第5条で1％以上（「超え」ではない）。令第4条第1項第1号イが19号の元素換算を定める",
  },
  {
    law: "JP-PRTR",
    category: "SC1",
    note: "令第4条第1項第1号イの括弧書きが、別表第一の23号を名指しする。第一種にも同じ物質が入っており、裾切値だけが違う（令第5条で0.1％以上）。同号ロが6号の元素換算を定める",
  },
  {
    law: "JP-PRTR",
    category: "C2",
    note: "化管法第2条第4項・令第2条・令別表第二（134号）。裾切値は令第6条で1％以上",
  },
];

async function main() {
  const write = process.argv.includes("--write");
  let changed = 0;
  let same = 0;
  let missing = 0;

  for (const n of NOTES) {
    const cat = await prisma.regulationCategory.findFirst({
      where: { code: n.category, law: { code: n.law } },
      select: { id: true, nameJa: true, note: true },
    });
    if (!cat) {
      console.log(`  ✗ ${n.law} ${n.category} が見つかりません`);
      missing += 1;
      continue;
    }
    if (cat.note === n.note) {
      same += 1;
      continue;
    }
    console.log(`  ${n.law} ${n.category}（${cat.nameJa ?? ""}）`);
    console.log(`    前: ${cat.note ?? "（なし）"}`);
    console.log(`    後: ${n.note}`);
    changed += 1;
    if (write) {
      await prisma.regulationCategory.update({ where: { id: cat.id }, data: { note: n.note } });
    }
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  直す        : ${changed}件`);
  console.log(`  変わらない  : ${same}件`);
  console.log(`  見つからない: ${missing}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
