/**
 * 安衛法のマスタ（法令・区分・分類・法文物質名）を投入する。
 *
 * 中身は `scripts/data/anei.json`。厚生労働省「職場のあんぜんサイト」が公表している
 * 「労働安全衛生法に基づくラベル表示・ＳＤＳ交付等の義務対象物質一覧」から
 * 機械的に取り出したもので、書き写しは挟んでいない。
 *
 * 1つの物質が、ラベル表示とSDS交付で**別々の裾切値**を持つ。
 * そのため区分を2つ立て、同じ物質を両方に入れる（閾値は法文物質名の側が持つ）。
 * CASリンクは入れない（どの情報源を採るかは利用者が決めるため）。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-anei.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-anei.ts --remove
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const LAW_CODE = "JP-ISHA";
const COUNTRY_CODE = "JPN";

interface Entry {
  section: "MFG_PERMIT" | "OLD_T9" | "T2";
  /** 法令上の番号 */
  number: string;
  /** まとめ名称の内訳など、同じ番号が続くときの枝番 */
  suffix: string;
  name: string;
  nameEn: string | null;
  /** ラベル表示の裾切値。「－」は対象外 */
  label: string;
  /** SDS交付の裾切値。「－」は対象外 */
  sds: string;
  note: string;
}

const prisma = new PrismaClient();

/**
 * 裾切値は「その値以上で該当」なので下限は以上。
 * 裾切値を持たない区分だけは「0を超えれば該当」にする。
 */
const threshold = (lower: string, includeLower = true) => ({
  thresholdLower: lower,
  lowerBound: includeLower ? ("INCLUSIVE" as const) : ("EXCLUSIVE" as const),
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
});

const NUMERIC = /^\d+(\.\d+)?$/;

async function removeAll(): Promise<number> {
  const law = await prisma.law.findFirst({ where: { codeNormalized: LAW_CODE } });
  if (!law) return 0;
  const classes = await prisma.regulationClass.findMany({
    where: { category: { lawId: law.id } },
    select: { id: true },
  });
  const removed = await prisma.statutorySubstance.deleteMany({
    where: { classId: { in: classes.map((c) => c.id) } },
  });
  await prisma.regulationClass.deleteMany({ where: { category: { lawId: law.id } } });
  await prisma.regulationCategory.deleteMany({ where: { lawId: law.id } });
  await prisma.law.delete({ where: { id: law.id } });
  return removed.count;
}

/** 区分を1つ作り、名前のない分類を1件添えて、その分類のidを返す */
async function makeCategory(
  lawId: string,
  code: string,
  name: string,
  displayOrder: number,
  lower: string,
  note: string | null,
  includeLower = true,
): Promise<string> {
  const category = await prisma.regulationCategory.create({
    data: {
      code,
      codeNormalized: code,
      lawId,
      nameOriginal: name,
      nameLang: "JA",
      displayOrder,
      note,
      ...threshold(lower, includeLower),
    },
  });
  const cls = await prisma.regulationClass.create({
    data: { code: "DEFAULT", codeNormalized: "DEFAULT", categoryId: category.id, displayOrder: 0 },
  });
  return cls.id;
}

async function main() {
  const remove = process.argv.includes("--remove");
  const gone = await removeAll();
  if (remove) {
    console.log(`安衛法を削除しました（法文物質名 ${gone} 件）`);
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
      nameOriginal: "労働安全衛生法",
      nameLang: "JA",
      nameJa: "安衛法",
      nameEn: "Industrial Safety and Health Act",
      displayOrder: 30,
      note: "一覧の出どころ: 厚生労働省「職場のあんぜんサイト」ラベル表示・ＳＤＳ交付等の義務対象物質一覧",
    },
  });

  const entries = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/anei.json"), "utf-8"),
  ) as Entry[];

  const labelClass = await makeCategory(law.id, "LABEL", "表示対象物質", 10, "1", null);
  const sdsClass = await makeCategory(law.id, "SDS", "通知対象物質", 20, "1", null);
  const permitClass = await makeCategory(
    law.id,
    "MFG_PERMIT",
    "製造許可物質",
    30,
    "0",
    "特化則の適用濃度はこの一覧に載っていないため、含有すれば該当として入れてある",
    false,
  );

  /** 区分ごとに、裾切値が数字のものだけを入れる（「－」はその義務の対象外） */
  async function insert(
    classId: string,
    prefix: string,
    pick: (e: Entry) => string | null,
    includeLower = true,
  ) {
    const rows = entries.flatMap((e, i) => {
      const lower = pick(e);
      if (lower === null) return [];
      const code = `${LAW_CODE}-${prefix}-${e.section}-${e.number}${e.suffix}`;
      return [
        {
          code,
          codeNormalized: code,
          classId,
          officialNumber: e.number,
          nameOriginal: e.name,
          nameLang: "JA",
          nameEn: e.nameEn,
          displayOrder: i + 1,
          note: e.note,
          ...threshold(lower, includeLower),
        },
      ];
    });
    // 件数が多いので、まとめて入れる
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.statutorySubstance.createMany({ data: rows.slice(i, i + 500) });
    }
    return rows.length;
  }

  const label = await insert(labelClass, "LABEL", (e) => (NUMERIC.test(e.label) ? e.label : null));
  console.log(`表示対象物質: ${label} 件`);
  const sds = await insert(sdsClass, "SDS", (e) => (NUMERIC.test(e.sds) ? e.sds : null));
  console.log(`通知対象物質: ${sds} 件`);
  const permit = await insert(
    permitClass,
    "PERMIT",
    (e) => (e.section === "MFG_PERMIT" ? "0" : null),
    false,
  );
  console.log(`製造許可物質: ${permit} 件`);
  console.log(`合計 ${label + sds + permit} 件を入れました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
