/**
 * 環境系のうち、区分が無かった2つを足す。
 *
 *   bash scripts/loli-dump-jp-env-extra.sh                                   先にCASを取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-jp-env-extra.ts           下見
 *   ... scripts/seed-jp-env-extra.ts --write                                 入れる（入れ直し）
 *   ... scripts/seed-jp-env-extra.ts --remove                                消す
 *
 * | 区分 | 出どころ | CAS |
 * |---|---|---|
 * | 大気汚染防止法 特定物質（28件） | 大気汚染防止法施行令 第10条 | LOLI 3072（号番号が条文と一致） |
 * | 水質汚濁防止法 水素イオン濃度等の項目（12件） | 水質汚濁防止法施行令 第3条 | CHRIP（政令の号で持っている） |
 *
 * **法文物質名は条文から作る**（第0章の原則）。名前は e-Gov 法令API から取り、
 * 表記の決めごと（第3章）を当てる。
 *
 * **水質のほうは判定に使わない設定で作る。**「水素イオン濃度」「大腸菌数」のように
 * 物質ではない項目が並ぶ。製品に含まれる量で該非が決まるものではない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { childrenOf, findAll, nodeText, parseXml, textOf, type XmlNode } from "./lib/egov-xml";
import { itemNumber } from "./lib/kanji-count";
import { toDisplayName } from "./lib/law-name";
import { statutoryNumber } from "./lib/statutory-number";

const prisma = new PrismaClient();
const CACHE = join(process.cwd(), ".cache", "laws");
/**
 * 入れる先のバージョン。引数に `2026Q4` のように書けばその版、省くと 2026Q3（2026-10-03 に引数を足した。
 * 新しい四半期の版を入れるとき、取り出しも `LOLI_DB=LOLI4_Datafeed_<版>` で同じ版から行うこと）
 */
const VERSION_CODE = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a)) ?? "2026Q3";

interface Def {
  law: string;
  code: string;
  name: string;
  order: number;
  lawId: string;
  article: string;
  /** 番号の作り方。条の号なので `令第N条第M号` */
  articleNo: string;
  /** LOLI から取ったCASの表。無ければ CHRIP に任せる */
  tsv?: string;
  judged: boolean;
  note: string;
}

const DEFS: Def[] = [
  {
    law: "JP-APA",
    code: "SPECIAL",
    name: "特定物質",
    order: 5,
    lawId: "343CO0000000329",
    article: "第十条",
    articleNo: "10",
    tsv: "jp-apa-special.tsv",
    judged: true,
    note: "大気汚染防止法施行令 第10条（特定物質）。事故時の措置の対象",
  },
  {
    law: "JP-WPCA",
    code: "LIVING",
    name: "水素イオン濃度等の項目",
    order: 5,
    lawId: "346CO0000000188",
    article: "第三条",
    articleNo: "3",
    judged: false,
    note:
      "水質汚濁防止法施行令 第3条（生活環境項目）。水素イオン濃度・大腸菌数のように" +
      "物質ではない項目が並ぶため、既定では判定に使わない",
  },
];

const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

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

/** 条の第1項の各号を「番号 → 名前」にする */
function itemsOf(root: XmlNode, title: string): { number: string; name: string }[] {
  const main = findAll(root, "MainProvision")[0] ?? root;
  const art = findAll(main, "Article").find((a) => textOf(a, "ArticleTitle") === title);
  if (!art) throw new Error(`条が見つかりません: ${title}`);
  const para = childrenOf(art, "Paragraph")[0];
  if (!para) return [];
  const out: { number: string; name: string }[] = [];
  for (const it of childrenOf(para, "Item")) {
    const number = itemNumber(textOf(it, "ItemTitle"));
    if (number === null) continue;
    const sen = findAll(it, "ItemSentence")[0];
    const name = sen ? nodeText(sen) : nodeText(it);
    if (name === "削除" || name === "") continue;
    out.push({ number, name: toDisplayName(name) });
  }
  return out;
}

function readTsv(name: string): [string, string][] {
  if (!name) return [];
  const p = join(process.cwd(), "scripts/data", name);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t") as [string, string]);
}

/**
 * `--links-only`: 区分と法文物質名はそのまま、**指定した版 × LOLI のリンクだけ**を入れ替える（2026-10-03 に足した）。
 * 新しい四半期の版を入れるときに使う。ふつうの --write は区分を丸ごと消して作り直すので、
 * **ほかの版のリンクと、その区分の判定まで消える。**新しい版を足すときは必ずこちら
 */
async function replaceLinksOnly(
  versionId: string,
  sourceId: string,
  wanted: { code: string; cas: string[] }[],
): Promise<{ links: number; missing: string[] }> {
  const subs = await prisma.statutorySubstance.findMany({
    where: { codeNormalized: { in: wanted.map((w) => w.code) }, deletedAt: null },
    select: { id: true, codeNormalized: true },
  });
  const idOf = new Map(subs.map((s) => [s.codeNormalized, s.id]));
  const missing = wanted.filter((w) => !idOf.has(w.code)).map((w) => w.code);
  await prisma.statutoryCasLink.deleteMany({
    where: { versionId, sourceId, statutorySubstanceId: { in: subs.map((s) => s.id) } },
  });
  let links = 0;
  for (const w of wanted) {
    const id = idOf.get(w.code);
    if (!id || w.cas.length === 0) continue;
    const r = await prisma.statutoryCasLink.createMany({
      data: w.cas.map((c) => ({
        versionId,
        statutorySubstanceId: id,
        sourceId,
        casNumber: c,
        casNormalized: normalizeCas(c),
      })),
      skipDuplicates: true,
    });
    links += r.count;
  }
  return { links, missing };
}

async function main() {
  const write = process.argv.includes("--write");
  const remove = process.argv.includes("--remove");
  const linksOnly = process.argv.includes("--links-only");

  const version = await prisma.linkSetVersion.findFirst({ where: { code: VERSION_CODE } });
  const source = await prisma.source.findFirst({ where: { codeNormalized: "LOLI" } });
  if (!version || !source) throw new Error("バージョンかデータソースがありません");

  for (const def of DEFS) {
    const law = await prisma.law.findFirst({
      where: { codeNormalized: def.law, deletedAt: null },
      select: { id: true, nameJa: true },
    });
    if (!law) throw new Error(`法律 ${def.law} がありません`);

    // 入れ直し。前のぶんはリンクごと消す
    const old = await prisma.regulationCategory.findFirst({
      where: { lawId: law.id, code: def.code },
      select: { id: true },
    });
    if (old && (write || remove) && !linksOnly) {
      const subs = await prisma.statutorySubstance.findMany({
        where: { regulationClass: { categoryId: old.id } },
        select: { id: true },
      });
      await prisma.statutoryCasLink.deleteMany({
        where: { statutorySubstanceId: { in: subs.map((s) => s.id) } },
      });
      await prisma.statutorySubstance.deleteMany({
        where: { regulationClass: { categoryId: old.id } },
      });
      await prisma.regulationClass.deleteMany({ where: { categoryId: old.id } });
      await prisma.regulationCategory.delete({ where: { id: old.id } });
      console.log(`${def.name}: 前のぶんを消しました（法文物質名 ${subs.length}件）`);
    }
    if (remove) continue;

    const items = itemsOf(await loadLaw(def.lawId), def.article);
    const casOf = new Map<string, string[]>();
    for (const [code, cas] of readTsv(def.tsv ?? "")) {
      // LOLI は `01` のように0で埋める。条文の号は埋めない
      const k = String(Number(code));
      casOf.set(k, [...(casOf.get(k) ?? []), cas]);
    }
    const casCount = items.reduce((n, i) => n + (casOf.get(i.number)?.length ?? 0), 0);
    console.log(
      `${law.nameJa} ${def.name}: 法文物質名 ${items.length}件 / CASリンク ${casCount}件` +
        `${def.judged ? "" : "（判定に使わない）"}`,
    );
    if (!write) continue;
    if (linksOnly) {
      const r = await replaceLinksOnly(
        version.id,
        source.id,
        items.map((item) => ({
          code: `${def.law}-${def.code}-${item.number}`.toUpperCase(),
          cas: casOf.get(item.number) ?? [],
        })),
      );
      console.log(
        `  ${VERSION_CODE} のリンクだけ入れ替え: ${r.links}件${r.missing.length ? `（法文物質名が無い: ${r.missing.join(", ")}）` : ""}`,
      );
      continue;
    }

    const category = await prisma.regulationCategory.create({
      data: {
        code: def.code,
        codeNormalized: def.code,
        lawId: law.id,
        nameOriginal: def.name,
        nameLang: "JA",
        displayOrder: def.order,
        note: def.note,
        judged: def.judged,
        ...THRESHOLD,
      },
    });
    const cls = await prisma.regulationClass.create({
      data: {
        code: "DEFAULT",
        codeNormalized: "DEFAULT",
        categoryId: category.id,
        displayOrder: 0,
      },
    });

    for (const [i, item] of items.entries()) {
      const scode = `${def.law}-${def.code}-${item.number}`;
      const sub = await prisma.statutorySubstance.create({
        data: {
          code: scode,
          codeNormalized: scode,
          classId: cls.id,
          officialNumber: statutoryNumber(
            { kind: "orderArticle", table: def.articleNo },
            item.number,
          ),
          nameOriginal: item.name,
          nameLang: "JA",
          displayOrder: i + 1,
          note: def.note,
          ...THRESHOLD,
        },
      });
      const list = casOf.get(item.number) ?? [];
      if (list.length) {
        await prisma.statutoryCasLink.createMany({
          data: list.map((c) => ({
            versionId: version.id,
            statutorySubstanceId: sub.id,
            sourceId: source.id,
            casNumber: c,
            casNormalized: normalizeCas(c),
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  if (!write && !remove) console.log("\n下見だけ。入れるなら --write を付ける");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
