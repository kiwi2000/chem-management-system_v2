/**
 * 化管法のマスタ（法令・区分・分類・法文物質名）を投入する。
 *
 * 中身は `scripts/data/kakanho.json`。e-Gov の法令APIから
 *   化管法施行令（平成12年政令第138号）別表第一・別表第二
 * を機械的に取り出したもので、書き写しは挟んでいない。
 * 特定第一種指定化学物質は、同令第4条が挙げている別表第一の号番号で選んでいる。
 *
 * 特定第一種は第一種の一部だが、裾切値が 0.1% と厳しくなる。
 * 安衛法の表示対象／通知対象と同じで、区分を2つ立てて同じ物質を両方に入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-kakanho.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-kakanho.ts --remove
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { statutoryNumber } from "./lib/statutory-number";

const LAW_CODE = "JP-PRTR";
const COUNTRY_CODE = "JPN";

interface Entry {
  /** C1=第一種指定化学物質 C2=第二種指定化学物質 */
  section: "C1" | "C2";
  /** 政令の号 */
  number: string;
  name: string;
  note: string;
  /** 第一種のうち特定第一種にあたるもの */
  special: boolean;
}

const prisma = new PrismaClient();

/**
 * 番号の作り方（第0-3章）。第一種・特定第一種は別表第一、第二種は別表第二。
 * **特定第一種は第一種の一部**なので、番号も別表第一のまま
 */
function numberOf(section: string, num: string): string {
  return statutoryNumber({ kind: "orderTable", table: section === "C2" ? "2" : "1" }, num);
}

/** 裾切値は「その値以上で該当」なので下限は以上 */
const threshold = (lower: string) => ({
  thresholdLower: lower,
  lowerBound: "INCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
});

const CATEGORIES = [
  {
    code: "C1",
    name: "第1種指定化学物質",
    order: 10,
    lower: "1",
    pick: (e: Entry) => e.section === "C1",
    note: null,
  },
  {
    code: "SC1",
    name: "特定第1種指定化学物質",
    order: 20,
    lower: "0.1",
    pick: (e: Entry) => e.special,
    note: "第一種のうち発がん性のあるもの。第一種にも同じ物質が入っている（裾切値だけが違う）",
  },
  {
    code: "C2",
    name: "第2種指定化学物質",
    order: 30,
    lower: "1",
    pick: (e: Entry) => e.section === "C2",
    note: null,
  },
] as const;

async function removeAll(): Promise<number> {
  const law = await prisma.law.findFirst({ where: { codeNormalized: LAW_CODE } });
  if (!law) return 0;
  const classes = await prisma.regulationClass.findMany({
    where: { category: { lawId: law.id } },
    select: { id: true },
  });
  // **CASリンクを先に消す。**法文物質名を参照しているので、残っていると消せない
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
  const gone = await removeAll();
  if (remove) {
    console.log(`化管法を削除しました（法文物質名 ${gone} 件）`);
    return;
  }
  if (gone > 0) console.log(`前回のぶんを消しました（法文物質名 ${gone} 件）`);

  const country = await prisma.country.findFirst({
    where: { codeNormalized: COUNTRY_CODE, deletedAt: null },
  });
  if (!country) throw new Error(`国「${COUNTRY_CODE}」がありません。先に国を登録してください`);

  const law = await prisma.law.create({
    data: {
      code: LAW_CODE,
      codeNormalized: LAW_CODE,
      countryId: country.id,
      nameOriginal: "特定化学物質の環境への排出量の把握等及び管理の改善の促進に関する法律",
      nameLang: "JA",
      nameJa: "化管法",
      nameEn:
        "Act on Confirmation, etc. of Release Amounts of Specific Chemical Substances in the Environment and Promotion of Improvements to the Management Thereof",
      displayOrder: 50,
      note: "一覧の出どころ: e-Gov 法令API（化管法施行令 別表第一・別表第二、特定第一種は同令第4条）",
    },
  });

  const entries = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/kakanho.json"), "utf-8"),
  ) as Entry[];

  let total = 0;
  for (const c of CATEGORIES) {
    const category = await prisma.regulationCategory.create({
      data: {
        code: c.code,
        codeNormalized: c.code,
        lawId: law.id,
        nameOriginal: c.name,
        nameLang: "JA",
        displayOrder: c.order,
        note: c.note,
        ...threshold(c.lower),
      },
    });
    // 区分は必ず分類を1件持つ。ここでは分けないので、表示名のない受け皿だけを置く
    const cls = await prisma.regulationClass.create({
      data: {
        code: "DEFAULT",
        codeNormalized: "DEFAULT",
        categoryId: category.id,
        displayOrder: 0,
      },
    });

    const rows = entries.filter(c.pick).map((e, i) => {
      const code = `${LAW_CODE}-${c.code}-${e.number}`;
      return {
        code,
        codeNormalized: code,
        classId: cls.id,
        officialNumber: numberOf(e.section, e.number),
        nameOriginal: e.name,
        nameLang: "JA",
        displayOrder: i + 1,
        note: e.note,
        ...threshold(c.lower),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.statutorySubstance.createMany({ data: rows.slice(i, i + 500) });
    }
    console.log(`${c.name}: ${rows.length} 件`);
    total += rows.length;
  }
  console.log(`合計 ${total} 件を入れました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
