/**
 * ●が付いた物質の詳細ページを、1件ずつ取る。
 *
 *   node scripts/chrip-collect.mjs        先にこれで hits.json を作る
 *   node scripts/chrip-fetch-detail.mjs   続きから取る
 *
 * 一覧では「その法律に該当するか」しか分からない。
 * **どの法文物質名に当たるか**は詳細ページにしかないので、ここで取りに行く。
 *
 * 一覧の取得と同じ作り。ゆっくり行き、落ちたら待ち、途中から続けられる。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const OUT = ".cache/chrip/detail";
const BASE = "https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/srhChripIdLst";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
/** 1件ごとに空ける時間 */
const WAIT = 2000;
/** 応答しないときに休む時間 */
const REST = 20 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function keep(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0];
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
}
async function newSession() {
  jar.clear();
  keep(
    await fetch("https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/systemTop", {
      headers: { "User-Agent": UA },
    }),
  );
  if (!jar.has("JSESSIONID")) throw new Error("入口でセッションが取れない");
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const hits = JSON.parse(readFileSync(".cache/chrip/hits.json", "utf8"));

/*
  **確実に使えるものから取る。**途中で止めても、手元に残ったぶんがそのまま使える。
   1 … 本システムに区分があり、番号で当たる法律
   2 … 大気・水質・土壌。本システムに無い区分が多く、大半は捨てることになる
   3 … TSCA・韓国だけのもの。扱いを決めていない
*/
const RANK_1 = /^(化審法|化管法|毒物及び劇物取締法|安衛法|化学兵器|REACH|EU：CLP|中国：)/;
const RANK_2 = /^(大気汚染防止法|水質汚濁防止法|土壌汚染対策法)/;
const rankOf = (list) => {
  if (list.some((h) => RANK_1.test(h))) return 1;
  if (list.some((h) => RANK_2.test(h))) return 2;
  return 3;
};
const ids = Object.keys(hits).sort((a, b) => rankOf(hits[a].hits) - rankOf(hits[b].hits));
const perRank = { 1: 0, 2: 0, 3: 0 };
for (const id of ids) perRank[rankOf(hits[id].hits)]++;
console.log(
  `優先度ごと … 1: ${perRank[1].toLocaleString()} / 2: ${perRank[2].toLocaleString()} / 3: ${perRank[3].toLocaleString()}`,
);
/** 取れているものは飛ばす。中身が空のものは取り直す */
const already = new Set(
  readdirSync(OUT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, "")),
);
const todo = ids.filter((id) => !already.has(id));
console.log(
  `対象 ${ids.length.toLocaleString()} 件 / 取得済み ${already.size.toLocaleString()} 件 / これから ${todo.length.toLocaleString()} 件`,
);
console.log(`見込み: 約${Math.round((todo.length * (WAIT + 1500)) / 3600000)}時間`);

await newSession();
let got = 0;
for (const cid of todo) {
  for (let attempt = 1; ; attempt++) {
    let res = null,
      html = null;
    try {
      res = await fetch(`${BASE}?${new URLSearchParams({ _e_slt: "", cid, shMd: "0" })}`, {
        headers: { "User-Agent": UA, Cookie: cookie(), Referer: BASE },
        signal: AbortSignal.timeout(120000),
      });
      keep(res);
      html = await res.text();
    } catch (e) {
      console.log(`${cid}: 通信できない（${e.name}） → ${REST / 60000}分待つ（${attempt}回目）`);
      await sleep(REST);
      await newSession().catch(() => {});
      continue;
    }
    /*
      中身が詳細ページか。
      **長さでは測らない。**情報の少ない物質はページが短く、
      2万文字を境にすると正常なページを失敗とみなしてしまう（実際にそうなった）。
      エラーページは「システムエラー」と書いてあり、CHRIP_ID を含まない
    */
    if (res.ok && html.includes("CHRIP_ID") && !html.includes("システムエラー")) {
      writeFileSync(`${OUT}/${cid}.html`, html);
      got++;
      if (got % 50 === 0)
        console.log(`  ${got.toLocaleString()} / ${todo.length.toLocaleString()} 件`);
      break;
    }
    console.log(
      `${cid}: ${res.status} ${html.length}文字 → ${REST / 60000}分待つ（${attempt}回目）`,
    );
    await sleep(REST);
    await newSession().catch(() => {});
  }
  await sleep(WAIT);
}
console.log(`取得しました: ${got.toLocaleString()} 件`);
