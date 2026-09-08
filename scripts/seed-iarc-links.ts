/**
 * IARC 発がん性分類の CAS リンクを LOLI から入れる。法文物質名は seed-iarc-laws.ts（正式一覧）。
 *
 *   bash scripts/loli-dump-iarc.sh                                    版ごとに先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-links.ts 2026Q3 --write
 *   ... scripts/seed-iarc-links.ts 2026Q2 --write
 *
 * **バージョンは引数で選ぶ**（省くと現在のバージョン）。その版の取り出しファイル
 * `iarc-<グループ>-<版>.tsv` を読む。データソースは LOLI 固定。
 *
 * **LOLI の評価対象（親）を、正式一覧の評価対象に当てる**（2026-09-08 決定）。
 *   1. 名前が同じ / 2. 親の CAS が正式一覧に載っている / 3. 広げた CAS が最も多く重なるもの
 * どれにも当たらなければ、LOLI の名前のまま法文物質名を作って結ぶ（取りこぼさない）。
 * **CASは外部データベースがすでに展開したものをそのまま使う。**総称からこちらで広げない。
 * **物質マスタに無い CAS は結ばない**（2026-09-07 の指示）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import {
  CAS_SHAPE,
  IARC_LAW,
  OfficialIndex,
  officialCode,
  readOfficial,
} from "./lib/iarc-official";
import { GROUPS, masterCasSet } from "./seed-iarc-laws";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";
const DATA_DIR = join(process.cwd(), "scripts/data");
const TSV_OF: Record<string, string> = { G1: "g1", G2A: "g2a", G2B: "g2b", G3: "g3" };

/** 鍵と値の並びに読む。無いファイルは空として扱う */
function readPairs(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, `${file}.tsv`), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "") continue;
    const [k, v] = row.split("\t");
    if (!k || !v) continue;
    const got = map.get(k);
    if (got) got.push(v);
    else map.set(k, [v]);
  }
  return map;
}

/** 正式一覧に当たらなかった LOLI の評価対象のコード（`LU|` の鍵は長いので指紋） */
function loliCode(category: string, key: string): string {
  const short = key.startsWith("LU|")
    ? `LU-${createHash("sha1").update(key.slice(3)).digest("hex").slice(0, 10)}`
    : key;
  return `${IARC_LAW}-${category}-${short}`;
}

const yearOf = (v: string) => Number(/\[(\d{4})\]/.exec(v)?.[1] ?? 0);

/** `Monograph 100F [2012]` → `100F`（いちばん新しい評価の巻）。LOLI の名前で作るときだけ使う */
function loliVolume(values: string[]): string | null {
  const latest = [...new Set(values)].sort(
    (a, b) => yearOf(b) - yearOf(a) || a.localeCompare(b),
  )[0];
  if (!latest) return null;
  const m = /^(Monograph|Supplement)\s+(\S+)/.exec(latest);
  if (!m) return latest.replace(/\s*\[\d{4}\]$/, "");
  return m[1] === "Supplement" ? `Suppl. ${m[2]}` : m[2];
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
  if (!version)
    throw new Error(
      versionArg ? `バージョン ${versionArg} がありません` : "現在のバージョンが決まっていません",
    );
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  console.log(`  入れ先: ${version.code} × ${source.code}\n`);

  const master = await masterCasSet();
  const official = readOfficial();

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
            law: { deletedAt: null, codeNormalized: normalizeCode(IARC_LAW) },
          },
        },
      },
      select: {
        id: true,
        codeNormalized: true,
        displayOrder: true,
        regulationClass: { select: { id: true } },
      },
    });
    const classId = subs[0]?.regulationClass.id ?? null;
    const idOf = new Map(subs.map((s) => [s.codeNormalized, s.id]));
    let nextOrder = subs.reduce((m, s) => Math.max(m, s.displayOrder), 0) + 1;
    const index = new OfficialIndex(official, g.group);

    const tsv = TSV_OF[g.code] ?? g.code.toLowerCase();
    const pairs = readPairs(`iarc-${tsv}-${version.code}`);
    if (pairs.size === 0) {
      console.log(
        `  ${IARC_LAW}/${g.code}`.padEnd(30) + "取り出しファイルが無い（この版は飛ばす）",
      );
      continue;
    }
    const names = readPairs(`iarc-${tsv}-${version.code}-name`);
    const monos = readPairs(`iarc-${tsv}-${version.code}-mono`);

    let matched = 0;
    let fallback = 0;
    let notInMaster = 0;
    const seen = new Set<string>();
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    for (const [key, cases] of pairs) {
      const usable = cases.filter((c) => CAS_SHAPE.test(c) && master.has(normalizeCas(c)));
      notInMaster += cases.filter((c) => CAS_SHAPE.test(c) && !master.has(normalizeCas(c))).length;
      if (usable.length === 0) continue;

      const loliName = names.get(key)?.[0] ?? key;
      const ownCas = CAS_SHAPE.test(key) ? key : null;
      const agent = index.resolve(loliName, ownCas, usable, key);
      let id: string | undefined;
      if (agent) {
        matched += 1;
        id = idOf.get(normalizeCode(officialCode(g.code, agent.name)));
        if (!id && write)
          throw new Error(
            `正式一覧の法文物質名がありません: ${agent.name}（先に seed-iarc-laws.ts --write）`,
          );
      } else {
        fallback += 1;
        const code = loliCode(g.code, key);
        id = idOf.get(normalizeCode(code));
        if (!id && write && classId) {
          const made = await prisma.statutorySubstance.create({
            data: {
              code,
              codeNormalized: normalizeCode(code),
              classId,
              officialNumber: loliVolume(monos.get(key) ?? []),
              nameOriginal: loliName,
              nameLang: "EN",
              nameJa: null,
              nameEn: loliName,
              displayOrder: nextOrder++,
              aggregation: "NONE",
              metalEtc: null,
              thresholdLower: "0",
              lowerBound: "EXCLUSIVE",
              thresholdUpper: "100",
              upperBound: "INCLUSIVE",
              note: `LOLI の評価対象（IARC の正式一覧に当たらなかったもの）: ${[...new Set(monos.get(key) ?? [])].join("; ")}`,
            },
            select: { id: true },
          });
          id = made.id;
          idOf.set(normalizeCode(code), id);
        }
      }
      if (!id) continue;
      for (const cas of usable) {
        const casNormalized = normalizeCas(cas);
        const dedup = `${id}/${casNormalized}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        data.push({ statutorySubstanceId: id, casNumber: cas, casNormalized });
      }
    }

    if (write) {
      // その区分ぶんの LOLI のリンクを入れ替える（ほかの区分・版・データソースには触らない）
      await prisma.statutoryCasLink.deleteMany({
        where: {
          versionId: version.id,
          sourceId: source.id,
          statutorySubstanceId: { in: [...idOf.values()] },
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
      `  ${IARC_LAW}/${g.code}`.padEnd(18) +
        `LOLI の評価対象 ${String(pairs.size).padStart(4)} 種（正式一覧に当たった ${matched} / LOLI の名前で作る ${fallback}）` +
        ` / リンク ${String(data.length).padStart(6)} 件` +
        (notInMaster ? ` / マスタに無い CAS ${notInMaster} 件` : ""),
    );
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
