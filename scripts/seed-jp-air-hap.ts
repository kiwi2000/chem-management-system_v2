/**
 * 大気汚染防止法「有害大気汚染物質に該当する可能性がある物質」を入れる。
 *
 *   bash scripts/loli-dump-jp-air.sh                                     先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-jp-air-hap.ts          下見
 *   ... scripts/seed-jp-air-hap.ts --write                               入れる（入れ直し）
 *   ... scripts/seed-jp-air-hap.ts --remove                              消す
 *
 * **出どころは中央環境審議会 第9次答申の別表1・別表2。**法令の別表ではない。
 * 一次資料が機械で取れないため、**LOLI の一覧 3074 から作る**（第2章の原則の例外）。
 * 名前は LOLI のコンパクト版に入っている日本語訳をそのまま使う。
 *
 * **番号は CHRIP と同じ書き方にする。**`中環審第9次答申(別表1)の221`。
 * こうしておくと、CHRIP から来る記載がそのまま番号で当たる（`docs/法規制データの作り方.md` 第0-3章）。
 *
 * **判定に出すが、候補であることを適用条件に書く。**
 * 答申は「有害大気汚染物質に該当する可能性がある物質」を並べたもので、
 * 法律が「これは規制対象」と決めたものではない。
 * 適用条件が入っている法文物質名は、**当たったときに必ず要確認になる**ので、
 * 「候補に載っている」ことを知らせつつ、確定した該当と混ざらない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LAW_CODE = "JP-APA";
const VERSION_CODE = "2026Q3";
const SOURCE_CODE = "LOLI";

/** 別表ごとの区分 */
const CATEGORIES = [
  {
    annex: "1",
    code: "HAP",
    name: "有害大気汚染物質に該当する可能性がある物質",
    order: 10,
    note: "中央環境審議会 第9次答申 別表1。健康リスクがある程度以上と考えられる物質を並べたもの",
    condition:
      "中央環境審議会第9次答申 別表1に「有害大気汚染物質に該当する可能性がある物質」として" +
      "掲げられたもの。法令が指定した規制対象ではなく、該当するかは個別に判断する",
  },
  {
    annex: "2",
    code: "HAP-PRI",
    name: "優先取組物質",
    order: 11,
    note: "中央環境審議会 第9次答申 別表2。別表1のうち、特に優先的に対策に取り組むべきとされた物質",
    condition:
      "中央環境審議会第9次答申 別表2に「優先取組物質」として掲げられたもの。" +
      "法令が指定した規制対象ではなく、該当するかは個別に判断する",
  },
] as const;

/** 含有すれば該当。裾切値は持たない（環境系4法と同じ） */
const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

/** `1-221` → `中環審第9次答申(別表1)の221`。0埋めは外す */
function officialNumber(code: string): string {
  const m = /^([12])-(\d+)$/.exec(code.trim());
  if (!m) throw new Error(`番号の形が違う: ${code}`);
  return `中環審第9次答申(別表${m[1]})の${Number(m[2])}`;
}

function readTsv(name: string): string[][] {
  return readFileSync(join(process.cwd(), "scripts/data", name), "utf-8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t"));
}

async function main() {
  const write = process.argv.includes("--write");
  const remove = process.argv.includes("--remove");

  const law = await prisma.law.findFirst({ where: { codeNormalized: LAW_CODE, deletedAt: null } });
  if (!law) throw new Error(`法律 ${LAW_CODE} がありません`);

  // 入れ直し。前のぶんは、ぶら下がるリンクごと消す
  const old = await prisma.regulationCategory.findMany({
    where: { lawId: law.id, code: { in: CATEGORIES.map((c) => c.code) } },
    select: { id: true, code: true },
  });
  if (old.length && (write || remove)) {
    const ids = old.map((o) => o.id);
    const subs = await prisma.statutorySubstance.findMany({
      where: { regulationClass: { categoryId: { in: ids } } },
      select: { id: true },
    });
    await prisma.statutoryCasLink.deleteMany({
      where: { statutorySubstanceId: { in: subs.map((s) => s.id) } },
    });
    await prisma.statutorySubstance.deleteMany({
      where: { regulationClass: { categoryId: { in: ids } } },
    });
    await prisma.regulationClass.deleteMany({ where: { categoryId: { in: ids } } });
    await prisma.regulationCategory.deleteMany({ where: { id: { in: ids } } });
    console.log(`前のぶんを消しました（法文物質名 ${subs.length}件）`);
  }
  if (remove) {
    await prisma.$disconnect();
    return;
  }

  const items = readTsv("jp-air-items.tsv");
  const cas = readTsv("jp-air-cas.tsv");
  const casOf = new Map<string, string[]>();
  for (const [code, c] of cas) {
    if (!code || !c) continue;
    casOf.set(code, [...(casOf.get(code) ?? []), c]);
  }

  const version = await prisma.linkSetVersion.findFirst({ where: { code: VERSION_CODE } });
  const source = await prisma.source.findFirst({ where: { codeNormalized: SOURCE_CODE } });
  if (!version || !source) throw new Error("バージョンかデータソースがありません");

  let names = 0;
  let links = 0;
  for (const def of CATEGORIES) {
    const mine = items.filter((r) => r[0]!.startsWith(`${def.annex}-`));
    const casCount = mine.reduce((n, r) => n + (casOf.get(r[0]!)?.length ?? 0), 0);
    console.log(`${def.name}: 法文物質名 ${mine.length}件 / CASリンク ${casCount}件`);
    names += mine.length;
    links += casCount;
    if (!write) continue;

    const category = await prisma.regulationCategory.create({
      data: {
        code: def.code,
        codeNormalized: def.code,
        lawId: law.id,
        nameOriginal: def.name,
        nameLang: "JA",
        displayOrder: def.order,
        note: def.note,
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

    for (let i = 0; i < mine.length; i++) {
      const [code, , en, ja] = mine[i]!;
      const scode = `${LAW_CODE}-${def.code}-${code!.split("-")[1]}`;
      const sub = await prisma.statutorySubstance.create({
        data: {
          code: scode,
          codeNormalized: scode,
          classId: cls.id,
          officialNumber: officialNumber(code!),
          nameOriginal: (ja || en || code)!,
          nameLang: "JA",
          nameJa: ja || null,
          nameEn: en || null,
          displayOrder: i + 1,
          // 候補であることを1件ずつ持たせる。当たったら必ず要確認になる
          applicableCondition: def.condition,
          ...THRESHOLD,
        },
      });
      const list = casOf.get(code!) ?? [];
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

  console.log(
    write
      ? `\n入れました。法文物質名 ${names}件 / CASリンク ${links}件`
      : `\n下見だけ。入れるなら --write を付ける（法文物質名 ${names}件 / CASリンク ${links}件）`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
