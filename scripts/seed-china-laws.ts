/**
 * 中国の法文物質名を、**原文（公布された目録）から**入れ直す。
 *
 *   npx tsx scripts/seed-china-laws.ts          下見
 *   npx tsx scripts/seed-china-laws.ts --write  書き込む
 *
 * **CASリンクはここでは作らない。**日本と同じで、
 *
 * ```
 * 法文物質名 … 公布された目録から（scripts/data/china.json）
 * CASリンク  … LOLI から（scripts/loli-dump-china.sh → scripts/seed-china-links.ts）
 * ```
 *
 * 2026-08-27 まではリンクを「いまDBに入っているものから引き継ぐ」作りだった。
 * LOLI の `ListData.XML` から番号で結べると分かったので、日本と同じ形に直した
 * （`docs/法規制データの作り方.md` 第4章 4-0、第8章 8-6a）。
 *
 * **法律が示す CAS は法文物質名の側に持つ。**
 * 中国の目録は序号が必ず入っているので、名前を「CAS 品名」にする（第0-2章）。
 *
 * 原文をまだ取れていない区分（易製毒・監控）は触らない。
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ChinaItem {
  section: string;
  number: string;
  name: string;
  alias: string;
  cas: string;
  note: string;
}

/** 原文をまだ取れていない区分。触らない */
const UNTOUCHED = new Set(["PRECURSOR", "CONTROLLED"]);

/**
 * 番号の欄が埋まっているときに、名前の頭へ CAS を付ける。
 *
 * 中国の目録は序号が必ず入っているので、**名前の側に CAS を書く**。
 * 代表の1つだけ（`22259-30-9；23422-53-9` のように複数入る品目が10件ある）。
 * 既に頭に付いていれば足さない
 */
function withCas(name: string, casColumn: string): string {
  const first = (casColumn.match(/\d{2,7}-\d{2}-\d/) ?? [])[0];
  if (!first) return name;
  return name.startsWith(first) ? name : `${first} ${name}`;
}

async function main() {
  const write = process.argv.includes("--write");
  const items = JSON.parse(readFileSync("scripts/data/china.json", "utf8")) as ChinaItem[];

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");

  const sections = [...new Set(items.map((i) => i.section))];
  console.log(`原文 ${items.length}件 / 区分 ${sections.length}件  版 ${version.code}\n`);

  for (const section of sections) {
    if (UNTOUCHED.has(section)) continue;
    const mine = items.filter((i) => i.section === section);

    const cls = await prisma.regulationClass.findFirst({
      where: { category: { code: section, law: { country: { code: "CHN" } } } },
      select: { id: true, category: { select: { id: true, nameJa: true } } },
    });
    if (!cls) {
      console.log(`✗ ${section} の分類が見つかりません`);
      continue;
    }

    const old = await prisma.statutorySubstance.count({
      where: { deletedAt: null, classId: cls.id },
    });
    console.log(`${section.padEnd(11)} 原文 ${String(mine.length).padStart(5)}件（いま ${old}件）`);

    if (!write) continue;

    /*
      **区分ごとに1つのトランザクションで入れ替える。**
      途中で落ちると、消したあと入れ直せていない状態が残る（実際に起きた）。
      id はこちらで振る。先に振っておけば、リンクをまとめて作れる
    */
    /*
      **原文そのものに序号の重複がある。**危険化学品目録（2015版）では
      718・1851・2009 が2回ずつ使われている（原文の誤植）。
      番号は原文どおり残し、コードの側に枝番を付けて通す
    */
    const used = new Map<string, number>();
    const rows = mine.map((item, i) => {
      const base = `${section}-${item.number}`;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      return { id: randomUUID(), code: n === 1 ? base : `${base}-${n}`, order: i + 1, item };
    });

    await prisma.$transaction(
      async (tx) => {
        await tx.statutoryCasLink.deleteMany({
          where: { statutorySubstance: { classId: cls.id } },
        });
        await tx.statutorySubstance.deleteMany({ where: { classId: cls.id } });

        await tx.statutorySubstance.createMany({
          data: rows.map((r) => ({
            id: r.id,
            code: r.code,
            codeNormalized: r.code.toUpperCase(),
            classId: cls.id,
            officialNumber: r.item.number,
            // **中国語をそのまま持つ。**原文が最も正しい（第3章）
            // 序号が入っているので、法律の CAS は名前の側に書く
            nameOriginal: withCas(r.item.name, r.item.cas),
            nameLang: "zh",
            displayOrder: r.order,
            aggregation: "NONE" as const,
            thresholdLower: "0",
            lowerBound: "EXCLUSIVE" as const,
            thresholdUpper: "100",
            upperBound: "INCLUSIVE" as const,
            note:
              [r.item.alias && `别名: ${r.item.alias}`, r.item.note].filter(Boolean).join(" / ") ||
              null,
          })),
        });
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    console.log(`   入れ替えました`);
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log("原文をまだ取れていない区分（易製毒・監控）は触っていません。");
  console.log("CASリンクは scripts/seed-china-links.ts で入れます。");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
