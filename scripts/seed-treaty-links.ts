/**
 * 3つの条約の法文物質名とCASの結び付けを入れる。法令の中身は seed-treaty-laws.ts。
 *
 *   bash scripts/loli-dump-treaties.sh                       現在のバージョンぶんを取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-treaty-links.ts 2026Q3 --write
 *
 * **バージョンは引数で選べる。**省くと現在のバージョン。
 * 過去のバージョンを入れるときは、取り出しも同じバージョンから行うこと。
 *
 *   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-treaties.sh
 *
 * **CASは外部データベースがすでに展開したものをそのまま使う。**
 * 総称からこちらで広げることはしない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";
/** `1333-86-4` の形だけを通す。`RR-…` のような内部コードは入れない */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 取り出したファイルと、法令・区分の対応。seed-treaty-laws.ts と合わせること */
const SETS: { tsv: string; law: string; category: string }[] = [
  { tsv: "pops", law: "INT-POPS", category: "ANNEX_A" },
  { tsv: "pops", law: "INT-POPS", category: "ANNEX_B" },
  { tsv: "pops", law: "INT-POPS", category: "ANNEX_C" },
  { tsv: "pic", law: "INT-PIC", category: "ANNEX3" },
  { tsv: "minamata", law: "INT-MINAMATA", category: "COVERED" },
];

function readRows(file: string): [string, string][] {
  return readFileSync(join(process.cwd(), "scripts/data", `${file}.tsv`), "utf-8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string]);
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const versionArg = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
  const version = await prisma.linkSetVersion.findFirst({
    where: versionArg
      ? { codeNormalized: versionArg.toUpperCase(), deletedAt: null }
      : { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) {
    throw new Error(
      versionArg ? `バージョン ${versionArg} がありません` : "現在のバージョンが決まっていません",
    );
  }
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  console.log(`  入れ先: ${version.code} × ${source.code}\n`);

  let total = 0;
  for (const set of SETS) {
    /*
      その区分の法文物質名を、番号（親のCAS）で引けるようにする。
      **区分ごとに引き直す。**ストックホルム条約は同じ親が附属書Aと附属書Cの
      両方に出るので、区分をまたいで1つに寄せると片方が消える
    */
    const subs = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        regulationClass: {
          deletedAt: null,
          category: {
            deletedAt: null,
            codeNormalized: normalizeCode(set.category),
            law: { deletedAt: null, codeNormalized: normalizeCode(set.law) },
          },
        },
      },
      select: { id: true, officialNumber: true },
    });
    const idOf = new Map(subs.map((s) => [s.officialNumber ?? "", s.id]));

    const seen = new Set<string>();
    let skippedShape = 0;
    let outside = 0;
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    for (const [key, cas] of readRows(`treaty-${set.tsv}`)) {
      if (!key || !cas) continue;
      if (!CAS_SHAPE.test(cas)) {
        skippedShape += 1;
        continue;
      }
      const id = idOf.get(key);
      // その区分に載っていない親（別の附属書のもの）。飛ばすのが正しい
      if (!id) {
        outside += 1;
        continue;
      }
      const casNormalized = normalizeCas(cas);
      const dedup = `${id}/${casNormalized}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      data.push({ statutorySubstanceId: id, casNumber: cas, casNormalized });
    }

    if (write) {
      // その区分ぶんだけ入れ替える。ほかの区分やほかのバージョンには触らない
      await prisma.statutoryCasLink.deleteMany({
        where: {
          versionId: version.id,
          sourceId: source.id,
          statutorySubstanceId: { in: subs.map((s) => s.id) },
        },
      });
      for (let i = 0; i < data.length; i += 5000) {
        await prisma.statutoryCasLink.createMany({
          data: data
            .slice(i, i + 5000)
            .map((d) => ({ ...d, versionId: version.id, sourceId: source.id })),
          skipDuplicates: true,
        });
      }
    }
    total += data.length;
    console.log(
      `  ${set.law}/${set.category}`.padEnd(30) +
        `${String(data.length).padStart(6)} 件` +
        (skippedShape ? ` / CASの形でない ${skippedShape} 件` : "") +
        (outside ? ` / ほかの区分の親 ${outside} 件` : ""),
    );
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
