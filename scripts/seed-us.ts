/**
 * 米国の法規制（EPCRA 第313条 / TSCA 第6条）を入れる。
 *
 *   bash scripts/us-fetch.sh                       先に原文を落とす
 *   npx tsx scripts/build-us-data.ts --write       データを作る
 *   npx tsx scripts/seed-us.ts                     入れる（入れ直し）
 *   npx tsx scripts/seed-us.ts --remove            消す
 *
 * **CASリンクも原文から作る。**CFR は法文物質名と CAS を同じ表に載せているので、
 * 外部データベースが要らない（第8章 8-9）。日本・中国とはここが違う。
 *
 * リンクのデータソースは `CFR`。LOLI とは分けて持つので、
 * どちらが言っていることかが後から分かる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface UsItem {
  law: string;
  section: string;
  number: string;
  name: string;
  cas: string;
  note: string;
}

/** 含有すれば該当。EPCRA の報告閾値は取扱量（トン）で、含有率ではない */
const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

interface LawDef {
  code: string;
  nameOriginal: string;
  nameJa: string;
  order: number;
  note: string;
  categories: { code: string; name: string; nameJa: string; order: number; note: string }[];
}

const LAWS: LawDef[] = [
  {
    code: "US-EPCRA",
    nameOriginal: "Emergency Planning and Community Right-to-Know Act",
    nameJa: "緊急計画及び地域住民の知る権利法（EPCRA）",
    order: 100,
    note: "一覧の出どころ: eCFR（40 CFR 372.65）",
    categories: [
      {
        code: "TRI",
        name: "Section 313 Toxic Chemicals (TRI)",
        nameJa: "第313条 有害化学物質（TRI / SARA 313）",
        order: 10,
        note: "EPCRA 第313条・40 CFR 372.65。(a)個別物質と(d)PFASを収載。**(c)の chemical categories は eCFR では画像で、まだ取れていない**",
      },
    ],
  },
  {
    code: "US-TSCA",
    nameOriginal: "Toxic Substances Control Act",
    nameJa: "有害物質規制法（TSCA）",
    order: 110,
    note: "一覧の出どころ: eCFR（40 CFR 751）",
    categories: [
      {
        code: "SEC6",
        name: "Section 6 Restricted Substances",
        nameJa: "第6条 規制物質",
        order: 10,
        note: "TSCA 第6条・40 CFR 751。物質ごとに subpart が分かれ、製造・加工・流通・使用が禁止または制限される",
      },
    ],
  },
];

const COUNTRY = { code: "USA", nameJa: "アメリカ", nameEn: "United States" };

async function removeLaw(code: string): Promise<number> {
  const law = await prisma.law.findFirst({ where: { codeNormalized: code } });
  if (!law) return 0;
  const classes = await prisma.regulationClass.findMany({
    where: { category: { lawId: law.id } },
    select: { id: true },
  });
  await prisma.statutoryCasLink.deleteMany({
    where: { statutorySubstance: { classId: { in: classes.map((c) => c.id) } } },
  });
  const removed = await prisma.statutorySubstance.deleteMany({
    where: { classId: { in: classes.map((c) => c.id) } },
  });
  await prisma.regulationClass.deleteMany({ where: { category: { lawId: law.id } } });
  await prisma.regulationCategory.deleteMany({ where: { lawId: law.id } });
  await prisma.law.delete({ where: { id: law.id } });
  return removed.count;
}

async function main() {
  const remove = process.argv.includes("--remove");

  let gone = 0;
  for (const l of LAWS) gone += await removeLaw(l.code);
  if (remove) {
    console.log(`米国の法規制を削除しました（法文物質名 ${gone}件）`);
    await prisma.$disconnect();
    return;
  }
  if (gone > 0) console.log(`前回のぶんを消しました（法文物質名 ${gone}件）`);

  const country = await prisma.country.findFirst({
    where: { codeNormalized: COUNTRY.code, deletedAt: null },
  });
  if (!country) throw new Error(`国「${COUNTRY.code}」がありません`);

  const items = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/us.json"), "utf-8"),
  ) as UsItem[];

  let total = 0;
  for (const l of LAWS) {
    const law = await prisma.law.create({
      data: {
        code: l.code,
        codeNormalized: l.code,
        countryId: country.id,
        nameOriginal: l.nameOriginal,
        nameLang: "EN",
        nameJa: l.nameJa,
        nameEn: l.nameOriginal,
        displayOrder: l.order,
        note: l.note,
      },
    });

    for (const c of l.categories) {
      const category = await prisma.regulationCategory.create({
        data: {
          code: c.code,
          codeNormalized: c.code,
          lawId: law.id,
          nameOriginal: c.name,
          nameLang: "EN",
          nameJa: c.nameJa,
          nameEn: c.name,
          displayOrder: c.order,
          note: c.note,
          ...THRESHOLD,
        },
      });
      const cls = await prisma.regulationClass.create({
        data: {
          code: "DEFAULT",
          codeNormalized: "DEFAULT",
          categoryId: category.id,
          displayOrder: 0,
        },
      });

      const mine = items.filter((i) => i.law === l.code && i.section === c.code);
      for (const [i, e] of mine.entries()) {
        const code = `${l.code}-${c.code}-${e.number}`;
        await prisma.statutorySubstance.create({
          data: {
            code,
            codeNormalized: code.toUpperCase(),
            classId: cls.id,
            officialNumber: e.number,
            nameOriginal: e.name,
            nameLang: "EN",
            nameEn: e.name,
            displayOrder: i + 1,
            note: e.note,
            ...THRESHOLD,
          },
        });
      }
      console.log(`  ${l.nameJa} ${c.nameJa}: ${mine.length}件`);
      total += mine.length;
    }
  }
  console.log(`\n合計 ${total}件を入れました（CASリンクは LOLI から）`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
