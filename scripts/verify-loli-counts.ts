/**
 * LOLI の取り出しと、こちらの法文物質名を**件数で突き合わせる**。
 *
 *   bash scripts/loli-dump.sh && bash scripts/loli-dump-china.sh   先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-loli-counts.ts
 *
 * **これは「読み方が合っているか」を機械で見る網。**
 * 一覧の欄を読み違えると、こちらの件数と大きくずれる。人の自信とは無関係に効く。
 *
 * 出すのは3つ。
 *
 * ```
 * 取り出しの鍵の数   LOLI 側にいくつの号があるか
 * こちらの件数       その区分の法文物質名がいくつあるか
 * 結び付いた数       実際にCASが付いた法文物質名の数
 * ```
 *
 * **鍵の数とこちらの件数が近いこと**が、欄の読み方が合っている裏づけになる。
 * 化学兵器禁止法はこれで完全一致した（29/5・3/11・4/13）。
 *
 * 大きくずれるのが必ず誤りとは限らない（LOLI が総称を1物質ずつ持つ、
 * こちらが枝番まで持つ、など）。**ずれの理由が説明できるかを見るためのもの。**
 * 説明は `EXPECTED` に書いておく。書いていないずれは `?` が付く。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Row {
  law: string;
  category: string;
  tsv: string;
  /** LOLI の鍵から数えるとき、最初の区切りまでを号とみなす */
  head?: boolean;
  /** 鍵の前置き。合わない鍵は数えない（1つのTSVに複数の表が混ざるもの） */
  prefix?: string;
  /** ずれの理由。書いてあれば `?` を付けない */
  note?: string;
}

const ROWS: Row[] = [
  // --- 日本 -----------------------------------------------------------------
  { law: "JP-CSCL", category: "C1", tsv: "loli-cscl-c1" },
  { law: "JP-CSCL", category: "C2", tsv: "loli-cscl-c2" },
  { law: "JP-CSCL", category: "MON", tsv: "loli-cscl-mon" },
  { law: "JP-CSCL", category: "PRI", tsv: "loli-cscl-pri" },
  {
    law: "JP-CSCL",
    category: "SGN",
    tsv: "loli-cscl-sgn",
    note: "官報公示整理番号で突き合わせる。LOLI 側は9種しかない",
  },
  { law: "JP-PRTR", category: "C1", tsv: "loli-prtr-c1" },
  { law: "JP-PRTR", category: "SC1", tsv: "loli-prtr-sc1" },
  { law: "JP-PRTR", category: "C2", tsv: "loli-prtr-c2" },
  {
    law: "JP-PDSCA",
    category: "TOX",
    tsv: "loli-pdsca-tox",
    note: "指定令ぶんだけ。法別表ぶんは別のTSV",
  },
  { law: "JP-PDSCA", category: "TOX", tsv: "loli-pdsca-tox-l", note: "法別表ぶんだけ" },
  { law: "JP-PDSCA", category: "DEL", tsv: "loli-pdsca-del", note: "指定令ぶんだけ" },
  { law: "JP-PDSCA", category: "DEL", tsv: "loli-pdsca-del-l", note: "法別表ぶんだけ" },
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-label",
    prefix: "2-",
    note: "則別表第2ぶんだけ。令別表第9と令別表第3第1号は別のTSV",
  },
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-label-t9",
    prefix: "9-",
    note: "令別表第9ぶん",
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    tsv: "loli-isha-sds",
    prefix: "2-",
    note: "則別表第2ぶんだけ",
  },
  { law: "JP-ISHA", category: "SDS", tsv: "loli-isha-sds-t9", prefix: "9-", note: "令別表第9ぶん" },
  { law: "JP-ISHA", category: "MFG_PERMIT", tsv: "loli-isha-mfgpermit" },
  { law: "JP-ISHA", category: "MFG_BAN", tsv: "loli-isha-mfgban" },
  { law: "JP-ISHA", category: "SPEC1", tsv: "loli-isha-spec1" },
  { law: "JP-ISHA", category: "SPEC2", tsv: "loli-isha-spec2" },
  { law: "JP-ISHA", category: "SPEC3", tsv: "loli-isha-spec3" },
  { law: "JP-ISHA", category: "ORG", tsv: "loli-isha-org", note: "LOLI に54号のうち45号がある" },
  { law: "JP-ISHA", category: "SPEC_MGMT", tsv: "loli-isha-spm" },
  { law: "JP-APA", category: "HAZARD", tsv: "loli-apa-hazard" },
  { law: "JP-WPCA", category: "HAZARD", tsv: "loli-wpca-hazard" },
  { law: "JP-WPCA", category: "DESIGNATED", tsv: "loli-wpca-desig" },
  { law: "JP-SCCA", category: "SPECIFIED", tsv: "loli-scca" },
  {
    law: "JP-CWCA",
    category: "SPECIFIED",
    tsv: "loli-cwca-spec-tox",
    head: true,
    note: "第三欄（毒性物質）ぶん。第四欄は別のTSV",
  },
  {
    law: "JP-CWCA",
    category: "SPECIFIED",
    tsv: "loli-cwca-spec-prec",
    head: true,
    note: "第四欄ぶん",
  },
  { law: "JP-CWCA", category: "DESIG1", tsv: "loli-cwca-d1-tox", head: true, note: "第三欄ぶん" },
  { law: "JP-CWCA", category: "DESIG1", tsv: "loli-cwca-d1-prec", head: true, note: "第四欄ぶん" },
  { law: "JP-CWCA", category: "DESIG2", tsv: "loli-cwca-d2-tox", head: true, note: "第三欄ぶん" },
  { law: "JP-CWCA", category: "DESIG2", tsv: "loli-cwca-d2-prec", head: true, note: "第四欄ぶん" },

  // --- 中国 -----------------------------------------------------------------
  { law: "CN-HAZCHEM", category: "HAZ", tsv: "china-haz", note: "LOLI に2,822号。原文は2,828件" },
  { law: "CN-HAZCHEM", category: "HYPERTOX", tsv: "china-hypertox" },
  { law: "CN-EXPLOSIVE", category: "EXPLOSIVE", tsv: "china-explosive" },
  { law: "CN-PRIORITY", category: "PRIORITY1", tsv: "china-priority1" },
  { law: "CN-PRIORITY", category: "PRIORITY2", tsv: "china-priority2" },
  {
    law: "CN-NEWPOL",
    category: "NEWPOL",
    tsv: "china-newpol",
    note: "LOLI は已淘汰类を2物質しか持たない（原文は10物質）",
  },
  {
    law: "CN-RESTRICTED",
    category: "RESTRICTED",
    tsv: "china-restricted",
    head: true,
    note: "LOLI は1番を13物質に割っている",
  },
  {
    law: "CN-PRECURSOR",
    category: "PRECURSOR",
    tsv: "china-precursor",
    note: "番号が無く総称の親で結ぶ。法文物質名も LOLI 由来",
  },
  {
    law: "CN-CWC",
    category: "CONTROLLED",
    tsv: "china-controlled",
    note: "番号が無く総称の親で結ぶ。法文物質名も LOLI 由来",
  },
  // --- 米国・EU ---------------------------------------------------------------
  {
    law: "US-EPCRA",
    category: "TRI",
    tsv: "loli-us-tri",
    note: "LOLI は総称から個々の物質へ広げた形。鍵はCASなので数は比べられない",
  },
  {
    law: "US-TSCA",
    category: "SEC6",
    tsv: "loli-us-tsca6",
    note: "同上。こちらは同じ物質を規制の枝ごとに分けている",
  },
  { law: "EU-REACH", category: "ANNEX14", tsv: "loli-eu-annex14" },
  {
    law: "EU-REACH",
    category: "ANNEX17",
    tsv: "loli-eu-annex17",
    note: "LOLI は137項、こちらは79項（化学物質を挙げていない項は入れていない）",
  },
  {
    law: "EU-REACH",
    category: "SVHC",
    tsv: "loli-eu-svhc",
    note: "LOLI は EC番号が無い行をCASで持つため鍵が増える",
  },
  {
    law: "EU-CLP",
    category: "ANNEX6",
    tsv: "loli-eu-clp6",
    note: "一覧に Index番号が無いので CasKeys から引く。4,443種でほぼ全数",
  },
];

/** ずれが何割を超えたら目を向けるか */
const TOLERANCE = 0.1;

function keysOf(row: Row): number | null {
  const path = join(process.cwd(), "scripts/data", `${row.tsv}.tsv`);
  if (!existsSync(path)) return null;
  const keys = new Set<string>();
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const raw = line.split("\t")[0]?.trim();
    if (!raw) continue;
    for (const part of raw.split(",")) {
      let k = part.trim();
      if (k === "") continue;
      if (row.prefix) {
        if (!k.startsWith(row.prefix)) continue;
        k = k.slice(row.prefix.length);
      }
      if (row.head) k = k.split("-")[0]!;
      keys.add(k.replace(/^0+(?=\d)/, "").toUpperCase());
    }
  }
  return keys.size;
}

async function main() {
  console.log("法令        区分          LOLIの鍵  こちら  結び付き   ずれ  覚え書き");
  let flagged = 0;
  for (const row of ROWS) {
    const keys = keysOf(row);
    const subs = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        regulationClass: { category: { code: row.category, law: { code: row.law } } },
      },
      select: { id: true },
    });
    const linked = await prisma.statutorySubstance.count({
      where: { deletedAt: null, id: { in: subs.map((s) => s.id) }, links: { some: {} } },
    });

    if (keys === null) {
      console.log(
        `${row.law.padEnd(13)}${row.category.padEnd(13)}  取り出しがありません（${row.tsv}.tsv）`,
      );
      flagged += 1;
      continue;
    }
    const gap = subs.length === 0 ? 1 : Math.abs(keys - subs.length) / subs.length;
    const mark = gap <= TOLERANCE ? "  " : row.note ? "・" : "??";
    if (mark === "??") flagged += 1;
    console.log(
      `${row.law.padEnd(13)}${row.category.padEnd(13)}${String(keys).padStart(6)}${String(subs.length).padStart(8)}` +
        `${String(linked).padStart(9)}   ${mark}  ${row.note ?? ""}`,
    );
  }
  console.log(
    "\n`・` は理由が書いてあるずれ。`??` は理由が書かれていないずれ。" +
      "\n**`??` が出たら、その一覧の読み方を疑う**（第4章 4-1a）。",
  );
  console.log(
    flagged === 0 ? "\n説明の付かないずれはありません。" : `\n見るべきもの ${flagged} 件`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
