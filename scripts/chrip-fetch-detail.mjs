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
/** 1件ごとに空ける時間。何日かかってもよいので広く取る（2026Q3 は 2 秒。2026-10-04 に 5 秒へ） */
const WAIT = 5000;
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
  **確実に使えるものから取る。**途中で止めても、手元に残ったぶんがそのまま使える（2026-10-04 に並べ直した）。
   1 … 2026Q3 と同じ 23 法規制のどれかに当たる。取り込みで法文物質名に結ぶもの
   2 … 番号を持つ物質（化審法の既存・新規公示、安衛法の名称公表など）と、化管法の旧版・化審法の取消優先評価
   3 … それ以外（EC・TSCA インベントリ、REACH 登録物質、用途だけのもの）
*/
const RANK_1 = new Set([
  "化審法：第一種特定化学物質",
  "化審法：第二種特定化学物質",
  "化審法：監視化学物質",
  "化審法：優先評価化学物質",
  "化審法：特定一般化学物質",
  "化管法 (令和５年度分以降の排出量等の把握や令和５年度以降のSDS提供の対象)",
  "毒物及び劇物取締法",
  "安衛法：製造等が禁止される有害物等",
  "安衛法：製造の許可を受けるべき有害物",
  "安衛法：名称等を表示し、又は通知すべき危険物及び有害物（ラベル表示・SDS交付義務対象物質）",
  "安衛法：特定化学物質等（特化則）",
  "安衛法：有機溶剤等（有機則）",
  "化学兵器の禁止及び特定物質の規制等に関する法律（化学兵器禁止法）",
  "大気汚染防止法",
  "水質汚濁防止法",
  "土壌汚染対策法",
  "REACH：高懸念物質（SVHC）",
  "REACH：制限物質",
  "EU：CLP調和分類",
  "TSCA：化学物質及び混合物の優先度付け、リスク評価並びに規制",
  "中国：危険化学品目録（２０１５版）",
  "韓国：化評法( K-REACH)／化管法：有害化学物質、重点管理物質",
  "韓国：化評法( K-REACH)：その他",
]);
const RANK_2 =
  /^(化審法：既存化学物質|化審法：新規公示化学物質|化審法：（取消）|安衛法：名称公表化学物質|安衛法：新規名称公表化学物質|化管法 \(令和４年度)/;
const rankOf = (list) => {
  if (list.some((h) => RANK_1.has(h))) return 1;
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
console.log(`始めた時刻: ${new Date().toLocaleString("ja-JP")}`);

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
      if (got % 500 === 0)
        console.log(
          `  ${got.toLocaleString()} / ${todo.length.toLocaleString()} 件 ${new Date().toLocaleString("ja-JP")}`,
        );
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
