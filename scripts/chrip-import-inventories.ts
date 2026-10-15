/**
 * CHRIP から取った詳細ページの、**インベントリの情報**を入れる（2026-10-15）。
 *
 *   NODE_OPTIONS=--max-old-space-size=9000 node --env-file=.env node_modules/tsx/dist/cli.mjs \
 *     scripts/chrip-import-inventories.ts 2026Q4            下見
 *   ... scripts/chrip-import-inventories.ts 2026Q4 --write    書き込み
 *
 * 入れる先は「その版 × CHRIP」のインベントリの行（`inventory_rows`）。版 × データソースの行は
 * 先に作っておく（外部データベースの画面の「＋」）。**足すだけ。**既にある行は触らない。
 *
 * ## CHRIP だけで成り立たせる
 *
 * **LOLI を見ない。**LOLI と同じインベントリの行を、CHRIP の中身だけで作る
 * （CHRIP しか契約していないお客さんでも、インベントリが使えるように。手順書 第0章 0-2）。
 * 番号の書き方だけは LOLI にそろえる（画面で同じ番号が別物に見えないように）。
 *
 * | CHRIP の節 | 入れる先 | 値 |
 * | --- | --- | --- |
 * | ECインベントリ（RO_02_001） | EINECS | EC番号。**2・3 で始まる番号だけ**（EINECS の範囲。4 は ELINCS、5 は NLP、6〜9 は ECHA の一覧番号で、EINECS ではない） |
 * | 台湾 既存化学物質（RO_13_001） | TCSI | 「該当」（LOLI と同じ。番号は無い） |
 * | TSCAインベントリ（RO_03_001） | TSCA | ACTIVITY（ACTIVE / INACTIVE） |
 * | 化審法 既存・新規公示（RJ_01_040 / 030 / 050） | ENCS | 化審法公示整理番号。`6-1849` → `(6)-1849`（LOLI の書き方） |
 * | 韓国 K-REACH 既存化学物質（RO_12_010） | KECI | KE番号。数字は 5 桁にそろえる（`KE-00001`） |
 * | 安衛法 名称公表・新規名称公表（RJ_04_001 / 002） | ISHL | 安衛法の官報整理番号をそのまま（`1-(3)-70`・`12-790`） |
 *
 * ISHL は、LOLI が化審法の既存化学物質の番号（`(1)-563` など）で持っているのに対し、CHRIP は安衛法の
 * 官報整理番号で持つ。**書き換えずに CHRIP のとおり入れる。**同じ物質に両方あれば、画面は優先度の高いほうを出す。
 *
 * 突合の鍵は CAS 番号。CAS 番号の無い物質は、リンクと同じく独自コード（`CHRIP-<CHRIP_ID>`）にする。
 */
import { looksLikeCas, normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";

const prisma = new PrismaClient();
const DIR = ".cache/chrip/detail";
const SOURCE_CODE = "CHRIP";
const OWN_CODE_PREFIX = "CHRIP-";

const unescape = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** 詳細ページを、節（`cSi` のコード）ごとの行の並びに分ける */
export function sections(html: string): Map<string, string[]> {
  const parts = html.split(
    /onClick="JavaScript:logging\(this,\s*'[^']*',\s*'cSi',\s*'\d+',\s*'\d+',\s*'0',\s*'([A-Z0-9_]+)'\)"\/>/,
  );
  const out = new Map<string, string[]>();
  for (let i = 1; i < parts.length; i += 2) {
    const code = parts[i]!;
    const body = (parts[i + 1] ?? "").split(/<img src="\.\/img\/minus\.png"/)[0]!;
    const ls = unescape(body.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, "\n"))
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    out.set(code, [...(out.get(code) ?? []), ...ls]);
  }
  return out;
}

/** 節の中で、項目名のすぐ後ろにある値を全部（同じ項目が何度も出ることがある） */
function valuesAfter(ls: string[] | undefined, key: string): string[] {
  if (!ls) return [];
  const out: string[] = [];
  for (let i = 0; i < ls.length - 1; i++) if (ls[i] === key) out.push(ls[i + 1]!);
  return out.filter((v) => v && v !== "-");
}

/** 化審法公示整理番号を LOLI の書き方にする（`6-1849` → `(6)-1849`） */
export function encsValue(v: string): string | null {
  const m = v.replace(/\s/g, "").match(/^(\d+)-(\d+)$/);
  return m ? `(${m[1]})-${m[2]}` : null;
}

/** KE番号を LOLI の書き方にする（数字 5 桁） */
export function keciValue(v: string): string | null {
  const m = v.replace(/\s/g, "").match(/^KE-(\d+)$/i);
  return m ? `KE-${m[1]!.padStart(5, "0")}` : null;
}

/** EC番号のうち EINECS の範囲（2・3 で始まる）だけ */
export function einecsValue(v: string): string | null {
  const s = v.replace(/\s/g, "");
  return /^[23]\d{2}-\d{3}-\d$/.test(s) ? s : null;
}

/** 1 ページから、インベントリごとの値を取り出す */
export function inventoryValues(html: string): Map<string, string[]> {
  const s = sections(html);
  const out = new Map<string, string[]>();
  const add = (inv: string, vs: (string | null)[]) => {
    const ok = vs.filter((v): v is string => !!v);
    if (ok.length) out.set(inv, [...new Set([...(out.get(inv) ?? []), ...ok])]);
  };
  add("EINECS", valuesAfter(s.get("RO_02_001"), "EC番号").map(einecsValue));
  if (s.has("RO_13_001")) add("TCSI", ["該当"]);
  add(
    "TSCA",
    valuesAfter(s.get("RO_03_001"), "ACTIVITY").map((v) =>
      /^(ACTIVE|INACTIVE)$/.test(v) ? v : null,
    ),
  );
  add(
    "ENCS",
    ["RJ_01_040", "RJ_01_030", "RJ_01_050"].flatMap((c) =>
      valuesAfter(s.get(c), "化審法公示整理番号").map(encsValue),
    ),
  );
  add("KECI", valuesAfter(s.get("RO_12_010"), "KE番号").map(keciValue));
  add("ISHL", [
    ...valuesAfter(s.get("RJ_04_001"), "安衛法官報整理番号"),
    ...valuesAfter(s.get("RJ_04_002"), "安衛法（官報）整理番号"),
  ]);
  return out;
}

/** CHRIP_ID と CAS 番号（一般情報の節） */
function ids(html: string): { cid: string | null; cas: string | null } {
  const g = sections(html).get("GENERAL_INFO") ?? [];
  const after = (k: string) => {
    const i = g.indexOf(k);
    return i >= 0 ? (g[i + 1] ?? null) : null;
  };
  return { cid: after("CHRIP_ID"), cas: after("CAS RN") };
}

async function main() {
  const write = process.argv.includes("--write");
  const versionCode = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
  if (!versionCode) throw new Error("入れる版を 2026Q4 のように書いてください");

  const [version, source, inventories] = await Promise.all([
    prisma.linkSetVersion.findFirst({
      where: { code: versionCode.toUpperCase(), deletedAt: null },
      select: { id: true, code: true },
    }),
    prisma.source.findFirst({
      where: { codeNormalized: SOURCE_CODE, deletedAt: null },
      select: { id: true },
    }),
    prisma.inventory.findMany({ where: { deletedAt: null }, select: { id: true, code: true } }),
  ]);
  if (!version) throw new Error(`版 ${versionCode} がありません`);
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  const lvs = await prisma.linkVersionSource.findFirst({
    where: { versionId: version.id, sourceId: source.id },
  });
  if (!lvs)
    throw new Error(
      `${version.code} × ${SOURCE_CODE} の行がありません（外部データベースの画面で作る）`,
    );
  const invId = new Map(inventories.map((i) => [i.code, i.id]));
  for (const c of ["EINECS", "TCSI", "TSCA", "ENCS", "KECI", "ISHL"])
    if (!invId.has(c)) throw new Error(`インベントリ ${c} がありません`);

  const rows: {
    inventoryId: string;
    casNumber: string;
    casNormalized: string;
    value: string;
  }[] = [];
  const perInv = new Map<string, number>();
  let files = 0;
  let noKey = 0;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
    files++;
    const html = readFileSync(`${DIR}/${f}`, "utf8");
    const { cid, cas } = ids(html);
    const raw = (cas ?? "").trim();
    const hasCas = looksLikeCas(normalizeCas(raw));
    const casNumber = hasCas ? raw : cid ? `${OWN_CODE_PREFIX}${cid}` : "";
    if (!casNumber) {
      noKey++;
      continue;
    }
    const casNormalized = normalizeCas(casNumber);
    for (const [inv, vs] of inventoryValues(html)) {
      for (const value of vs) {
        rows.push({ inventoryId: invId.get(inv)!, casNumber, casNormalized, value });
        perInv.set(inv, (perInv.get(inv) ?? 0) + 1);
      }
    }
  }

  const before = await prisma.inventoryRow.count({
    where: { versionId: version.id, sourceId: source.id },
  });
  console.log(`入れ先: ${version.code} × ${SOURCE_CODE}（いま ${before.toLocaleString()} 行）`);
  console.log(`読んだ詳細: ${files.toLocaleString()} 件 / 鍵を作れなかった: ${noKey} 件`);
  for (const [k, n] of [...perInv].sort()) console.log(`  ${k.padEnd(8)} ${n.toLocaleString()} 行`);
  console.log(`合計: ${rows.length.toLocaleString()} 行`);
  if (!write) {
    console.log("下見だけ。書き込むなら --write");
    return;
  }

  let added = 0;
  for (let i = 0; i < rows.length; i += 5000) {
    const r = await prisma.inventoryRow.createMany({
      data: rows
        .slice(i, i + 5000)
        .map((x) => ({ ...x, versionId: version.id, sourceId: source.id })),
      skipDuplicates: true,
    });
    added += r.count;
  }
  console.log(`入れました: ${added.toLocaleString()} 行（既にあったものは飛ばした）`);
}

if (process.argv[1]?.endsWith("chrip-import-inventories.ts")) {
  main().finally(() => prisma.$disconnect());
}
