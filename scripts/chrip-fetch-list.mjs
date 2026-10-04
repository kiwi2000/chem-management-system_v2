/**
 * CHRIP の中間検索結果（法規制の該当表）を、CHRIP_ID の部分一致で 00A〜99A まで集める。
 *
 *   node scripts/chrip-fetch-list.mjs            続きから
 *   node scripts/chrip-fetch-list.mjs --from 00  途中から
 *
 * **相手のサーバーに負担をかけない。**1回ごとに間を空け、
 * エラーやメンテナンスに当たったら長めに休んでから戻る。
 * 途中で止めても、取れたところまでは残り、次に続きから始まる。
 */
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const OUT = ".cache/chrip/list";
const STATE = ".cache/chrip/list-state.json";
const BASE = "https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/srhChripIdLst";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";

/**
 * 列に出す情報源の番号。**URL で渡せば 1 回に何個でも出せる**（画面で 10 個まで選べるのは画面だけの制約。
 * 80 個まで 1 回で出ることを確かめた。2026-10-04）。
 *
 * **番号は CHRIP の更新で振り直される。**2026-09-30 の更新で全部ずれた。四半期ごとに、
 * 取る前に `s1`〜`s100` を 1 物質で出して、列名と番号の対応を確かめ直すこと（法規制データの作り方 4b-1）。
 * 2026-10-04 時点の対応:
 *   2026Q3 と同じ 23 … s5 s6 s7 s8 s10 化審法 / s20 化管法 / s21 毒劇法 / s25 s26 s27 s29 s33 s34 安衛法 /
 *                      s40 化学兵器 / s42 s43 s44 大気・水質・土壌 / s69 s70 s71 EU / s74 TSCA / s75 中国 / s76 s78 韓国
 *                      （製造許可は s26 か s27。片方は列が出ない番号なので両方渡す）
 *   足したもの … s4 用途 / s9 取消優先評価 / s19 化管法R4 / s24 新規名称公表 / s32 皮膚等障害 / s39 強い変異原性 /
 *               s41 オゾン層 / s67 REACH登録 / s68 ECインベントリ / s72 TSCAインベントリ / s73 SNUR
 *   番号で拾うため … s11 s12 新規公示 / s13 既存化学物質 / s23 安衛法名称公表
 */
const PASSES = [
  "s4_s5_s6_s7_s8_s9_s10_s11_s12_s13_s19_s20_s21_s23_s24_s25_s26_s27_s29_s32_s33_s34_s39_s40_s41_s42_s43_s44_s67_s68_s69_s70_s71_s72_s73_s74_s75_s76_s78",
];

/**
 * 1回ごとに空ける時間（ミリ秒）。
 * **急がない。**100本を1時間かけて取っても、後の工程に響かない。
 * 相手を詰まらせて締め出されるほうが、よほど高くつく
 */
const WAIT = 6000;
/** エラーやメンテナンスに当たったときに休む時間。回数では打ち切らない */
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
  const res = await fetch("https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/systemTop", {
    headers: { "User-Agent": UA },
  });
  keep(res);
  if (!jar.has("JSESSIONID")) throw new Error("入口でセッションが取れない");
}

function url(word, adMdCl) {
  const p = new URLSearchParams({
    _e_download: "",
    stMd: "",
    adMdCl,
    slIdxNm: "",
    slScNm: "",
    slScCtNm: "",
    slScRgNm: "",
    slMdDplt: "0",
    slMdDplt2: "0",
    slMdDplt3: "0",
    shMd: "0",
    hdUpScPh: "",
    cidLt: "",
    ltPgCt: "5000",
    hdInitLtNumMh: "0",
    hdInitLtNmMh: "1",
    hdInitLtMlMh: "0",
    hdInitLtPgCtSt: "100",
    hdInitRbDp: "0",
    hdInitLtScTp: "1",
    hdInitRbScMh: "1",
    txNumSh: word,
    ltNumTp: "51",
    ltNumMh: "1",
    txNmSh: "",
    ltNmTp: "",
    ltNmMh: "1",
    txMlSh: "",
    ltMlMh: "0",
    ltScDp: "0",
    ltPgCtSt: "5000",
    rbDp: "0",
  });
  return `${BASE}?${p}`;
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { done: [] };
const done = new Set(state.done);
const save = () => writeFileSync(STATE, JSON.stringify({ done: [...done] }, null, 1));

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
await newSession();

const from = Number(process.argv[process.argv.indexOf("--from") + 1]) || 0;
let got = 0,
  skipped = 0;
for (let n = from; n < 100; n++) {
  const word = `${String(n).padStart(2, "0")}A`;
  for (let pass = 0; pass < PASSES.length; pass++) {
    const key = `${word}-${pass + 1}`;
    if (done.has(key)) {
      skipped++;
      continue;
    }

    for (let attempt = 1; ; attempt++) {
      /*
        **通信そのものが失敗することもある。**相手が重いときは応答が返らない。
        例外も「取れなかった」として同じように扱い、間を置いてから戻る
      */
      let res = null,
        buf = null;
      try {
        res = await fetch(url(word, PASSES[pass]), {
          headers: { "User-Agent": UA, Cookie: cookie(), Referer: BASE },
          signal: AbortSignal.timeout(120000),
        });
        keep(res);
        buf = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        console.log(`${key}: 通信できない（${e.name}） → ${REST / 60000}分待つ（${attempt}回目）`);
        await sleep(REST);
        await newSession().catch(() => {});
        continue;
      }
      const ok = res.ok && buf.subarray(0, 2).toString() === "PK";
      if (ok) {
        writeFileSync(`${OUT}/${key}.xlsx`, buf);
        done.add(key);
        save();
        got++;
        console.log(`${key}: ${buf.length.toLocaleString()}バイト`);
        break;
      }
      /*
        落ちているか、断られた。**あきらめずに待ち続ける。**
        メンテナンスは1時間続くこともあるので、回数では打ち切らない。
        15分空けて戻るのだから、待ち続けても相手の負担にはならない
      */
      console.log(
        `${key}: ${res.status} ${buf.length}バイト → ${REST / 60000}分待つ（${attempt}回目）`,
      );
      await sleep(REST);
      await newSession().catch(() => {});
    }
    await sleep(WAIT);
  }
}
console.log(`取得 ${got} 本 / 済みを飛ばした ${skipped} 本 / 合計 ${done.size} / 100`);
