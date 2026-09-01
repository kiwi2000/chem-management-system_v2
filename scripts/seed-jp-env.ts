/**
 * 環境系4法（大気汚染防止法・水質汚濁防止法・土壌汚染対策法・化学兵器禁止法）を入れる。
 *
 *   npx tsx scripts/build-jp-env-data.ts --write   先に条文からデータを作る
 *   npx tsx scripts/seed-jp-env.ts                 入れる（入れ直し）
 *   npx tsx scripts/seed-jp-env.ts --remove        消す
 *
 * 中身は `scripts/data/jp-env.json`。条文から機械的に取り出したもので、
 * 書き写しは挟んでいない（第8章 8-5、第12章 12-2）。
 *
 * **裾切値は入れない。**この4法は「排出するとき」の規制で、
 * 含有率で該非が決まる作りになっていない。SDS では「該当する」ことだけを書くので、
 * **0を超えて含めば該当**にしてある。
 *
 * **CASリンクは入れない。**どの情報源を採るかは利用者が決める（第0章）。
 * 総称が多い（「カドミウム及びその化合物」）ので、LOLI から結ぶ（第4章）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { kanjiCount } from "./lib/kanji-count";
import { statutoryNumber } from "./lib/statutory-number";

const prisma = new PrismaClient();

/**
 * 番号の作り方（第0-3章）。
 *
 * 化学兵器禁止法だけ形が違う。別表の**第三欄（毒性物質）と第四欄（原料物質）**に
 * それぞれ (1)(2)… と並ぶので、欄の番号を出典として入れる
 */
const SPEC: Record<string, { kind: "orderArticle" | "orderTable"; table: string }> = {
  "JP-APA/HAZARD": { kind: "orderArticle", table: "1" },
  "JP-APA/DUST": { kind: "orderArticle", table: "2の4" },
  "JP-WPCA/HAZARD": { kind: "orderArticle", table: "2" },
  "JP-WPCA/DESIGNATED": { kind: "orderArticle", table: "3の3" },
  "JP-SCCA/SPECIFIED": { kind: "orderArticle", table: "1" },
};

function numberOf(law: string, section: string, num: string): string {
  if (law === "JP-CWCA") {
    // `3-一` = 別表の第三欄の(1)、`4-一` = 第四欄の(1)。
    // **算用数字にそろえる。**ほかの法令の番号と書き方を合わせ、LOLI の refno（`01`）とも当たる
    const [col, n] = num.split("-");
    return statutoryNumber({ kind: "orderTableColumn", table: col }, String(kanjiCount(n)));
  }
  const spec = SPEC[`${law}/${section}`];
  return spec ? statutoryNumber(spec, num) : statutoryNumber({ kind: "plain" }, num);
}
const COUNTRY_CODE = "JPN";

interface EnvItem {
  law: string;
  section: string;
  number: string;
  name: string;
  note: string;
}

/** 含有すれば該当。裾切値を持たない */
const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

interface CategoryDef {
  code: string;
  name: string;
  order: number;
  note: string;
}

interface LawDef {
  code: string;
  nameOriginal: string;
  nameJa: string;
  nameEn: string;
  order: number;
  note: string;
  categories: CategoryDef[];
}

const LAWS: LawDef[] = [
  {
    code: "JP-APA",
    nameOriginal: "大気汚染防止法",
    nameJa: "大気汚染防止法",
    nameEn: "Air Pollution Control Act",
    order: 60,
    note: "一覧の出どころ: e-Gov 法令API（大気汚染防止法施行令 第1条・第2条の4）",
    categories: [
      {
        code: "HAZARD",
        name: "有害物質",
        order: 10,
        note: "大気汚染防止法第2条第1項第3号・施行令第1条。5号。ばい煙として排出が規制される",
      },
      {
        code: "DUST",
        name: "特定粉じん",
        order: 20,
        note: "大気汚染防止法第2条第8項・施行令第2条の4。石綿のみ",
      },
    ],
  },
  {
    code: "JP-WPCA",
    nameOriginal: "水質汚濁防止法",
    nameJa: "水質汚濁防止法",
    nameEn: "Water Pollution Prevention Act",
    order: 70,
    note: "一覧の出どころ: e-Gov 法令API（水質汚濁防止法施行令 第2条・第3条の3）",
    categories: [
      {
        code: "HAZARD",
        name: "有害物質",
        order: 10,
        note: "水質汚濁防止法第2条第2項第1号・施行令第2条。28号。排出水の規制がかかる",
      },
      {
        code: "DESIGNATED",
        name: "指定物質",
        order: 20,
        note: "水質汚濁防止法第2条第4項・施行令第3条の3。60号。事故時の措置の対象",
      },
    ],
  },
  {
    code: "JP-SCCA",
    nameOriginal: "土壌汚染対策法",
    nameJa: "土壌汚染対策法",
    nameEn: "Soil Contamination Countermeasures Act",
    order: 80,
    note: "一覧の出どころ: e-Gov 法令API（土壌汚染対策法施行令 第1条）",
    categories: [
      {
        code: "SPECIFIED",
        name: "特定有害物質",
        order: 10,
        note: "土壌汚染対策法第2条第1項・施行令第1条。26号",
      },
    ],
  },
  {
    code: "JP-CWCA",
    nameOriginal: "化学兵器の禁止及び特定物質の規制等に関する法律",
    nameJa: "化学兵器禁止法",
    nameEn: "Act on the Prohibition of Chemical Weapons and the Regulation of Specific Chemicals",
    order: 90,
    note: "一覧の出どころ: e-Gov 法令API（化学兵器禁止法施行令 別表）",
    categories: [
      {
        code: "SPECIFIED",
        name: "特定物質",
        order: 10,
        note: "化学兵器禁止法第2条第1項・施行令別表 一の項。第三欄が毒性物質、第四欄が原料物質。製造・使用・輸出入に許可が要る",
      },
      {
        code: "DESIG1",
        name: "第1種指定物質",
        order: 20,
        note: "施行令別表 二の項。製造数量の届出などがかかる",
      },
      {
        code: "DESIG2",
        name: "第2種指定物質",
        order: 30,
        note: "施行令別表 三の項",
      },
    ],
  },
];

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
    console.log(`環境系4法を削除しました（法文物質名 ${gone}件）`);
    await prisma.$disconnect();
    return;
  }
  if (gone > 0) console.log(`前回のぶんを消しました（法文物質名 ${gone}件）`);

  const country = await prisma.country.findFirst({
    where: { codeNormalized: COUNTRY_CODE, deletedAt: null },
  });
  if (!country) throw new Error(`国「${COUNTRY_CODE}」がありません`);

  const items = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/jp-env.json"), "utf-8"),
  ) as EnvItem[];

  let total = 0;
  for (const l of LAWS) {
    const law = await prisma.law.create({
      data: {
        code: l.code,
        codeNormalized: l.code,
        countryId: country.id,
        nameOriginal: l.nameOriginal,
        nameLang: "JA",
        nameJa: l.nameJa,
        nameEn: l.nameEn,
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
          nameLang: "JA",
          displayOrder: c.order,
          note: c.note,
          ...THRESHOLD,
        },
      });
      // 区分は必ず分類を1件持つ。ここでは分けないので受け皿だけ
      const cls = await prisma.regulationClass.create({
        data: {
          code: "DEFAULT",
          codeNormalized: "DEFAULT",
          categoryId: category.id,
          displayOrder: 0,
        },
      });

      const mine = items.filter((i) => i.law === l.code && i.section === c.code);
      const rows = mine.map((e, i) => {
        const code = `${l.code}-${c.code}-${e.number}`;
        return {
          code,
          codeNormalized: code,
          classId: cls.id,
          officialNumber: numberOf(l.code, c.code, e.number),
          nameOriginal: e.name,
          nameLang: "JA",
          displayOrder: i + 1,
          note: e.note,
          ...THRESHOLD,
        };
      });
      for (let i = 0; i < rows.length; i += 500) {
        await prisma.statutorySubstance.createMany({ data: rows.slice(i, i + 500) });
      }
      console.log(`  ${l.nameJa} ${c.name}: ${rows.length}件`);
      total += rows.length;
    }
  }
  console.log(`\n合計 ${total}件を入れました`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
