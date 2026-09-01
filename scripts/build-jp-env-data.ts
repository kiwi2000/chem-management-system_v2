/**
 * 環境系4法の投入用データ（`scripts/data/jp-env.json`）を、条文から作る。
 *
 *   npx tsx scripts/build-jp-env-data.ts          いま置いてあるものと見比べる
 *   npx tsx scripts/build-jp-env-data.ts --write  作り直して書き込む
 *
 * 対象は 大気汚染防止法・水質汚濁防止法・土壌汚染対策法・化学兵器禁止法。
 * どれも施行令に一覧が載っているので、**e-Gov 法令API だけで作れる**（第8章 8-5）。
 *
 * 名前は第3章の表記の決めごとを当てる（`lib/law-name.ts`）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { childrenOf, findAll, nodeText, parseXml, textOf, type XmlNode } from "./lib/egov-xml";
import { itemNumber, kanjiCount } from "./lib/kanji-count";
import { toDisplayName } from "./lib/law-name";

const CACHE = join(process.cwd(), ".cache", "laws");
const OUT = join(process.cwd(), "scripts", "data", "jp-env.json");

export interface EnvItem {
  /** 法令コード */
  law: string;
  /** 区分コード */
  section: string;
  /** 条文が振っている番号 */
  number: string;
  name: string;
  /** どの条文から取ったか。**出どころを1件ずつ持つ** */
  note: string;
}

const LAW_ID = {
  大気汚染防止法施行令: "343CO0000000329",
  水質汚濁防止法施行令: "346CO0000000188",
  土壌汚染対策法施行令: "414CO0000000336",
  化学兵器禁止法施行令: "407CO0000000192",
} as const;

async function loadLaw(lawId: string): Promise<XmlNode> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `${lawId}.xml`);
  if (!existsSync(path)) {
    const res = await fetch(`https://laws.e-gov.go.jp/api/1/lawdata/${lawId}`);
    if (!res.ok) throw new Error(`${lawId} を取れません（${res.status}）`);
    writeFileSync(path, await res.text(), "utf8");
  }
  return parseXml(readFileSync(path, "utf8"));
}

function article(root: XmlNode, title: string): XmlNode {
  const main = findAll(root, "MainProvision")[0] ?? root;
  const hit = findAll(main, "Article").find((a) => textOf(a, "ArticleTitle") === title);
  if (!hit) throw new Error(`条が見つかりません: ${title}`);
  return hit;
}

/** 条の第1項の各号を「番号 → 名前」にする */
function itemsOfArticle(art: XmlNode): { number: string; name: string }[] {
  const para = childrenOf(art, "Paragraph")[0];
  if (!para) return [];
  const out: { number: string; name: string }[] = [];
  for (const it of childrenOf(para, "Item")) {
    const number = itemNumber(textOf(it, "ItemTitle"));
    if (number === null) continue;
    const sen = findAll(it, "ItemSentence")[0];
    const name = sen ? nodeText(sen) : nodeText(it);
    if (name === "削除" || name === "") continue;
    out.push({ number, name });
  }
  return out;
}

/**
 * 化学兵器禁止法の別表を読む。
 *
 * **1つのセルの中に `（一）（二）…` と物質が並ぶ**という、他に無い作り。
 * 列は「第一欄=番号／第二欄=区分名／第三欄=毒性物質／第四欄=原料物質」。
 * セルの文字列を `（漢数字）` で割る
 */
function splitEnumerated(cell: string): { number: string; name: string }[] {
  /*
    **番号は 一 から順に続くものだけを項目の始まりとみなす。**
    本文の中に「一の項の第三欄（一）から（四）まで」のような**参照**が入っており、
    括弧だけで拾うとそれを項目と取り違える（実際に起きた）
  */
  const marks = [...cell.matchAll(/（([〇一二三四五六七八九十]+)）/g)];
  const heads: { at: number; len: number; number: string }[] = [];
  let expect = 1;
  for (const m of marks) {
    if (kanjiCount(m[1]!) !== expect) continue;
    heads.push({ at: m.index, len: m[0].length, number: m[1]! });
    expect += 1;
  }
  const out: { number: string; name: string }[] = [];
  for (const [i, h] of heads.entries()) {
    const end = i + 1 < heads.length ? heads[i + 1]!.at : cell.length;
    const name = cell.slice(h.at + h.len, end).trim();
    if (name !== "") out.push({ number: h.number, name });
  }
  return out;
}

/** 条から取る一覧の指定 */
const FROM_ARTICLE: {
  law: string;
  section: string;
  lawId: string;
  article: string;
  note: string;
}[] = [
  {
    law: "JP-APA",
    section: "HAZARD",
    lawId: LAW_ID.大気汚染防止法施行令,
    article: "第一条",
    note: "大気汚染防止法施行令 第1条（有害物質）",
  },
  {
    law: "JP-WPCA",
    section: "HAZARD",
    lawId: LAW_ID.水質汚濁防止法施行令,
    article: "第二条",
    note: "水質汚濁防止法施行令 第2条（カドミウム等の物質）",
  },
  {
    law: "JP-WPCA",
    section: "DESIGNATED",
    lawId: LAW_ID.水質汚濁防止法施行令,
    article: "第三条の三",
    note: "水質汚濁防止法施行令 第3条の3（指定物質）",
  },
  {
    law: "JP-SCCA",
    section: "SPECIFIED",
    lawId: LAW_ID.土壌汚染対策法施行令,
    article: "第一条",
    note: "土壌汚染対策法施行令 第1条（特定有害物質）",
  },
];

/** 化学兵器禁止法の別表。区分名 → 区分コード */
const CW_SECTIONS: Record<string, string> = {
  特定物質: "SPECIFIED",
  第一種指定物質: "DESIG1",
  第二種指定物質: "DESIG2",
};

async function buildFromArticles(): Promise<EnvItem[]> {
  const out: EnvItem[] = [];
  for (const f of FROM_ARTICLE) {
    const root = await loadLaw(f.lawId);
    for (const i of itemsOfArticle(article(root, f.article))) {
      out.push({
        law: f.law,
        section: f.section,
        number: i.number,
        name: toDisplayName(i.name),
        note: f.note,
      });
    }
  }
  return out;
}

/** 大気汚染防止法の特定粉じん。**条文が石綿1つを名指ししている** */
async function buildDust(): Promise<EnvItem[]> {
  const root = await loadLaw(LAW_ID.大気汚染防止法施行令);
  const text = nodeText(article(root, "第二条の四"));
  if (!text.includes("石綿")) throw new Error("令第2条の4に石綿がありません");
  return [
    {
      law: "JP-APA",
      section: "DUST",
      number: "1",
      name: "石綿",
      note: "大気汚染防止法施行令 第2条の4（特定粉じん）",
    },
  ];
}

async function buildChemicalWeapons(): Promise<EnvItem[]> {
  const root = await loadLaw(LAW_ID.化学兵器禁止法施行令);
  const table = findAll(root, "AppdxTable")[0];
  if (!table) throw new Error("化学兵器禁止法施行令の別表がありません");

  const out: EnvItem[] = [];
  for (const row of findAll(table, "TableRow")) {
    const cols = childrenOf(row, "TableColumn").map((c) => nodeText(c));
    if (cols.length < 4) continue;
    const section = CW_SECTIONS[cols[1] ?? ""];
    if (!section) continue;
    // 第一欄が項の番号（一・二・三）。**同じ欄・同じ枝番が項ごとに出る**ので番号に入れる
    const para = (cols[0] ?? "").trim();
    // 第三欄が毒性物質、第四欄が原料物質。**どちらも規制の対象**
    for (const [col, kind] of [
      [cols[2]!, "毒性物質"],
      [cols[3]!, "原料物質"],
    ] as const) {
      for (const i of splitEnumerated(col)) {
        out.push({
          law: "JP-CWCA",
          section,
          number: `${para}-${kind === "毒性物質" ? "3" : "4"}-${i.number}`,
          name: toDisplayName(i.name),
          note: `化学兵器禁止法施行令 別表 ${cols[1]} 第${kind === "毒性物質" ? "三" : "四"}欄（${kind}）`,
        });
      }
    }
  }
  return out;
}

async function main() {
  const write = process.argv.includes("--write");
  const all = [
    ...(await buildFromArticles()),
    ...(await buildDust()),
    ...(await buildChemicalWeapons()),
  ];

  const tally = new Map<string, number>();
  for (const i of all)
    tally.set(`${i.law} ${i.section}`, (tally.get(`${i.law} ${i.section}`) ?? 0) + 1);
  for (const [k, v] of tally) console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)}件`);
  console.log(`\n合計 ${all.length}件`);

  if (write) {
    writeFileSync(OUT, `${JSON.stringify(all, null, 1)}\n`, "utf8");
    console.log(`→ ${OUT}`);
  } else if (existsSync(OUT)) {
    const now = readFileSync(OUT, "utf8");
    console.log(
      now === `${JSON.stringify(all, null, 1)}\n`
        ? "いま置いてあるものと同じです。"
        : "食い違います。--write で作り直します。",
    );
  } else {
    console.log("まだ書き出していません。--write で作ります。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
