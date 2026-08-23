/**
 * 化審法のマスタ（法令・区分・分類・法文物質名）を投入する。
 *
 * 中身は `scripts/data/kasinho.json`。NITE の J-CHECK が公表している一覧を
 * 機械的に取り出したもので、書き写しは挟んでいない。
 * CASリンクは入れない（どの情報源を採るかは利用者が決めるため）。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-kasinho.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-kasinho.ts --remove
 *
 * 何度流しても同じ結果になるよう、先に法令コード JP-CSCL の一式を消してから入れる。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const LAW_CODE = "JP-CSCL";
const COUNTRY_CODE = "JPN";

interface Entry {
  number: string;
  /** 官報公示整理番号。優先評価・特定一般の一覧にだけ載っている */
  gazette?: string;
  name: string;
}
interface Group {
  label: string;
  order: number;
  items: Entry[];
}

const prisma = new PrismaClient();

/** 判定に使う閾値。化審法に裾切値は無いので「含有すれば該当」 */
const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

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
    console.log(`化審法を削除しました（法文物質名 ${gone} 件）`);
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
      nameOriginal: "化学物質の審査及び製造等の規制に関する法律",
      nameLang: "JA",
      nameJa: "化審法",
      nameEn:
        "Act on the Evaluation of Chemical Substances and Regulation of Their Manufacture, etc.",
      displayOrder: 10,
      note: "一覧の出どころ: NITE J-CHECK（化審法対象物質リスト）",
    },
  });

  const groups = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/kasinho.json"), "utf-8"),
  ) as Record<string, Group>;

  let total = 0;
  for (const [key, group] of Object.entries(groups)) {
    const category = await prisma.regulationCategory.create({
      data: {
        code: key,
        codeNormalized: key,
        lawId: law.id,
        nameOriginal: group.label,
        nameLang: "JA",
        displayOrder: group.order,
        ...THRESHOLD,
      },
    });

    // 区分は分けないので、名前のない分類を1件だけ置く（法文物質名の親になる）
    const cls = await prisma.regulationClass.create({
      data: {
        code: "DEFAULT",
        codeNormalized: "DEFAULT",
        categoryId: category.id,
        displayOrder: 0,
      },
    });

    await prisma.statutorySubstance.createMany({
      data: group.items.map((e) => ({
        code: `${LAW_CODE}-${key}-${e.number.padStart(4, "0")}`,
        codeNormalized: `${LAW_CODE}-${key}-${e.number.padStart(4, "0")}`,
        classId: cls.id,
        officialNumber: e.number,
        nameOriginal: e.name,
        nameLang: "JA",
        displayOrder: Number(e.number),
        ...THRESHOLD,
        // 官報公示整理番号は物質側に属する値なので、いまは覚え書きとして残すだけにする
        note: e.gazette ? `官報公示整理番号: ${e.gazette}` : null,
      })),
    });

    total += group.items.length;
    console.log(`${group.label}: ${group.items.length} 件`);
  }
  console.log(`合計 ${total} 件を入れました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
