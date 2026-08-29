/**
 * 取れた一覧の Excel を読み、**●が付いた物質**を1つにまとめる。
 *
 *   node scripts/chrip-collect.mjs
 *
 * 出すもの: .cache/chrip/hits.json
 *   { "C005-019-00A": { cas: "59-89-2", name: "…", hits: ["安衛法：名称等を…"] } }
 *
 * 3回に分けて取っているので、同じ物質が3つのファイルに出てくる。CHRIP_ID でまとめる。
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

const hit = [...byId].filter(([, v]) => v.hits.length > 0);
writeFileSync(".cache/chrip/hits.json", JSON.stringify(Object.fromEntries(hit), null, 1));
console.log(`読んだファイル: ${files.length} 本 / 行: ${rowsRead.toLocaleString()}`);
console.log(`物質（重複なし）: ${byId.size.toLocaleString()}`);
console.log(`どれかに該当: ${hit.length.toLocaleString()}`);
const perLaw = new Map();
for (const [, v] of hit) for (const h of v.hits) perLaw.set(h, (perLaw.get(h) ?? 0) + 1);
for (const [k, n] of [...perLaw].sort((a, b) => b[1] - a[1]))
  console.log(`  ${k.slice(0, 40)} … ${n.toLocaleString()}`);
