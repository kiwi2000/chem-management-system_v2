/**
 * **見た目を確かめるための検証データ。**現在のバージョンに、LOLI 以外の
 * データソース（CHRIP・USER）から来たことにした CAS リンクを足す。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-mixed-sources.ts
 *   ... scripts/seed-mixed-sources.ts --write
 *   ... scripts/seed-mixed-sources.ts --remove --write   入れたものを消す
 *
 * **出どころは偽り。**判定の根拠にはならない。
 * 入れたものは備考の印（`[検証用の混在データ]`）で見分けられ、`--remove` で消せる。
 *
 * 足す先は**同じ規制区分の別の法文物質名**にする。
 * 無関係な号に付けると、トルエンがアゾ染料の号に当たる、といった
 * ひと目で嘘と分かる並びになり、見た目の確かめものとして使えない。
 *
 * 作る形は3通り。**画面でこの3つが見分けられるかを確かめる**ためのもの。
 *
 *   1. LOLI と CHRIP の両方が持っている（印が2つ並ぶ）
 *   2. CHRIP だけが持っている（LOLI を使わないお客さんだけが当たる）
 *   3. USER（手で直したもの）だけが持っている
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 入れたものを見分ける印。消すときの目印にもする */
const MARK = "[検証用の混在データ]";

/** どのデータソースを、どれだけ足すか */
const PLAN = [
  { code: "CHRIP", both: 60, only: 25 },
  { code: "USER", both: 10, only: 5 },
];

async function main() {
  const write = process.argv.includes("--write");
  const remove = process.argv.includes("--remove");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンがありません");
  console.log(`  入れ先: ${version.code}`);

  if (remove) {
    const n = await prisma.statutoryCasLink.count({
      where: { versionId: version.id, note: { contains: MARK } },
    });
    console.log(`  消すもの: ${n} 件`);
    if (write) {
      await prisma.statutoryCasLink.deleteMany({
        where: { versionId: version.id, note: { contains: MARK } },
      });
      console.log("  消しました。判定をやり直してください（scripts/rejudge.ts）");
    }
    await prisma.$disconnect();
    return;
  }

  /*
    **製品に実際に入っている CAS だけを相手にする。**
    どの製品にも入っていない CAS に足しても、画面に何も出ない
  */
  const inProducts = await prisma.productExpansionLine.findMany({
    select: { casNormalized: true },
    distinct: ["casNormalized"],
  });
  // CAS を持たない行が混ざる（CASなしの物質）。空も null も落とす
  const cas = inProducts.map((l) => l.casNormalized).filter((c): c is string => !!c);
  console.log(`  製品に入っている CAS: ${cas.length} 種`);

  // いま LOLI が持っている結び付き。ここに相乗りするぶんと、隣に置くぶんを作る
  const loli = await prisma.source.findFirst({
    where: { codeNormalized: "LOLI", deletedAt: null },
    select: { id: true },
  });
  if (!loli) throw new Error("データソース LOLI がありません");

  const existing = await prisma.statutoryCasLink.findMany({
    where: { versionId: version.id, sourceId: loli.id, casNormalized: { in: cas } },
    select: { statutorySubstanceId: true, casNumber: true, casNormalized: true },
    orderBy: [{ statutorySubstanceId: "asc" }, { casNormalized: "asc" }],
  });
  console.log(`  LOLI が持っている結び付き（製品に入っている CAS ぶん）: ${existing.length} 件`);
  if (existing.length === 0) throw new Error("相手になる結び付きがありません");

  /** 法文物質名 → その規制区分。単独ぶんの相手を同じ区分から選ぶために要る */
  const owners = await prisma.statutorySubstance.findMany({
    where: { id: { in: [...new Set(existing.map((l) => l.statutorySubstanceId))] } },
    select: { id: true, regulationClass: { select: { categoryId: true } } },
  });
  const categoryOf = new Map(owners.map((o) => [o.id, o.regulationClass.categoryId]));

  /*
    「そのデータソースだけが持っている」ぶんの相手を探す。
    **同じ規制区分の、別の法文物質名**で、その CAS がまだ結び付いていないもの
  */
  async function sibling(l: (typeof existing)[number]) {
    const categoryId = categoryOf.get(l.statutorySubstanceId);
    if (!categoryId) return null;
    const found = await prisma.statutorySubstance.findFirst({
      where: {
        deletedAt: null,
        regulationClass: { categoryId },
        id: { not: l.statutorySubstanceId },
        links: { none: { versionId: version.id, casNormalized: l.casNormalized } },
      },
      select: { id: true },
      orderBy: { displayOrder: "asc" },
    });
    return found?.id ?? null;
  }

  let total = 0;
  for (const plan of PLAN) {
    const source = await prisma.source.findFirst({
      where: { codeNormalized: plan.code, deletedAt: null },
      select: { id: true },
    });
    if (!source) {
      console.log(`  ${plan.code} がありません。飛ばします`);
      continue;
    }

    /*
      **間隔を空けて選ぶ。**先頭から順に取ると同じ物質に固まってしまい、
      画面のどこを見ても同じ行にしか印が出ない
    */
    const step = Math.max(1, Math.floor(existing.length / plan.both));
    const both = existing.filter((_, i) => i % step === 0).slice(0, plan.both);

    const onlyStep = Math.max(1, Math.floor(existing.length / plan.only));
    const only: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    for (const l of existing
      .filter((_, i) => i % onlyStep === Math.floor(onlyStep / 2))
      .slice(0, plan.only)) {
      const id = await sibling(l);
      if (id) only.push({ ...l, statutorySubstanceId: id });
    }

    const rows = [
      ...both.map((l) => ({
        statutorySubstanceId: l.statutorySubstanceId,
        casNumber: l.casNumber,
        casNormalized: l.casNormalized,
        note: `${MARK} LOLI と同じ結び付きを持っている`,
      })),
      ...only.map((l) => ({
        statutorySubstanceId: l.statutorySubstanceId,
        casNumber: l.casNumber,
        casNormalized: l.casNormalized,
        note: `${MARK} このデータソースだけが持っている`,
      })),
    ];

    console.log(`  ${plan.code.padEnd(6)} 相乗り ${both.length} 件 / 単独 ${only.length} 件`);
    if (write) {
      await prisma.statutoryCasLink.createMany({
        data: rows.map((r) => ({ ...r, versionId: version.id, sourceId: source.id })),
        skipDuplicates: true,
      });
    }
    total += rows.length;
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  if (write) console.log("  判定をやり直してください（scripts/rejudge.ts）");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
