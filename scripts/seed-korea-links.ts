/**
 * 韓国の法文物質名とCASの結び付けを入れる。法令の中身は seed-korea-laws.ts。
 *
 *   bash scripts/loli-dump-korea.sh                            現在のバージョンぶんを取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-korea-links.ts --write
 *
 * **バージョンは引数で選べる。**省くと現在のバージョン。
 *
 *   ... scripts/seed-korea-links.ts 2026Q2 --write
 *
 * 過去のバージョンを入れるときは、取り出しも同じバージョンから行うこと。
 *
 *   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-korea.sh
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

/** 取り出したファイルと、法令・区分の対応 */
const SETS: { tsv: string; law: string; category: string }[] = [
  { tsv: "kreach-prohibited", law: "KR-KREACH", category: "PROHIBITED" },
  { tsv: "kreach-restricted", law: "KR-KREACH", category: "RESTRICTED" },
  { tsv: "kreach-priority", law: "KR-KREACH", category: "PRIORITY" },
  { tsv: "isha-ban", law: "KR-ISHA", category: "MFG_BAN" },
  { tsv: "isha-permit", law: "KR-ISHA", category: "MFG_PERMIT" },
  // 毒性物質は化管法の指定（禁止・制限は化評法第27条）
  { tsv: "kreach-toxic-acute", law: "KR-CCA", category: "TOXIC_ACUTE" },
  { tsv: "kreach-toxic-chronic", law: "KR-CCA", category: "TOXIC_CHRONIC" },
  { tsv: "kreach-toxic-eco", law: "KR-CCA", category: "TOXIC_ECO" },
  { tsv: "cca-accident", law: "KR-CCA", category: "ACCIDENT" },
  { tsv: "prtr-c1", law: "KR-PRTR", category: "GROUP1" },
  { tsv: "prtr-c2", law: "KR-PRTR", category: "GROUP2" },
  { tsv: "pops", law: "KR-POPS", category: "POPS" },
  { tsv: "rohs", law: "KR-ROHS", category: "RESTRICTED" },
];

/**
 * RoHS の親コード → 法文物質名の番号。
 * 取り出したファイルの鍵は親のCAS（PBBだけ外部データベースの内部コード）なので、
 * 番号に直してから結ぶ。seed-korea-laws.ts の並びと合わせること。
 */
const ROHS_NO: Record<string, string> = {
  "7439-92-1": "1",
  "7439-97-6": "2",
  "7440-43-9": "3",
  "18540-29-9": "4",
  "RR-00086-2": "5",
  "90193-67-2": "6",
  "117-81-7": "7",
  "85-68-7": "8",
  "84-74-2": "9",
  "84-69-5": "10",
};

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
    // その区分の法文物質名を、番号（officialNumber）で引けるようにする
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

    const rows = readFileSync(join(process.cwd(), "scripts/data", `korea-${set.tsv}.tsv`), "utf-8")
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter(Boolean)
      .map((l) => l.split("\t"));

    const seen = new Set<string>();
    const missed = new Set<string>();
    let skippedShape = 0;
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    for (const [rawKey, cas] of rows) {
      if (!rawKey || !cas) continue;
      if (!CAS_SHAPE.test(cas)) {
        skippedShape += 1;
        continue;
      }
      const key = set.tsv === "rohs" ? (ROHS_NO[rawKey] ?? rawKey) : rawKey;
      const id = idOf.get(key);
      if (!id) {
        missed.add(rawKey);
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
      `  ${set.law}/${set.category}`.padEnd(28) +
        `${String(data.length).padStart(6)} 件` +
        (skippedShape ? ` / CASの形でない ${skippedShape} 件` : "") +
        (missed.size ? ` / 番号が合わない ${missed.size} 種` : ""),
    );
    if (missed.size > 0 && missed.size <= 10) {
      console.log(`      合わなかった番号: ${[...missed].join(", ")}`);
    }
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
