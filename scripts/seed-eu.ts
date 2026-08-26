/**
 * EU の法規制（REACH 候補リスト／附属書XIV／附属書XVII、CLP 附属書VI）を入れる。
 *
 *   npx tsx scripts/build-eu-data.ts --write   先にデータを作る
 *   npx tsx scripts/seed-eu.ts                 入れる（入れ直し）
 *   npx tsx scripts/seed-eu.ts --remove        消す
 *
 * **CASリンクは作らない。**判定に使う CAS は LOLI から取る（第0章）。
 * 法律が示す CAS は、番号の欄か法文物質名の側に持たせてある（第8章 8-8）。
 *
 * 以前は ECHA を出どころとするリンクを作っていたが、
 * **出どころが2つあると、どちらで判定したのか分からなくなる**のでやめた。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface EuItem {
  law: string;
  section: string;
  number: string;
  name: string;
  ec: string;
  cas: string[];
  note: string;
}

/** 含有すれば該当。SVHC の 0.1％ は成形品の届出の話で、SDS の記載はこの限りでない */
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
    code: "EU-REACH",
    nameOriginal:
      "Regulation (EC) No 1907/2006 concerning the Registration, Evaluation, Authorisation and Restriction of Chemicals",
    nameJa: "REACH規則",
    order: 120,
    note: "一覧の出どころ: ECHA（候補リスト／認可対象物質リスト／制限物質リスト）",
    categories: [
      {
        code: "SVHC",
        name: "Candidate List of substances of very high concern",
        nameJa: "高懸念物質（SVHC）候補リスト",
        order: 10,
        note: "REACH 第59条。成形品では0.1重量％を超えると届出・情報伝達の義務がかかる。番号は EC番号（無ければCAS）",
      },
      {
        code: "ANNEX14",
        name: "Authorisation List (Annex XIV)",
        nameJa: "認可対象物質（附属書XIV）",
        order: 20,
        note: "REACH 第58条・附属書XIV。日没日を過ぎると認可なしでは上市・使用できない。番号は附属書の entry 番号",
      },
      {
        code: "ANNEX17",
        name: "Restrictions (Annex XVII)",
        nameJa: "制限物質（附属書XVII）",
        order: 30,
        note: "REACH 第67条・附属書XVII。用途ごとに条件が付く。番号は附属書の entry 番号。条件の全文は ECHA を見る",
      },
    ],
  },
  {
    code: "EU-CLP",
    nameOriginal:
      "Regulation (EC) No 1272/2008 on classification, labelling and packaging of substances and mixtures",
    nameJa: "CLP規則",
    order: 130,
    note: "一覧の出どころ: ECHA が配る附属書VI 表3の Excel（annex_vi_clp_table_atpNN_en.xlsx）",
    categories: [
      {
        code: "ANNEX6",
        name: "Harmonised classification (Annex VI Table 3)",
        nameJa: "調和分類（附属書VI 表3）",
        order: 10,
        note: "CLP 第36条・附属書VI 表3。EU 全域で分類が決められている物質。番号は Index No（001-001-00-9）。**まだ施行されていない改正（ATP）のぶんも含む**ので、採否は note の ATP を見て決める",
      },
    ],
  },
];

const COUNTRY_CODE = "EU";

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
    console.log(`EUの法規制を削除しました（法文物質名 ${gone}件）`);
    await prisma.$disconnect();
    return;
  }
  if (gone > 0) console.log(`前回のぶんを消しました（法文物質名 ${gone}件）`);

  const country = await prisma.country.findFirst({
    where: { codeNormalized: COUNTRY_CODE, deletedAt: null },
  });
  if (!country) throw new Error(`国「${COUNTRY_CODE}」がありません`);

  const items = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/eu.json"), "utf-8"),
  ) as EuItem[];

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
      const used = new Map<string, number>();
      const rows = mine.map((e, i) => {
        // 番号が重なることがある（候補リストは EC番号が `-` のものがある）
        const base = `${l.code}-${c.code}-${e.number}`.slice(0, 46);
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        return { id: randomUUID(), code: n === 1 ? base : `${base}-${n}`, order: i + 1, e };
      });

      await prisma.statutorySubstance.createMany({
        data: rows.map((r) => ({
          id: r.id,
          code: r.code,
          codeNormalized: r.code.toUpperCase(),
          classId: cls.id,
          officialNumber: r.e.number.slice(0, 50),
          nameOriginal: r.e.name,
          nameLang: "EN",
          nameEn: r.e.name,
          displayOrder: r.order,
          note: [r.e.ec && `EC No. ${r.e.ec}`, r.e.note].filter(Boolean).join(" / ") || null,
          ...THRESHOLD,
        })),
      });

      console.log(`  ${c.nameJa}: ${mine.length}件`);
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
