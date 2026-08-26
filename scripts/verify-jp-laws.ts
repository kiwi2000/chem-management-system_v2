/**
 * 登録済みの法文物質名を、法令の**原文**と突き合わせる。
 *
 *   npx tsx scripts/verify-jp-laws.ts                  全部
 *   npx tsx scripts/verify-jp-laws.ts JP-PRTR          法律を絞る
 *   npx tsx scripts/verify-jp-laws.ts --tsv out.tsv    食い違いを書き出す
 *
 * 見るのは**件数 → 番号 → 名前**の順（`docs/法規制データの作り方.md` 第6章）。
 * 名前は第3章の書式の違いを吸収してから比べる。**保存されている名前は変えない。**
 *
 * 原文は e-Gov 法令API から取り、`.cache/laws/` に置く。
 * 2回目からはそれを読むので、繋がらなくても動く。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { bareNumber } from "./lib/statutory-number";
import { childrenOf, findAll, nodeText, parseXml, textOf, type XmlNode } from "./lib/egov-xml";
import { itemNumber, subitemNumber } from "./lib/kanji-count";
import { toDisplayName } from "./lib/law-name";

const prisma = new PrismaClient();
const CACHE = join(process.cwd(), ".cache", "laws");

/** 原文の1行 */
interface LawItem {
  number: string;
  name: string;
  /** 出典の印（毒劇法だけ使う）。登録側の `code` に入っているものと同じ */
  tag?: string;
}

/** 区分ごとの「原文のどこを見るか」 */
interface Source {
  law: string;
  category: string;
  /** 原文の在りか。複数あるときは順に足す（毒劇法は法と指定令の2か所） */
  parts: {
    lawId: string;
    pick: (root: XmlNode) => LawItem[];
    /**
     * 出典の印。**毒劇法は法と指定令で号番号がぶつかる**（どちらにも1号がある）。
     * 登録側は `code` の `-L-` `-O-` で分けてあるので、そちらに合わせて突き合わせる
     */
    tag?: string;
  }[];
  note?: string;
}

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

/** 別表を探す。見出しが合うものだけ */
function appdxTable(root: XmlNode, title: string): XmlNode {
  const hit = findAll(root, "AppdxTable").find((t) => textOf(t, "AppdxTableTitle") === title);
  if (!hit) throw new Error(`別表が見つかりません: ${title}`);
  return hit;
}

/** 条を探す。**本則の条だけ**（附則にも同じ見出しの条がある） */
function article(root: XmlNode, title: string): XmlNode {
  const main = findAll(root, "MainProvision")[0] ?? root;
  const hit = findAll(main, "Article").find((a) => textOf(a, "ArticleTitle") === title);
  if (!hit) throw new Error(`条が見つかりません: ${title}`);
  return hit;
}

/** 直下の `Item` を「番号 → 名前」にする。番号が読めないもの（備考）は落とす */
function itemsOf(parent: XmlNode): LawItem[] {
  const out: LawItem[] = [];
  for (const it of childrenOf(parent, "Item")) {
    const number = itemNumber(textOf(it, "ItemTitle"));
    if (number === null) continue;
    const sentence = findAll(it, "ItemSentence")[0];
    out.push({ number, name: sentence ? nodeText(sentence) : nodeText(it) });
  }
  return out;
}

/**
 * 別表の号の中の**細目**を取る（安衛法の令別表第三は「第一号の1〜7」という作り）。
 * 細目の見出しは算用数字
 */
function subitemsOf(table: XmlNode, itemTitle: string): LawItem[] {
  const item = childrenOf(table, "Item").find((i) => textOf(i, "ItemTitle") === itemTitle);
  if (!item) throw new Error(`号が見つかりません: ${itemTitle}`);
  const out: LawItem[] = [];
  for (const sub of findAll(item, "Subitem1")) {
    const number = subitemNumber(textOf(sub, "Subitem1Title"));
    if (number === null) continue;
    const sentence = findAll(sub, "Subitem1Sentence")[0];
    out.push({ number, name: sentence ? nodeText(sentence) : nodeText(sub) });
  }
  return out;
}

/** 条の中の `Item`（`Paragraph` にぶら下がっている） */
function itemsOfArticle(art: XmlNode): LawItem[] {
  const para = childrenOf(art, "Paragraph")[0];
  return para ? itemsOf(para) : [];
}

/** 削除された号は数えない。原文が「削除」とだけ書いてある */
const isDeleted = (i: LawItem) => i.name === "削除" || i.name === "";

/**
 * 末尾の「〜を含有する製剤その他の物」は**裾切値を定める条文**で、物質ではない。
 * 数に入れると1件ずつ多くなる
 */
const isThresholdClause = (name: string) =>
  /含有する製剤その他の物/.test(name) ||
  /前各号に掲げる物のみから成る混合物/.test(name) ||
  /^\d+から\d+までに掲げる物/.test(name);

const SOURCES: Source[] = [
  {
    law: "JP-PRTR",
    category: "C1",
    parts: [{ lawId: "412CO0000000138", pick: (r) => itemsOf(appdxTable(r, "別表第一")) }],
  },
  {
    law: "JP-PRTR",
    category: "C2",
    parts: [{ lawId: "412CO0000000138", pick: (r) => itemsOf(appdxTable(r, "別表第二")) }],
  },
  {
    law: "JP-PDSCA",
    category: "TOX",
    parts: [
      { lawId: "325AC0000000303", pick: (r) => itemsOf(appdxTable(r, "別表第一")), tag: "L" },
      { lawId: "340CO0000000002", pick: (r) => itemsOfArticle(article(r, "第一条")), tag: "O" },
    ],
    note: "法別表第一と指定令第一条の2か所に分かれている",
  },
  {
    law: "JP-PDSCA",
    category: "DEL",
    parts: [
      { lawId: "325AC0000000303", pick: (r) => itemsOf(appdxTable(r, "別表第二")), tag: "L" },
      { lawId: "340CO0000000002", pick: (r) => itemsOfArticle(article(r, "第二条")), tag: "O" },
    ],
    note: "法別表第二と指定令第二条",
  },
  {
    law: "JP-PDSCA",
    category: "SPT",
    parts: [
      { lawId: "325AC0000000303", pick: (r) => itemsOf(appdxTable(r, "別表第三")), tag: "L" },
      { lawId: "340CO0000000002", pick: (r) => itemsOfArticle(article(r, "第三条")), tag: "O" },
    ],
    note: "法別表第三と指定令第三条",
  },
  {
    law: "JP-CSCL",
    category: "C1",
    parts: [{ lawId: "349CO0000000202", pick: (r) => itemsOfArticle(article(r, "第一条")) }],
  },
  {
    law: "JP-CSCL",
    category: "C2",
    parts: [{ lawId: "349CO0000000202", pick: (r) => itemsOfArticle(article(r, "第二条")) }],
  },
  {
    law: "JP-ISHA",
    category: "MFG_BAN",
    parts: [{ lawId: "347CO0000000318", pick: (r) => itemsOfArticle(article(r, "第十六条")) }],
    note: "令第16条第1項。9号は裾切値なので数えない",
  },
  {
    law: "JP-ISHA",
    category: "MFG_PERMIT",
    parts: [{ lawId: "347CO0000000318", pick: (r) => subitemsOf(appdxTable(r, "別表第三"), "一") }],
    note: "令第17条が令別表第三第一号を指す。8は裾切値",
  },
  {
    law: "JP-ISHA",
    category: "SPEC1",
    parts: [{ lawId: "347CO0000000318", pick: (r) => subitemsOf(appdxTable(r, "別表第三"), "一") }],
  },
  {
    law: "JP-ISHA",
    category: "SPEC2",
    parts: [{ lawId: "347CO0000000318", pick: (r) => subitemsOf(appdxTable(r, "別表第三"), "二") }],
    note: "37は「厚生労働省令で定めるもの」で裾切値",
  },
  {
    law: "JP-ISHA",
    category: "SPEC3",
    parts: [{ lawId: "347CO0000000318", pick: (r) => subitemsOf(appdxTable(r, "別表第三"), "三") }],
  },
  {
    law: "JP-ISHA",
    category: "ORG",
    parts: [{ lawId: "347CO0000000318", pick: (r) => itemsOf(appdxTable(r, "別表第六の二")) }],
    note: "55号のうち10号が削除。55号は混合物なので数えない",
  },
];

/**
 * 括弧書きを落とす。**入れ子になっていることがある**ので、無くなるまで繰り返す。
 * 1回だけだと内側しか消えず、外側の「炭素数が六のものに限る。」などが残る
 */
function stripParens(text: string): string {
  let s = text;
  for (;;) {
    const next = s.replace(/\([^()]*\)/g, "");
    if (next === s) return s;
    s = next;
  }
}

/** 照合のためだけの正規化。**保存する名前は変えない**（第6章） */
function normalize(name: string): string {
  // 「。ただし、〜を除く。」は裾切値の定めで、登録側は構造化して名前から外してある
  const withoutProviso = name.replace(/。\s*ただし、[\s\S]*$/, "");
  return stripParens(toDisplayName(withoutProviso).normalize("NFKC"))
    .replace(/[‐-―−－ー-]/g, "")
    .replace(/[‘’ʼ＇'′″“”]/g, "")
    .replace(/[・,、.]/g, "")
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
}

interface Diff {
  law: string;
  category: string;
  kind: "原文だけ" | "登録だけ" | "名前ちがい";
  number: string;
  lawName: string;
  ourName: string;
}

async function main() {
  const args = process.argv.slice(2);
  const tsvAt = args.indexOf("--tsv");
  const tsvPath = tsvAt >= 0 ? args[tsvAt + 1] : null;
  const only = args.filter((a) => a.startsWith("JP-"));

  const diffs: Diff[] = [];
  let allMatch = true;

  for (const src of SOURCES) {
    if (only.length > 0 && !only.includes(src.law)) continue;

    const lawItems: LawItem[] = [];
    for (const part of src.parts) {
      const root = await loadLaw(part.lawId);
      for (const item of part.pick(root)) {
        if (isDeleted(item)) continue;
        lawItems.push({ ...item, tag: part.tag });
      }
    }
    const substances = lawItems.filter((i) => !isThresholdClause(i.name));

    const ours = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        regulationClass: { category: { code: src.category, law: { code: src.law } } },
      },
      select: { code: true, officialNumber: true, nameOriginal: true, nameJa: true },
    });

    /**
     * 登録側の鍵。印がある区分は `code` の `-L-` `-O-` から取る。
     *
     * **番号は出典を含む形で持っている**（第0-3章）ので、枝番だけに戻して当てる。
     * ここは1つの表と突き合わせるので、枝番だけで一意になる
     */
    const ourKey = (o: { code: string; officialNumber: string | null }) => {
      const m = /-([LO])-/.exec(o.code);
      const num = bareNumber(o.officialNumber ?? "") ?? (o.officialNumber ?? "").trim();
      return m ? `${m[1]}:${num}` : num;
    };
    const lawKey = (i: LawItem) => (i.tag ? `${i.tag}:${i.number}` : i.number);

    const ourByNum = new Map<string, string[]>();
    for (const o of ours) {
      const key = ourKey(o);
      if (!ourByNum.has(key)) ourByNum.set(key, []);
      ourByNum.get(key)!.push(o.nameJa ?? o.nameOriginal);
    }

    const lawNums = new Set(substances.map(lawKey));
    const missing = substances.filter((i) => !ourByNum.has(lawKey(i)));
    const extra = [...ourByNum.keys()].filter((n) => !lawNums.has(n));

    let nameNg = 0;
    for (const item of substances) {
      const g = ourByNum.get(lawKey(item));
      if (!g) continue;
      if (!g.some((name) => normalize(name) === normalize(item.name))) {
        nameNg += 1;
        diffs.push({
          law: src.law,
          category: src.category,
          kind: "名前ちがい",
          number: item.number,
          lawName: item.name,
          ourName: g.join(" / "),
        });
      }
    }
    for (const m of missing) {
      diffs.push({
        law: src.law,
        category: src.category,
        kind: "原文だけ",
        number: m.number,
        lawName: m.name,
        ourName: "",
      });
    }
    for (const e of extra) {
      diffs.push({
        law: src.law,
        category: src.category,
        kind: "登録だけ",
        number: e,
        lawName: "",
        ourName: (ourByNum.get(e) ?? []).join(" / "),
      });
    }

    const ok = missing.length === 0 && extra.length === 0 && nameNg === 0;
    if (!ok) allMatch = false;
    console.log(
      `${ok ? "✓" : "✗"} ${src.law} ${src.category.padEnd(5)}` +
        ` 原文 ${String(substances.length).padStart(4)} / 登録 ${String(ours.length).padStart(4)}` +
        `   欠け ${String(missing.length).padStart(3)}  余分 ${String(extra.length).padStart(3)}` +
        `  名前ちがい ${String(nameNg).padStart(3)}`,
    );
    if (src.note) console.log(`     （${src.note}）`);
  }

  if (tsvPath) {
    const head = "法律\t区分\t種別\t番号\t原文の名前\t登録の名前\n";
    const body = diffs
      .map((d) => [d.law, d.category, d.kind, d.number, d.lawName, d.ourName].join("\t"))
      .join("\n");
    writeFileSync(tsvPath, `${head + body}\n`, "utf8");
    console.log(`\n食い違い ${diffs.length}件 → ${tsvPath}`);
  } else if (diffs.length > 0) {
    console.log(`\n食い違い ${diffs.length}件（先頭20件）`);
    for (const d of diffs.slice(0, 20)) {
      console.log(`  [${d.law} ${d.category} ${d.number}] ${d.kind}`);
      if (d.lawName) console.log(`     原文: ${d.lawName.slice(0, 90)}`);
      if (d.ourName) console.log(`     登録: ${d.ourName.slice(0, 90)}`);
    }
  }
  console.log(
    allMatch ? "\nすべて一致しました。" : "\n食い違いがあります。**原文が正しい**（第3章）。",
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
