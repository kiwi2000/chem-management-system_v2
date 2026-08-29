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

/** 1回に出せる法規制は10個まで。23個を3回に分ける */
const PASSES = [
  "s4_s5_s6_s7_s9_s19_s20_s24_s25_s28",
  "s32_s33_s39_s41_s42_s43_s67_s68_s69_s72",
  "s73_s74_s76",
];

/**
 * 1回ごとに空ける時間（ミリ秒）。
 * **急がない。**300本を1時間かけて取っても、後の工程に響かない。
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
console.log(`取得 ${got} 本 / 済みを飛ばした ${skipped} 本 / 合計 ${done.size} / 300`);
