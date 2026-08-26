/**
 * 投入用のデータ（`scripts/data/*.json`）を、法令の**原文から作り直す**。
 *
 *   npx tsx scripts/build-law-data.ts          いま置いてあるものと見比べる（既定）
 *   npx tsx scripts/build-law-data.ts --write  作り直して書き込む
 *
 * **これが無いと、データを一から作り直せない。**
 * 投入スクリプト（`seed-*.ts`）は JSON を読むだけなので、
 * その JSON をどう作ったかがここに無いと、出所が辿れなくなる。
 *
 * 作れるのは**条文に一覧が載っているものだけ**。
 * J-CHECK 由来（化審法の監視・優先評価・特定一般）と、
 * 告示由来の裾切値（安衛法の表示・SDS）は条文に無いので、ここでは作らない。
 *
 * 名前は `lib/law-name.ts` で第3章の表記に直してから入れる。
 * **原文の縦書きの書き方（漢数字・中黒）のままでは SDS に使えない。**
 * 取りかたは `docs/法規制データの作り方.md` 第8章・第11章。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { childrenOf, findAll, nodeText, parseXml, textOf, type XmlNode } from "./lib/egov-xml";
import { itemNumber, kanjiCount } from "./lib/kanji-count";
import { toDisplayName } from "./lib/law-name";

const CACHE = join(process.cwd(), ".cache", "laws");
const DATA = join(process.cwd(), "scripts", "data");

const LAW_ID = {
  化審法施行令: "349CO0000000202",
  化管法施行令: "412CO0000000138",
  毒劇法: "325AC0000000303",
  毒物及び劇物指定令: "340CO0000000002",
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

function appdxTable(root: XmlNode, title: string): XmlNode {
  const hit = findAll(root, "AppdxTable").find((t) => textOf(t, "AppdxTableTitle") === title);
  if (!hit) throw new Error(`別表が見つかりません: ${title}`);
  return hit;
}

function article(root: XmlNode, title: string): XmlNode {
  const main = findAll(root, "MainProvision")[0] ?? root;
  const hit = findAll(main, "Article").find((a) => textOf(a, "ArticleTitle") === title);
  if (!hit) throw new Error(`条が見つかりません: ${title}`);
  return hit;
}

interface RawItem {
  number: string;
  /** 号の本文（`ItemSentence`）。但し書きも入ったまま */
  sentence: string;
  /** `イ` `ロ` … の除外項目。毒劇法の「次に掲げるものを除く。」で使う */
  subitems: string[];
}

/** 直下の `Item` を拾う。番号が読めないもの（備考）は落とす */
function rawItems(parent: XmlNode): RawItem[] {
  const out: RawItem[] = [];
  for (const it of childrenOf(parent, "Item")) {
    const number = itemNumber(textOf(it, "ItemTitle"));
    if (number === null) continue;
    const sen = findAll(it, "ItemSentence")[0];
    const subs = findAll(it, "Subitem1").map((s) => {
      const t = textOf(s, "Subitem1Title");
      const b = findAll(s, "Subitem1Sentence")[0];
      return `${t} ${b ? nodeText(b) : nodeText(s)}`.trim();
    });
    out.push({ number, sentence: sen ? nodeText(sen) : nodeText(it), subitems: subs });
  }
  return out;
}

function rawItemsOfArticle(art: XmlNode): RawItem[] {
  const para = childrenOf(art, "Paragraph")[0];
  return para ? rawItems(para) : [];
}

const isDeleted = (i: RawItem) => i.sentence === "削除" || i.sentence === "";

/** 「。ただし、〜」を切り離す。名前と但し書きに分ける */
function splitProviso(sentence: string): { name: string; proviso: string } {
  const at = sentence.indexOf("。ただし、");
  if (at < 0) return { name: sentence, proviso: "" };
  return { name: sentence.slice(0, at), proviso: sentence.slice(at + 1) };
}

// --- 化審法 ---------------------------------------------------------------

interface KasinhoFile {
  [code: string]: { label: string; order: number; items: { number: string; name: string }[] };
}

/**
 * 化審法。**政令に載るのは第一種・第二種だけ。**
 *
 * 監視・優先評価・特定一般は三大臣の指定で、条文に名前が出てこない。
 * そちらは J-CHECK から取ったものをそのまま残す（第2章 2-2）
 */
async function buildKasinho(current: KasinhoFile): Promise<KasinhoFile> {
  const root = await loadLaw(LAW_ID.化審法施行令);
  const pick = (title: string) =>
    rawItemsOfArticle(article(root, title))
      .filter((i) => !isDeleted(i))
      .map((i) => ({ number: i.number, name: toDisplayName(i.sentence) }));

  return {
    ...current,
    C1: { ...current.C1!, items: pick("第一条") },
    C2: { ...current.C2!, items: pick("第二条") },
  };
}

// --- 化管法 ---------------------------------------------------------------

interface KakanhoRow {
  section: "C1" | "C2";
  number: string;
  name: string;
  note: string;
  special: boolean;
}

/**
 * 特定第一種の号番号を、令第4条の括弧書きから拾う。
 *
 * 独立した表は無い。**条文の括弧の中に別表第一の号番号が並んでいるだけ**なので、
 * 「第◯号」を順に読んで、`ロにおいて同じ` の手前までを取る
 */
function specialNumbers(root: XmlNode): Set<string> {
  const text = nodeText(article(root, "第四条"));
  const open = text.indexOf("特定第一種指定化学物質（別表第一");
  if (open < 0) throw new Error("令第4条に特定第一種の括弧書きがありません");
  const close = text.indexOf("に掲げる第一種指定化学物質をいう", open);
  if (close < 0) throw new Error("特定第一種の括弧書きの終わりが見つかりません");
  const body = text.slice(open, close);

  const out = new Set<string>();
  for (const m of body.matchAll(/第([〇一二三四五六七八九十百]+)号/g)) {
    const n = kanjiCount(m[1]!);
    if (n !== null) out.add(String(n));
  }
  if (out.size === 0) throw new Error("特定第一種の号番号を読めませんでした");
  return out;
}

async function buildKakanho(): Promise<KakanhoRow[]> {
  const root = await loadLaw(LAW_ID.化管法施行令);
  const special = specialNumbers(root);
  const out: KakanhoRow[] = [];

  for (const [section, title] of [
    ["C1", "別表第一"],
    ["C2", "別表第二"],
  ] as const) {
    for (const item of rawItems(appdxTable(root, title))) {
      if (isDeleted(item)) continue;
      out.push({
        section,
        number: item.number,
        name: toDisplayName(item.sentence),
        note: `化管法施行令 ${title}`,
        special: section === "C1" && special.has(item.number),
      });
    }
  }
  return out;
}

// --- 毒劇法 ---------------------------------------------------------------

interface DokugekiRow {
  section: "TOX" | "DEL" | "SPT";
  /** `L` は法の別表、`O` は指定令。**どちらにも1号があるので、これが無いとぶつかる** */
  src: "L" | "O";
  number: string;
  name: string;
  /** 出典と、閾値のもとになる但し書き。`seed-dokugeki-thresholds.ts` がここを読む */
  note: string;
}

async function buildDokugeki(): Promise<DokugekiRow[]> {
  const law = await loadLaw(LAW_ID.毒劇法);
  const order = await loadLaw(LAW_ID.毒物及び劇物指定令);
  const out: DokugekiRow[] = [];

  const plan = [
    { section: "TOX", table: "別表第一", article: "第一条" },
    { section: "DEL", table: "別表第二", article: "第二条" },
    { section: "SPT", table: "別表第三", article: "第三条" },
  ] as const;

  for (const p of plan) {
    for (const item of rawItems(appdxTable(law, p.table))) {
      if (isDeleted(item)) continue;
      const { name, proviso } = splitProviso(item.sentence);
      const tail = [proviso, ...item.subitems].filter((t) => t !== "").join(" ");
      out.push({
        section: p.section,
        src: "L",
        number: item.number,
        name: toDisplayName(name),
        note: tail === "" ? "毒物及び劇物取締法 別表" : `毒物及び劇物取締法 別表 ${tail}`,
      });
    }
  }
  for (const p of plan) {
    for (const item of rawItemsOfArticle(article(order, p.article))) {
      if (isDeleted(item)) continue;
      const { name, proviso } = splitProviso(item.sentence);
      const tail = [proviso, ...item.subitems].filter((s) => s !== "").join(" ");
      out.push({
        section: p.section,
        src: "O",
        number: item.number,
        name: toDisplayName(name),
        note: tail === "" ? "毒物及び劇物指定令" : `毒物及び劇物指定令 ${tail}`,
      });
    }
  }
  return out;
}

// --- 見比べ ---------------------------------------------------------------

function compare(label: string, made: unknown, current: unknown): boolean {
  const a = JSON.stringify(made, null, 1);
  const b = JSON.stringify(current, null, 1);
  if (a === b) {
    console.log(`✓ ${label} は原文どおり`);
    return true;
  }
  const al = a.split("\n");
  const bl = b.split("\n");
  console.log(`✗ ${label} が食い違います（作り ${al.length}行 / いま ${bl.length}行）`);
  let shown = 0;
  for (let i = 0; i < Math.max(al.length, bl.length) && shown < 12; i += 1) {
    if (al[i] !== bl[i]) {
      console.log(`    ${i + 1}行目`);
      console.log(`      原文から: ${al[i] ?? "（無し）"}`);
      console.log(`      いまの値: ${bl[i] ?? "（無し）"}`);
      shown += 1;
    }
  }
  return false;
}

async function main() {
  const write = process.argv.includes("--write");
  const read = (name: string) => JSON.parse(readFileSync(join(DATA, name), "utf8")) as never;

  const built: { name: string; made: unknown }[] = [
    { name: "kasinho.json", made: await buildKasinho(read("kasinho.json")) },
    { name: "kakanho.json", made: await buildKakanho() },
    { name: "dokugeki.json", made: await buildDokugeki() },
  ];

  let allSame = true;
  for (const b of built) {
    if (!compare(b.name, b.made, read(b.name))) allSame = false;
    if (write) {
      writeFileSync(join(DATA, b.name), `${JSON.stringify(b.made, null, 1)}\n`, "utf8");
    }
  }

  if (write) {
    console.log("\n書き込みました。`seed-*.ts` を流し直してください。");
  } else if (allSame) {
    console.log("\nすべて原文から作り直せました。");
  } else {
    console.log("\n食い違いがあります。**原文が正しい**（第3章）。--write で作り直します。");
  }
  console.log("\n作れないもの（条文に無い）:");
  console.log("  化審法 監視・優先評価・特定一般 … 三大臣の指定。J-CHECK から手で取る");
  console.log("  安衛法 表示・SDS の裾切値      … 告示。厚生労働省の一覧から取る");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
