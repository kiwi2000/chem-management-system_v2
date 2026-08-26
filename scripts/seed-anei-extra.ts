/**
 * 安衛法の残りの区分（特化則・有機則・製造等禁止）を投入する。
 *
 * `seed-anei.ts` で作った法令「安衛法」に足す形なので、先にそちらを流しておくこと。
 * このスクリプトは自分が作る区分だけを消して入れ直す（表示対象・通知対象・製造許可には触らない）。
 *
 * 中身は `scripts/data/anei-extra.json`。e-Gov の法令APIから
 *   労働安全衛生法施行令（昭和47年政令第318号）第16条・別表第三・別表第六の二
 *   特定化学物質障害予防規則（昭和47年労働省令第39号）第2条・第38条の4・別表第一・別表第二
 *   有機溶剤中毒予防規則（昭和47年労働省令第36号）第1条
 * を機械的に取り出したもので、書き写しは挟んでいない。
 *
 * 分けかたの考え方:
 *  - 第2類の中の「特定第2類・特別有機溶剤等・オーラミン等・管理第2類」は
 *    互いに重ならない**分け方**なので分類にした（特化則第2条第5号がそう定義している）
 *  - 有機溶剤の第1種・第2種・第3種も同じく分類
 *  - 特別管理物質は第1類と第2類の一部にまたがる**上乗せの指定**なので、独立した区分にした
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-anei-extra.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-anei-extra.ts --remove
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { statutoryNumber } from "./lib/statutory-number";

const LAW_CODE = "JP-ISHA";

interface Row {
  number: string;
  name: string;
  lower: string;
  note?: string | null;
  klass?: string;
  from?: string;
}
interface Data {
  banned: Row[];
  spec1: Row[];
  spec2: Row[];
  spec3: Row[];
  special: Row[];
  solvent: Row[];
}

/** この区分の中をさらに分けるとき。分けない区分は表示名のない受け皿だけを置く */
interface Split {
  code: string;
  name: string;
}

interface CategoryDef {
  code: string;
  name: string;
  order: number;
  /** 区分の既定の閾値（法文物質名を手で足すときのひな型） */
  lower: string;
  note: string;
  /** 物質の並び。分類ごとに分けるときは klass で振り分ける */
  rows: (d: Data) => Row[];
  splits?: Split[];
  /** 有機溶剤は物質ごとの裾切値が無く、区分の値をそのまま使う */
  fixedLower?: string;
  /** コードに入れる接頭辞 */
  prefix: string;
}

const prisma = new PrismaClient();

/**
 * 区分ごとの番号の作り方（第0-3章）。
 *
 * 特化則の3区分は**同じ別表第三の、号ちがい**。
 * 番号に出典を入れないと第1類の1号と第2類の1号が同じになる
 */
/**
 * @param from 特別管理物質だけ、元が第1類か第2類かが入る（ / ）。
 *   **上乗せの指定なので、番号は元の号に合わせる。**でないと第1類の4号と
 *   第2類の4号が同じ番号になる
 */
function numberOf(section: string, num: string, from?: string): string {
  switch (section) {
    case "MFG_BAN":
      // 令第16条第1項
      return statutoryNumber({ kind: "orderArticle", table: "16", paragraph: "1" }, num);
    case "SPEC1":
      return statutoryNumber({ kind: "orderTableItem", table: "3", item: "1" }, num);
    case "SPEC2":
      return statutoryNumber({ kind: "orderTableItem", table: "3", item: "2" }, num);
    case "SPEC3":
      return statutoryNumber({ kind: "orderTableItem", table: "3", item: "3" }, num);
    case "ORG":
      // 令別表第六の二
      return statutoryNumber({ kind: "orderTable", table: "6の2" }, num);
    case "SPEC_MGMT":
      return statutoryNumber({ kind: "orderTableItem", table: "3", item: from ?? "2" }, num);
    default:
      return statutoryNumber({ kind: "plain" }, num);
  }
}

const CATEGORIES: CategoryDef[] = [
  {
    code: "MFG_BAN",
    name: "製造等禁止物質",
    order: 40,
    lower: "1",
    prefix: "BAN",
    note: "安衛法第55条・令第16条。製造・輸入・譲渡・提供・使用が禁止される",
    rows: (d) => d.banned,
  },
  {
    code: "SPEC1",
    name: "第1類物質",
    order: 50,
    lower: "1",
    prefix: "S1",
    note: "特化則。令別表第三第一号。製造には厚生労働大臣の許可が要る",
    rows: (d) => d.spec1,
  },
  {
    code: "SPEC2",
    name: "第2類物質",
    order: 60,
    lower: "1",
    prefix: "S2",
    note: "特化則。令別表第三第二号",
    splits: [
      { code: "T2S", name: "特定第2類物質" },
      { code: "SOL", name: "特別有機溶剤等" },
      { code: "AUR", name: "オーラミン等" },
      { code: "MGD", name: "管理第2類物質" },
    ],
    rows: (d) => d.spec2,
  },
  {
    code: "SPEC3",
    name: "第3類物質",
    order: 70,
    lower: "1",
    prefix: "S3",
    note: "特化則。令別表第三第三号",
    rows: (d) => d.spec3,
  },
  {
    code: "SPEC_MGMT",
    name: "特別管理物質",
    order: 80,
    lower: "1",
    prefix: "SPM",
    note: "特化則第38条の4。第1類と第2類の一部にかかる上乗せの指定なので、そちらにも同じ物質が入っている",
    rows: (d) => d.special,
  },
  {
    code: "ORG",
    name: "有機溶剤",
    order: 90,
    lower: "5",
    fixedLower: "5",
    prefix: "ORG",
    note: "有機則。令別表第六の二。5パーセントを超えて含有するものが有機溶剤含有物になる",
    splits: [
      { code: "OS1", name: "第1種有機溶剤等" },
      { code: "OS2", name: "第2種有機溶剤等" },
      { code: "OS3", name: "第3種有機溶剤等" },
    ],
    rows: (d) => d.solvent,
  },
];

/** 裾切値は「その値を超えれば該当」なので下限は超過 */
const threshold = (lower: string) => ({
  thresholdLower: lower,
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
});

/** 分類コードは JSON の klass（S1/S2/S3）と区分側の定義を突き合わせる */
const SPLIT_OF: Record<string, string> = {
  T2S: "T2S",
  SOL: "SOL",
  AUR: "AUR",
  MGD: "MGD",
  S1: "OS1",
  S2: "OS2",
  S3: "OS3",
};

async function removeMine(lawId: string): Promise<number> {
  const codes = CATEGORIES.map((c) => c.code);
  const classes = await prisma.regulationClass.findMany({
    where: { category: { lawId, codeNormalized: { in: codes } } },
    select: { id: true },
  });
  // **CASリンクを先に消す。**法文物質名を参照しているので、残っていると消せない
  await prisma.statutoryCasLink.deleteMany({
    where: { statutorySubstance: { classId: { in: classes.map((c) => c.id) } } },
  });
  const removed = await prisma.statutorySubstance.deleteMany({
    where: { classId: { in: classes.map((c) => c.id) } },
  });
  await prisma.regulationClass.deleteMany({
    where: { category: { lawId, codeNormalized: { in: codes } } },
  });
  await prisma.regulationCategory.deleteMany({
    where: { lawId, codeNormalized: { in: codes } },
  });
  return removed.count;
}

async function main() {
  const law = await prisma.law.findFirst({ where: { codeNormalized: LAW_CODE } });
  if (!law) throw new Error("安衛法がありません。先に seed-anei.ts を流してください");

  const gone = await removeMine(law.id);
  if (process.argv.includes("--remove")) {
    console.log(`安衛法の追加ぶんを削除しました（法文物質名 ${gone} 件）`);
    return;
  }
  if (gone > 0) console.log(`前回のぶんを消しました（法文物質名 ${gone} 件）`);

  const data = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/anei-extra.json"), "utf-8"),
  ) as Data;

  let total = 0;
  for (const def of CATEGORIES) {
    const category = await prisma.regulationCategory.create({
      data: {
        code: def.code,
        codeNormalized: def.code,
        lawId: law.id,
        nameOriginal: def.name,
        nameLang: "JA",
        displayOrder: def.order,
        note: def.note,
        ...threshold(def.lower),
      },
    });

    // 分けない区分でも、区分は必ず分類を1件持つ（表示名のない受け皿）
    const splits = def.splits ?? [{ code: "DEFAULT", name: "" }];
    const classIds = new Map<string, string>();
    for (const [i, s] of splits.entries()) {
      const cls = await prisma.regulationClass.create({
        data: {
          code: s.code,
          codeNormalized: s.code,
          categoryId: category.id,
          nameOriginal: s.name || null,
          nameLang: s.name ? "JA" : null,
          displayOrder: i,
        },
      });
      classIds.set(s.code, cls.id);
    }

    const counts = new Map<string, number>();
    const rows = def.rows(data).map((r, i) => {
      const target = r.klass ? SPLIT_OF[r.klass]! : "DEFAULT";
      counts.set(target, (counts.get(target) ?? 0) + 1);
      // 第1類と第2類で号がぶつかるので、特別管理物質だけ出どころをコードに入れる
      const code = `${LAW_CODE}-${def.prefix}-${r.from ? `${r.from}-` : ""}${r.number}`;
      return {
        code,
        codeNormalized: code,
        classId: classIds.get(target)!,
        officialNumber: numberOf(def.code, r.number, (r as { from?: string }).from),
        nameOriginal: r.name,
        nameLang: "JA",
        displayOrder: i + 1,
        note: r.note ?? null,
        ...threshold(def.fixedLower ?? r.lower),
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      await prisma.statutorySubstance.createMany({ data: rows.slice(i, i + 500) });
    }
    const detail = def.splits
      ? "（" + [...counts].map(([k, n]) => `${k}:${n}`).join(" ") + "）"
      : "";
    console.log(`${def.name}: ${rows.length} 件${detail}`);
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
