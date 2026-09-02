/**
 * CHRIP の詳細から、**規制区分が無くて取り込めていなかった2つ**を切り出す。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-chrip-extra-data.ts [--write]
 *
 * 出るもの `scripts/data/chrip-extra.json`
 *
 *   pending … 安衛法 表示・通知対象で**まだ施行されていないもの**。
 *             CHRIP は適用日（令和9年4月1日など）を持っている。
 *             施行日ごとに規制区分を分けて登録するために、番号・名称・裾切値・CASを出す
 *   voc     … 大気汚染防止法の揮発性有機化合物（法第2条第4項）。
 *             条文は物質を名指しせず定義だけを置くので、
 *             **法文物質名は条文の定義文そのもの**を1件だけ持ち、そこに全CASをぶら下げる
 *             （CHRIP の一覧の見せ方と同じ）
 *
 * もとになるのは取り込みが当てられなかった記録 `.cache/chrip/misses.tsv` と、
 * 取得済みの詳細ページ。**新しく取りに行かない。**
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MISSES = ".cache/chrip/misses.tsv";
const ALL_CAS = ".cache/chrip/all-cas.json";
const DETAIL = ".cache/chrip/detail";
const OUT = "scripts/data/chrip-extra.json";

/** 大気汚染防止法（法そのもの）。揮発性有機化合物の定義はこの第2条第4項 */
const APA_LAW_ID = "343AC0000000097";
const VOC_NUMBER = "法第2条第4項";

/** CAS番号を持たない物質に付けた独自コードの頭（scripts/chrip-import.ts と揃える） */
const OWN_PREFIX = "CHRIP-";

/** 適用日の書き方 → 施行日（ISO）。ここに無い書き方は「施行済み」として扱わない */
const ERA: Record<string, string> = {
  令和9年4月1日施行: "2027-04-01",
  令和10年4月1日施行: "2028-04-01",
};

interface Pending {
  /** 施行日（ISO） */
  from: string;
  /** 安衛則別表第2 などの番号（本システムの書き方） */
  number: string;
  name: string;
  /** ラベル表示の裾切値。`すべて` は裾切値なし */
  label: string;
  /** SDS交付の裾切値 */
  sds: string;
  cas: string[];
}

interface Voc {
  /** 条文の項番号。CHRIP の政令番号と同じ書き方 */
  number: string;
  /** 条文の定義文。**e-Gov の条文から取り、CHRIP の記載と一致することを確かめる** */
  name: string;
  cas: string[];
}

interface Excluded {
  /** 政令番号（本システムの書き方） */
  number: string;
  name: string;
  cas: string;
}

/** タグを外して縦棒区切りの1行にする。項目名と値が隣り合う形になる */
function flatten(html: string): string {
  return html.replace(/<[^>]+>/g, "|").replace(/[\s|]+/g, "|");
}

/**
 * 裾切値を数にそろえる。CHRIP は `≧1`・`≧０．１`・`すべて` のように書く。
 * **`すべて` は裾切値なし**なので 0 にする（0を超えれば該当）。
 */
function threshold(raw: string | null): string {
  if (!raw) return "0";
  const s = raw
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[≧≥＞>]/g, "")
    .trim();
  return /^\d+(\.\d+)?$/.test(s) ? s : "0";
}

function pick(text: string, at: number, label: string): string | null {
  const m = new RegExp(`${label}\\|([^|]+)`).exec(text.slice(at, at + 400));
  return m ? m[1] : null;
}

/**
 * 大気汚染防止法 第2条第4項の定義文を、e-Gov の条文から取る。
 *
 * **法文物質名は一次資料から。**CHRIP も同じ文を載せているが、
 * 出どころは条文の側に置く（`docs/法規制データの作り方.md` 第0章）。
 */
async function vocDefinition(): Promise<string> {
  const path = join(".cache/laws", `${APA_LAW_ID}.xml`);
  if (!existsSync(path)) {
    const res = await fetch(`https://laws.e-gov.go.jp/api/1/lawdata/${APA_LAW_ID}`);
    if (!res.ok) throw new Error(`大気汚染防止法を取れません（${res.status}）`);
    writeFileSync(path, await res.text(), "utf8");
  }
  const xml = readFileSync(path, "utf8");
  const art = /<Article Num="2">([\s\S]*?)<\/Article>/.exec(xml);
  if (!art) throw new Error("大気汚染防止法 第2条が見つかりません");
  const text = art[1]!.replace(/<[^>]+>/g, "");
  // 「この法律において「揮発性有機化合物」とは、〜をいう。」の〜だけを取る
  const m = /「揮発性有機化合物」とは、([\s\S]*?)をいう。/.exec(text);
  if (!m) throw new Error("揮発性有機化合物の定義が見つかりません");
  return m[1]!.replace(/\s+/g, "");
}

async function main() {
  const write = process.argv.includes("--write");

  const index = JSON.parse(readFileSync(ALL_CAS, "utf-8")) as {
    cid: string;
    cas: string;
    nameJa: string;
    nameEn: string;
  }[];
  const cidOf = new Map<string, string>();
  const nameOf = new Map<string, { ja: string; en: string }>();
  for (const e of index) {
    if (!cidOf.has(e.cas)) cidOf.set(e.cas, e.cid);
    if (!nameOf.has(e.cas)) nameOf.set(e.cas, { ja: e.nameJa, en: e.nameEn });
    // CAS番号を持たない物質は `CHRIP-<詳細ページのID>` を鍵にしてある
    const own = `${OWN_PREFIX}${e.cid}`;
    if (!cidOf.has(own)) cidOf.set(own, e.cid);
    if (!nameOf.has(own)) nameOf.set(own, { ja: e.nameJa, en: e.nameEn });
  }

  const rows = readFileSync(MISSES, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string, string, string]);

  // ── 安衛法の未施行 ────────────────────────────────────────────
  const pending = new Map<string, Pending>();
  let noDate = 0;
  for (const [law, num, , cas] of rows) {
    if (law !== "JP-ISHA" || !num.startsWith("規則別表第2")) continue;
    const cid = cidOf.get(cas);
    const file = cid ? join(DETAIL, `${cid}.html`) : "";
    if (!file || !existsSync(file)) {
      noDate += 1;
      continue;
    }
    const text = flatten(readFileSync(file, "utf-8"));
    const at = text.indexOf(num);
    if (at < 0) {
      noDate += 1;
      continue;
    }
    const era = pick(text, at, "適用日") ?? "";
    const from = ERA[era];
    if (!from) {
      noDate += 1;
      continue;
    }
    // CHRIP の `規則別表第2の478の2` は、こちらでは `則別表第2の478-2`
    const number = num
      .replace(/^規則別表/, "則別表")
      .replace(/^(則別表第2の\d+)の(\d+)$/, "$1-$2")
      .replace(/\s+/g, "");
    const got = pending.get(number);
    if (got) {
      if (!got.cas.includes(cas)) got.cas.push(cas);
      continue;
    }
    pending.set(number, {
      from,
      number,
      name: pick(text, at, "政令名称") ?? "",
      label: threshold(pick(text, at, "表示の対象となる範囲（重量％）")),
      sds: threshold(pick(text, at, "通知の対象となる範囲（重量％）")),
      cas: [cas],
    });
  }

  // ── 大気汚染防止法の VOC ──────────────────────────────────────
  /*
    **法文物質名は条文の定義文1件。**条文が物質を名指ししていないので、
    物質ごとに行を立てるのではなく、定義文にすべてのCASをぶら下げる。
    CHRIP の一覧もこの見せ方をしている
  */
  const vocCas: string[] = [];
  const seen = new Set<string>();
  let vocFromChrip = "";
  for (const [law, num, name, cas] of rows) {
    if (law !== "JP-APA" || num !== VOC_NUMBER) continue;
    if (!vocFromChrip) vocFromChrip = name;
    if (seen.has(cas)) continue;
    seen.add(cas);
    vocCas.push(cas);
  }

  // 定義文は**条文から取る**。CHRIP の記載と食い違えば止める（どちらかが変わった合図）
  const vocName = await vocDefinition();
  if (vocFromChrip && !vocName.startsWith(vocFromChrip.slice(0, 20))) {
    throw new Error(`定義文が CHRIP の記載と合いません:
  条文 ${vocName}
  CHRIP ${vocFromChrip}`);
  }
  const voc: Voc = { number: VOC_NUMBER, name: vocName, cas: vocCas };

  // ── VOC から除かれる物質（令第2条の2）──────────────────────────
  const excluded: Excluded[] = [];
  for (const [law, num, name, cas] of rows) {
    if (law !== "JP-APA" || !num.startsWith("政令第2条の2")) continue;
    const number = num.replace(/^政令第/, "令第");
    if (excluded.some((e) => e.number === number)) continue;
    excluded.push({ number, name, cas });
  }

  const byEra = new Map<string, number>();
  for (const p of pending.values()) byEra.set(p.from, (byEra.get(p.from) ?? 0) + 1);
  console.log("安衛法の未施行");
  for (const [k, v] of [...byEra].sort()) console.log(`  ${k} から  ${v} 件`);
  if (noDate) console.log(`  適用日を読めず飛ばした: ${noDate} 件`);
  console.log(
    `大気 VOC: 法文物質名1件（定義文）に CAS ${voc.cas.length} 件 / 除かれる物質 ${excluded.length} 件`,
  );

  const data = { pending: [...pending.values()], voc, excluded };
  if (!write) {
    console.log("\n下見だけ。書き出すなら --write");
    return;
  }
  writeFileSync(join(process.cwd(), OUT), JSON.stringify(data, null, 1) + "\n", "utf-8");
  console.log(`\n→ ${OUT}`);
}

void main();
