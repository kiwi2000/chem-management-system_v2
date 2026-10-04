/**
 * 取れた一覧の Excel を読み、**●が付いた物質**を1つにまとめる。
 *
 *   node scripts/chrip-collect.mjs             ●が付いた物質（CAS あり）
 *   node scripts/chrip-collect.mjs --all-cas   CAS のある物質すべて（●が無いものも。全件取得の回。2026-10-04）
 *
 * 出すもの: .cache/chrip/hits.json
 *   { "C005-019-00A": { cas: "59-89-2", name: "…", hits: ["安衛法：名称等を…"] } }
 *
 * 一覧を何回かに分けて取ったときは、同じ物質がいくつものファイルに出てくる。CHRIP_ID でまとめる。
 *
 * **CAS 番号の無い物質は拾わない**（2026-10-04 指示）。詳細を取っても組成に打てず、取り込みで使わない
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { readSheet } from "./lib/xlsx-read.mjs";

const DIR = ".cache/chrip/list";
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".xlsx"))
  .sort();
const byId = new Map();
let rowsRead = 0;

for (const f of files) {
  const rows = readSheet(readFileSync(`${DIR}/${f}`));
  const head = rows[0] ?? [];
  // 法規制の列は「物質名称」より右
  const first = head.findIndex((h) => h === "物質名称") + 1;
  for (const r of rows.slice(1)) {
    rowsRead++;
    const [, cid, cas, , name] = r;
    if (!cid) continue;
    const rec = byId.get(cid) ?? { cas: cas ?? "", name: name ?? "", hits: [] };
    for (let c = first; c < head.length; c++) {
      if ((r[c] ?? "").includes("●") && !rec.hits.includes(head[c])) rec.hits.push(head[c]);
    }
    if (!rec.cas && cas) rec.cas = cas;
    byId.set(cid, rec);
  }
}

const CAS = /^\d{2,7}-\d{2}-\d$/;
const allCas = process.argv.includes("--all-cas");
const hitAny = [...byId].filter(([, v]) => v.hits.length > 0);
const hit = [...byId].filter(([, v]) => CAS.test(v.cas.trim()) && (allCas || v.hits.length > 0));
writeFileSync(".cache/chrip/hits.json", JSON.stringify(Object.fromEntries(hit), null, 1));
console.log(`読んだファイル: ${files.length} 本 / 行: ${rowsRead.toLocaleString()}`);
console.log(`物質（重複なし）: ${byId.size.toLocaleString()}`);
console.log(
  `どれかに該当: ${hitAny.length.toLocaleString()} / 拾ったもの（CAS あり${allCas ? "・●が無いものも" : ""}）: ${hit.length.toLocaleString()}`,
);
const perLaw = new Map();
for (const [, v] of hit) for (const h of v.hits) perLaw.set(h, (perLaw.get(h) ?? 0) + 1);
for (const [k, n] of [...perLaw].sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.slice(0, 40)} … ${n.toLocaleString()}`);
