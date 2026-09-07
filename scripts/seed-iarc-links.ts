/**
 * IARC 発がん性分類の法文物質名とCASの結び付けを入れる。法令の中身は seed-iarc-laws.ts。
 *
 *   bash scripts/loli-dump-iarc.sh                                    版ごとに先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-links.ts 2026Q3 --write
 *   ... scripts/seed-iarc-links.ts 2026Q2 --write
 *
 * **バージョンは引数で選ぶ**（省くと現在のバージョン）。その版の取り出しファイル
 * `iarc-<グループ>-<版>.tsv` を読む。データソースは LOLI 固定。
 *
 * **CASは外部データベースがすでに展開したものをそのまま使う。**総称からこちらで広げない。
 * **物質マスタに無い CAS は結ばない**（2026-09-07 の指示）。
 * 法文物質名はコード（INT-IARC-<区分>-<鍵>）で引く。番号は空のことがあるので鍵にしない。
 */
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { GROUPS, masterCasSet, readPairs, substanceCode } from "./seed-iarc-laws";

const prisma = new PrismaClient();

const LAW = "INT-IARC";
const SOURCE_CODE = "LOLI";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

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

  const master = await masterCasSet();

  let total = 0;
  for (const g of GROUPS) {
    const subs = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        regulationClass: {
          deletedAt: null,
          category: {
            deletedAt: null,
            codeNormalized: normalizeCode(g.code),
            law: { deletedAt: null, codeNormalized: normalizeCode(LAW) },
          },
        },
      },
      select: { id: true, codeNormalized: true },
    });
    const idOf = new Map(subs.map((s) => [s.codeNormalized, s.id]));

    const pairs = readPairs(`iarc-${g.tsv}-${version.code}`);
    if (pairs.size === 0) {
      console.log(`  ${LAW}/${g.code}`.padEnd(30) + "取り出しファイルが無い（この版は飛ばす）");
      continue;
    }

    const seen = new Set<string>();
    let notInMaster = 0;
    let noName = 0;
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    for (const [key, cases] of pairs) {
      const id = idOf.get(normalizeCode(substanceCode(g.code, key)));
      for (const cas of cases) {
        if (!CAS_SHAPE.test(cas)) continue;
        const casNormalized = normalizeCas(cas);
        if (!master.has(casNormalized)) {
          notInMaster += 1;
          continue;
        }
        // 親が法文物質名になっていない（マスタに CAS が無くて作らなかった親）。ここには来ないはず
        if (!id) {
          noName += 1;
          continue;
        }
        const dedup = `${id}/${casNormalized}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        data.push({ statutorySubstanceId: id, casNumber: cas, casNormalized });
      }
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
      `  ${LAW}/${g.code}`.padEnd(30) +
        `${String(data.length).padStart(6)} 件` +
        (notInMaster ? ` / マスタに無い CAS ${notInMaster} 件` : "") +
        (noName ? ` / 法文物質名が無い ${noName} 件` : ""),
    );
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
