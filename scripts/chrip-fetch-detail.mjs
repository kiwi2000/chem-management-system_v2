/**
 * ●が付いた物質の詳細ページを、1件ずつ取る。
 *
 *   node scripts/chrip-collect.mjs        先にこれで hits.json を作る
 *   node scripts/chrip-fetch-detail.mjs   続きから取る
 *
 * 一覧では「その法律に該当するか」しか分からない。
 * **どの法文物質名に当たるか**は詳細ページにしかないので、ここで取りに行く。
 *
 * 一覧の取得と同じ作り。ゆっくり行き、メンテナンスで止まっていたら明けるまで待ち、途中から続けられる。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { LINKED_REGULATIONS } from "./lib/chrip-sources.mjs";

const OUT = ".cache/chrip/detail";
const BASE = "https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/srhChripIdLst";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
/** 1件ごとに空ける時間（2026Q3 は 2 秒。2026-10-04 に 5 秒で始め、同日 2.5 秒に縮めた） */
const WAIT = 2500;
/**
 * **メンテナンスの待ちかた**（2026-10-04）。CHRIP はときどき 1 時間ほど止まる。
 * 取れなかったら、いつも開ける物質（`CANARY`）のページでサイト全体が止まっているかを見て、
 * 止まっていればそのページだけを `PROBE` おきに見て、開けるようになるまで待つ。待つ間はほかに何も取りに行かない。
 *
 * **1 回開けなかっただけでは止まっていると決めない**（2026-10-06）。夜中の CHRIP は遅く、混んで一時的に
 * 応答が間に合わないことがある（10/6 1:54 に、動いているのに「止まっている」と判断して 10 分休んだ）。
 * `RECHECK` おいてもう一度見て、2 回とも開けなかったときだけ止まっているとする。
 * 開けなかった理由（応答なし・エラーのページなど）は記録に残す
 */
const PROBE = 10 * 60 * 1000;
const RECHECK = 60 * 1000;
const CANARY = "C005-019-00A";
/** サイトは動いているのに開けない物質（削除されたなど）。2 回試してだめなら記録して先へ進む */
const UNOPENABLE = ".cache/chrip/unopenable.json";

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
   0 … 物質マスタにある物質（.cache/chrip/priority-cas.json。scripts/chrip-priority-cas.ts が書き出す。無ければ飛ばす）
   1 … 2026Q3 と同じ 23 法規制のどれかに当たる。取り込みで法文物質名に結ぶもの
   2 … 番号を持つ物質（化審法の既存・新規公示、安衛法の名称公表など）と、化管法の旧版・化審法の取消優先評価
   3 … それ以外（EC・TSCA インベントリ、REACH 登録物質、用途だけのもの）
*/
const RANK_1 = LINKED_REGULATIONS;
const RANK_2 =
  /^(化審法：既存化学物質|化審法：新規公示化学物質|化審法：（取消）|安衛法：名称公表化学物質|安衛法：新規名称公表化学物質|化管法 \(令和４年度)/;
const PRIORITY = existsSync(".cache/chrip/priority-cas.json")
  ? new Set(JSON.parse(readFileSync(".cache/chrip/priority-cas.json", "utf8")))
  : new Set();
/** 物質マスタでの鍵。CAS が無ければ独自コード（chrip-import.ts と同じ形） */
const keyOf = (cid) => {
  const cas = (hits[cid].cas ?? "").trim().toUpperCase();
  return /^\d{2,7}-\d{2}-\d$/.test(cas) ? cas : `CHRIP-${cid}`;
};
const rankOf = (cid) => {
  const list = hits[cid].hits;
  if (PRIORITY.has(keyOf(cid))) return 0;
  if (list.some((h) => RANK_1.has(h))) return 1;
  if (list.some((h) => RANK_2.test(h))) return 2;
  return 3;
};
const ids = Object.keys(hits).sort((a, b) => rankOf(a) - rankOf(b));
const perRank = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const id of ids) perRank[rankOf(id)]++;
console.log(
  `優先度ごと … 0: ${perRank[0].toLocaleString()} / 1: ${perRank[1].toLocaleString()} / 2: ${perRank[2].toLocaleString()} / 3: ${perRank[3].toLocaleString()}`,
);
/** 取れているものは飛ばす。中身が空のものは取り直す */
const already = new Set(
  readdirSync(OUT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, "")),
);
const unopenable = existsSync(UNOPENABLE) ? JSON.parse(readFileSync(UNOPENABLE, "utf8")) : [];
/**
 * 別の機械で取得済みの物質（1 行 1 件の CHRIP_ID）。取得を途中で別の機械へ移すとき、
 * 取れたファイルを運ばずに一覧だけ渡して飛ばす（2026-10-04。評価機へ移したとき）
 */
const DONE_ELSEWHERE = ".cache/chrip/done-elsewhere.txt";
const elsewhere = new Set(
  existsSync(DONE_ELSEWHERE)
    ? readFileSync(DONE_ELSEWHERE, "utf8").split(/\r?\n/).filter(Boolean)
    : [],
);
if (elsewhere.size) console.log(`別の機械で取得済み: ${elsewhere.size.toLocaleString()} 件`);
const todo = ids.filter((id) => !already.has(id) && !elsewhere.has(id) && !unopenable.includes(id));
console.log(
  `対象 ${ids.length.toLocaleString()} 件 / 取得済み ${already.size.toLocaleString()} 件 / これから ${todo.length.toLocaleString()} 件`,
);
console.log(`見込み: 約${Math.round((todo.length * (WAIT + 1500)) / 3600000)}時間`);
console.log(`始めた時刻: ${new Date().toLocaleString("ja-JP")}`);

/** 1 件取る。詳細ページなら `{ html }`、取れなければ `{ why }`（開けなかった理由） */
async function fetchDetail(cid) {
  try {
    const res = await fetch(`${BASE}?${new URLSearchParams({ _e_slt: "", cid, shMd: "0" })}`, {
      headers: { "User-Agent": UA, Cookie: cookie(), Referer: BASE },
      signal: AbortSignal.timeout(120000),
    });
    keep(res);
    const html = await res.text();
    /*
      中身が詳細ページか。
      **長さでは測らない。**情報の少ない物質はページが短く、
      2万文字を境にすると正常なページを失敗とみなしてしまう（実際にそうなった）。
      エラーページは「システムエラー」と書いてあり、CHRIP_ID を含まない
    */
    if (res.ok && html.includes("CHRIP_ID") && !html.includes("システムエラー")) return { html };
    if (!res.ok) return { why: `HTTP ${res.status}` };
    if (html.includes("システムエラー")) return { why: "エラーのページ" };
    return { why: `詳細ページでない（${html.length}文字）` };
  } catch (e) {
    return {
      why: e?.name === "TimeoutError" ? "2分待っても応答なし" : `通信できない（${e?.name ?? e}）`,
    };
  }
}

/** いつも開ける物質のページを1回見る。開けなければ理由を返す */
async function probeOnce() {
  try {
    await newSession();
  } catch (e) {
    return `入口でセッションが取れない（${e?.message ?? e}）`;
  }
  const r = await fetchDetail(CANARY);
  return r.html ? null : r.why;
}

/** サイト全体が動いているか。開けなければ `RECHECK` おいてもう一度見る。2 回とも開けなければ止まっている */
async function siteUp() {
  const first = await probeOnce();
  if (first === null) return true;
  console.log(`  確認用のページが開けない（${first}）→ ${RECHECK / 60000}分後にもう一度見る`);
  await sleep(RECHECK);
  const second = await probeOnce();
  if (second === null) return true;
  console.log(`  もう一度も開けない（${second}）`);
  return false;
}

/** 開けるようになるまで待つ。PROBE おきに 1 ページだけ見る */
async function waitUntilUp() {
  const from = new Date();
  console.log(
    `サイトが止まっている（${from.toLocaleString("ja-JP")}）→ ${PROBE / 60000}分おきに確かめて待つ`,
  );
  do await sleep(PROBE);
  while (!(await siteUp()));
  const min = Math.round((Date.now() - from.getTime()) / 60000);
  console.log(`再開（${new Date().toLocaleString("ja-JP")}。約${min}分待った）`);
}

await newSession().catch(() => {});
let got = 0;
for (const cid of todo) {
  for (let tries = 1; ; tries++) {
    const r = await fetchDetail(cid);
    if (r.html) {
      writeFileSync(`${OUT}/${cid}.html`, r.html);
      got++;
      if (got % 500 === 0)
        console.log(
          `  ${got.toLocaleString()} / ${todo.length.toLocaleString()} 件 ${new Date().toLocaleString("ja-JP")}`,
        );
      break;
    }
    console.log(`${cid}: 開けない（${r.why}。${new Date().toLocaleString("ja-JP")}）`);
    await sleep(WAIT);
    if (!(await siteUp())) {
      // メンテナンス。明けたら同じ物質からやり直す（試した回数は数え直す）
      await waitUntilUp();
      tries = 0;
      continue;
    }
    // サイトは動いている。この物質だけが開けない
    if (tries >= 2) {
      unopenable.push(cid);
      writeFileSync(UNOPENABLE, JSON.stringify(unopenable, null, 1));
      console.log(`${cid}: サイトは動いているが開けない → 記録して先へ（${UNOPENABLE}）`);
      break;
    }
    await sleep(WAIT);
  }
  await sleep(WAIT);
}
console.log(
  `取得しました: ${got.toLocaleString()} 件 / 開けない物質: ${unopenable.length.toLocaleString()} 件`,
);
