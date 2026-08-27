/**
 * バージョンによる差を確かめるためのサンプル製品を入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-version-sample.ts            入れる（同じコードがあれば作り直す）
 *   ... scripts/seed-version-sample.ts --remove  入れたものを消す
 *
 * **物質は作らない。**すでに物質マスタにあるものをCAS番号で引いて使う。
 * 同じCASの物質を増やすと、どちらが代表かで判定がぶれる。
 *
 * `scripts/seed-sample.ts` とは目印を分けてある（`VS-`）。
 * 向こうの `--remove` に巻き込まれないようにするため。
 *
 * ## 何を見るためのものか
 *
 * 2026Q2 と 2026Q3 で**当たる法規制が変わる**CASだけを組成に入れてある。
 * 物質の詳細を開くと、該当法規とインベントリ番号の表で
 * 片方のバージョンだけが埋まり、もう片方がハイフンになる。
 *
 * **製品の判定は現在バージョンだけで計算する。**
 * 製品の画面で差を見るには、システム設定で現在バージョンを切り替え、
 * `scripts/rejudge.ts` を流してから見比べること。
 */
import { normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** このスクリプトが作るものの目印 */
const PREFIX = "VS-";

interface Line {
  /** 物質マスタから引くCAS番号 */
  cas: string;
  pct?: string;
  balance?: boolean;
  note?: string;
}

interface ProductSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  note: string;
  lines: Line[];
}

/**
 * 3件とも、**差の出かたが違う**ように選んである。
 *
 *   VS-PFOS   2026Q3 で法規制が**増える**
 *   VS-MOLY   2026Q3 で法規制が**外れる**
 *   VS-TINOX  インベントリの載り方が変わる（増える側と減る側の両方）
 */
const PRODUCTS: ProductSeed[] = [
  {
    code: "VS-PFOS",
    nameJa: "バージョン比較用 フッ素系表面処理剤",
    nameEn: "Version comparison sample: fluorochemical surface treatment",
    note: "2026Q3 で当たる法規制が増える例。PFOS塩3種が、化管法第一種・水濁法指定物質・中国の3目録に 2026Q3 から載った",
    lines: [
      {
        cas: "29457-73-6",
        pct: "5",
        note: "カリウム塩。2026Q3 から 化管法第一種・水濁法指定物質・中国 優先控制／重点管控新污染物／严格限制",
      },
      { cas: "19742-57-5", pct: "3", note: "アンモニウム塩。同上" },
      { cas: "13058-06-5", pct: "2", note: "アンモニウム塩（別異性体）。同上" },
      { cas: "64742-65-0", balance: true, note: "残りは石油留分で埋める" },
    ],
  },
  {
    code: "VS-MOLY",
    nameJa: "バージョン比較用 モリブデン系潤滑剤",
    nameEn: "Version comparison sample: molybdenum lubricant",
    note: "2026Q3 で法規制が外れる例。モリブデン酸は 2026Q2 では5区分に当たるが、2026Q3 では当たらない",
    lines: [
      {
        cas: "11099-00-6",
        pct: "10",
        note: "モリブデン酸。2026Q2 のみ 化管法特定第一種・安衛法第2類／特別管理物質・EU REACH附属書XVII・韓国PRTR第1類",
      },
      {
        cas: "108-88-3",
        pct: "20",
        note: "溶剤。バージョンでは変わらない（差の出ない行との見比べ用）",
      },
      { cas: "64742-65-0", balance: true },
    ],
  },
  {
    code: "VS-TINOX",
    nameJa: "バージョン比較用 導電性ペースト",
    nameEn: "Version comparison sample: conductive paste",
    note: "インベントリの載り方が変わる例。増える側と減る側を1つずつ入れてある",
    lines: [
      {
        cas: "1317-45-9",
        pct: "40",
        note: "スズ石(SnO2)。ENCS・ISHL・EINECS・TSCA など10目録すべてが 2026Q3 から載る",
      },
      {
        cas: "593-85-1",
        pct: "5",
        note: "炭酸グアニジン。ENCS・ISHL が 2026Q2 にはあり、2026Q3 では消えた",
      },
      {
        cas: "5470-11-1",
        pct: "3",
        note: "塩酸ヒドロキシルアミン。こちらも ENCS・ISHL が 2026Q2 のみ",
      },
      { cas: "67-64-1", balance: true, note: "残りはアセトンで埋める" },
    ],
  },
];

async function remove() {
  const where = { codeNormalized: { startsWith: normalizeCode(PREFIX) } };
  const products = await prisma.product.findMany({ where, select: { id: true } });
  const ids = products.map((p) => p.id);
  if (ids.length === 0) {
    console.log("消すものはありません");
    return;
  }
  await prisma.compositionLine.deleteMany({ where: { parentProductId: { in: ids } } });
  await prisma.productExpansionLine.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productExpansion.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productJudgementHit.deleteMany({
    where: { judgement: { productId: { in: ids } } },
  });
  await prisma.productJudgement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  console.log(`製品 ${ids.length} 件と、そのぶら下がりを消しました`);
}

async function main() {
  if (process.argv.includes("--remove")) {
    await remove();
    await prisma.$disconnect();
    return;
  }

  // 使うCASが物質マスタに揃っているか、先に確かめる
  const wanted = [...new Set(PRODUCTS.flatMap((p) => p.lines.map((l) => l.cas)))];
  const found = await prisma.substance.findMany({
    where: { casNumber: { in: wanted }, deletedAt: null },
    select: { id: true, casNumber: true, nameJa: true },
  });
  const idOf = new Map<string, string>();
  for (const s of found) if (!idOf.has(s.casNumber!)) idOf.set(s.casNumber!, s.id);
  const missing = wanted.filter((c) => !idOf.has(c));
  if (missing.length > 0) {
    throw new Error(`物質マスタに無いCASがあります: ${missing.join(", ")}`);
  }

  // 入れ直しなので、いったん消してから作る
  await remove();

  for (const p of PRODUCTS) {
    const product = await prisma.product.create({
      data: {
        code: p.code,
        codeNormalized: normalizeCode(p.code),
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        note: p.note,
        // 検証用なので、承認を待たずに見えるようにする
        publishState: "PUBLISHED",
      },
      select: { id: true },
    });
    await prisma.compositionLine.createMany({
      data: p.lines.map((l, i) => ({
        parentProductId: product.id,
        substanceId: idOf.get(l.cas)!,
        contentPct: l.balance ? null : l.pct!,
        isBalance: l.balance ?? false,
        note: l.note ?? null,
        displayOrder: i + 1,
      })),
    });
    console.log(`  ${p.code.padEnd(10)} ${p.nameJa}（${p.lines.length} 行）`);
  }

  /*
    **展開が先。**判定は展開済みの組成を見るので、
    `rebuild-expansions.ts` を飛ばすと該当が1件も付かない（実際にそうなった）
  */
  console.log(
    `\n製品 ${PRODUCTS.length} 件を入れました。判定を付けるには、この順で流すこと。\n` +
      `  scripts/rebuild-expansions.ts\n` +
      `  scripts/rejudge.ts`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
