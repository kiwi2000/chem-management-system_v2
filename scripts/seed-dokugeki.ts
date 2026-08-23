/**
 * 毒劇法のマスタ（法令・区分・分類・法文物質名）を投入する。
 *
 * 中身は `scripts/data/dokugeki.json`。e-Gov の法令APIから
 *   毒物及び劇物取締法（昭和25年法律第303号）別表第一〜第三
 *   毒物及び劇物指定令（昭和40年政令第2号）第1条〜第3条
 * を機械的に取り出したもので、書き写しは挟んでいない。
 *
 * 区分は 毒物・劇物・特定毒物 の3つ。法別表と指定令は規制の中身が同じなので
 * 分類では分けず、どちらから来たかは備考とコードで分かるようにしてある。
 * 「ただし〜を除く」の除外は物質ごとに文言が違い判定に使えないため、備考に残すだけ。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-dokugeki.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-dokugeki.ts --remove
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const LAW_CODE = "JP-PDSCA";
const COUNTRY_CODE = "JPN";

interface Entry {
  /** TOX=毒物 DEL=劇物 SPT=特定毒物 */
  section: "TOX" | "DEL" | "SPT";
  /** L=法律の別表 O=指定令 */
  src: "L" | "O";
  /** 法令上の号。枝番は「1-2」の形 */
  number: string;
  name: string;
  note: string;
}

const prisma = new PrismaClient();

/** 毒物・劇物は含有すれば該当。除外は物質ごとの但し書きなので閾値では表せない */
const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

const CATEGORIES = [
  { code: "TOX", name: "毒物", order: 10 },
  { code: "DEL", name: "劇物", order: 20 },
  { code: "SPT", name: "特定毒物", order: 30 },
] as const;

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

async function main() {
  const remove = process.argv.includes("--remove");
  const gone = await removeAll();
  if (remove) {
    console.log(`毒劇法を削除しました（法文物質名 ${gone} 件）`);
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
      nameOriginal: "毒物及び劇物取締法",
      nameLang: "JA",
      nameJa: "毒劇法",
      nameEn: "Poisonous and Deleterious Substances Control Act",
      displayOrder: 40,
      note: "一覧の出どころ: e-Gov 法令API（法別表第一〜第三、毒物及び劇物指定令第1条〜第3条）",
    },
  });

  const entries = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/dokugeki.json"), "utf-8"),
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
        ...THRESHOLD,
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

    const rows = entries
      .filter((e) => e.section === c.code)
      .map((e, i) => {
        const code = `${LAW_CODE}-${e.section}-${e.src}-${e.number}`;
        return {
          code,
          codeNormalized: code,
          classId: cls.id,
          officialNumber: e.number,
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
