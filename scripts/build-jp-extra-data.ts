/**
 * あとから足した日本の法規制の**名前と番号を、法令の原文から作る**。
 * 出来上がりは `scripts/data/jp-extra-lawtext.json`。取り込みは seed-jp-extra-laws.ts。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-jp-extra-data.ts
 *   ... scripts/build-jp-extra-data.ts --write
 *
 * **名前は法令の原文を使う。**外部データベース（LOLI・CHRIP）の物質名は法令の言葉ではない。
 * 原文は縦書きの組バージョンなので、漢数字と中黒を `lib/law-name.ts` で算用数字に直す
 * （`docs/法規制データの作り方.md` 第3章）。
 *
 * 作れるもの
 *   オゾン層保護法施行令 別表第一（特定物質）・別表第二（特定物質代替物質）
 *   鉛中毒予防規則 第1条（鉛等の定義）
 *   四アルキル鉛中毒予防規則 第1条（四アルキル鉛等の定義）
 *
 * **作れないもの。**安衛法の「皮膚等障害化学物質等」と「がん原性物質」は
 * 厚生労働省告示で、e-Gov の法令検索に載っていない。名前は外部データベースのものを使い、
 * 備考に法令の言葉ではないと書く。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { childrenOf, findAll, nodeText, parseXml, textOf, type XmlNode } from "./lib/egov-xml";
import { toDisplayName } from "./lib/law-name";

const CACHE = join(process.cwd(), ".cache", "laws");
const DATA = join(process.cwd(), "scripts", "data");
const OUT = "jp-extra-lawtext.json";

const LAW_ID = {
  オゾン層保護法施行令: "406CO0000000308",
  鉛則: "347M50002000037",
  四アルキル鉛則: "347M50002000038",
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

const KANJI = "〇一二三四五六七八九";

/**
 * 係数（オゾン破壊係数・地球温暖化係数）を読む。
 *
 * **物質名と同じ直しかたは使えない。**物質名では中黒が位置番号の区切りなので読点になるが、
 * ここでは小数点。`一・〇` は 1.0、`一、一〇〇` は 1,100 で、読点は桁区切り
 */
function readFactor(raw: string): string {
  const digits = raw.replace(/[〇一二三四五六七八九]/g, (c) => String(KANJI.indexOf(c)));
  return digits
    .replace(/・/g, ".")
    .replace(/[、，]/g, ",")
    .trim();
}

/** 漢数字だけの並びを数にする。`一` `二〇` `三四` */
function kanjiToNumber(raw: string): string {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return s;
  let out = "";
  for (const ch of s) {
    const i = KANJI.indexOf(ch);
    if (i < 0) return s;
    out += String(i);
  }
  // `二〇` は 20。先頭のゼロは落とす
  return String(Number(out));
}

interface OzoneItem {
  /** 号の番号（`1` `13`） */
  number: string;
  /** 法文の物質名（算用数字に直したもの） */
  name: string;
  /** オゾン破壊係数・地球温暖化係数。閾値ではないので備考に回す */
  factor: string;
}
interface OzoneParagraph {
  /** 項の番号（`1`〜`9`） */
  number: string;
  /** 項の見出し（`議定書附属書AのグループI`） */
  group: string;
  items: OzoneItem[];
}

/**
 * 別表を読む。
 *
 * 表は「項の見出し／物質／係数」の3欄だが、**同じ項の2行目からは見出し欄が無い**。
 * 見出しを覚えておいて、欄が2つの行はその続きとして扱う。
 */
function readTable(root: XmlNode, title: string): OzoneParagraph[] {
  const table = findAll(root, "AppdxTable").find((t) => textOf(t, "AppdxTableTitle") === title);
  if (!table) throw new Error(`別表が見つかりません: ${title}`);

  const out: OzoneParagraph[] = [];
  let current: OzoneParagraph | null = null;
  /** 直前に出た号の番号。枝番はここにぶら下げる */
  let parentNumber = "";
  for (const row of findAll(table, "TableRow")) {
    const cols = childrenOf(row, "TableColumn").map((c) =>
      nodeText(c)
        .replace(/\u3000/g, " ")
        .trim(),
    );
    let name: string;
    let factor: string;
    if (cols.length >= 3) {
      const head = cols[0] ?? "";
      // 見出しの行。`一  議定書附属書ＡのグループⅠ`
      const m = /^(\S+)\s+(.+)$/.exec(head);
      if (m) {
        current = { number: kanjiToNumber(m[1]), group: toDisplayName(m[2]), items: [] };
        out.push(current);
      }
      [, name, factor] = cols as [string, string, string];
    } else if (cols.length === 2) {
      [name, factor] = cols as [string, string];
    } else {
      continue;
    }
    if (!current || name === "") continue;
    /*
      物質の行は `（一）  トリクロロフルオロメタン…` の形。
      **その項に物質が1つしかないときは号の番号が無い**（四塩化炭素など）。
      法文もそれを「別表第一の四の項の中欄に掲げる特定物質」と呼ぶので、番号は空にする
    */
    const item = /^（(.+?)）\s*(.+)$/.exec(name);
    /*
      **号の下にさらに枝番がある。**異性体で係数が変わるものは
      `（六） ジクロロトリフルオロエタン` の下に `１ 二・二―ジクロロ…` `２ その他のもの`
      と分かれる。親の行には係数が無く、枝番のほうが持つ
    */
    if (!item) {
      const sub = /^([０-９\d]+)\s+(.+)$/.exec(name);
      // **親は号の行。**直前の行を親にすると、2つめの枝番が入れ子になる（`6の1の2`）
      if (sub && parentNumber) {
        current.items.push({
          number: `${parentNumber}の${kanjiToNumber(sub[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)))}`,
          name: toDisplayName(sub[2]),
          factor: readFactor(factor),
        });
        continue;
      }
    }
    parentNumber = item ? kanjiToNumber(item[1]) : "";
    current.items.push({
      number: parentNumber,
      name: toDisplayName(item ? item[2] : name),
      factor: readFactor(factor),
    });
  }
  return out;
}

/** 第1条の、指定した号の「用語  意義」を読む */
function definition(root: XmlNode, itemNumber: string) {
  const main = findAll(root, "MainProvision")[0] ?? root;
  const first = findAll(main, "Article").find((a) => textOf(a, "ArticleTitle") === "第一条");
  if (!first) throw new Error("第一条が見つかりません");
  const item = findAll(first, "Item").find((i) => textOf(i, "ItemTitle") === itemNumber);
  if (!item) throw new Error(`第一条 ${itemNumber} が見つかりません`);
  /*
    定義の号は「用語」と「意義」の2つの欄でできている。
    まとめて文字にすると「一鉛等鉛、鉛合金及び…」とつながって分けられないので、
    欄のまま読む
  */
  const sentence = findAll(item, "ItemSentence")[0];
  const columns = sentence ? childrenOf(sentence, "Column") : [];
  if (columns.length < 2) {
    throw new Error(`第一条 ${itemNumber} が用語と意義に分かれていません`);
  }
  return {
    term: toDisplayName(nodeText(columns[0]).trim()),
    meaning: toDisplayName(nodeText(columns[1]).trim()),
  };
}

async function main() {
  const write = process.argv.includes("--write");

  const ozone = await loadLaw(LAW_ID.オゾン層保護法施行令);
  const specified = readTable(ozone, "別表第一");
  const alternative = readTable(ozone, "別表第二");

  const lead = await loadLaw(LAW_ID.鉛則);
  const tetraalkyl = await loadLaw(LAW_ID.四アルキル鉛則);

  const built = {
    ozone: { specified, alternative },
    lead: { number: "鉛則第1条第1号", ...definition(lead, "一") },
    tetraalkyl: { number: "四アルキル鉛則第1条第3号", ...definition(tetraalkyl, "三") },
  };

  console.log("オゾン層保護法施行令");
  for (const [label, table] of [
    ["別表第一（特定物質）", specified],
    ["別表第二（特定物質代替物質）", alternative],
  ] as const) {
    const n = table.reduce((a, p) => a + p.items.length, 0);
    console.log(`  ${label}  項 ${table.length} / 号 ${n}`);
    for (const p of table) console.log(`    ${p.number} ${p.group}  ${p.items.length} 件`);
  }
  console.log(`\n鉛則  ${built.lead.number}  ${built.lead.term}`);
  console.log(`  ${built.lead.meaning}`);
  console.log(`四アルキル鉛則  ${built.tetraalkyl.number}  ${built.tetraalkyl.term}`);
  console.log(`  ${built.tetraalkyl.meaning}`);

  if (write) {
    writeFileSync(join(DATA, OUT), `${JSON.stringify(built, null, 1)}\n`, "utf8");
    console.log(`\n${OUT} に書きました。seed-jp-extra-laws.ts を流し直してください。`);
  } else {
    console.log("\n下見だけ。書き込むなら --write");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
