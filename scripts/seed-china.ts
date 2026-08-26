/**
 * 中国の法規制を、LOLI から取り出した一覧をもとに登録する。
 *
 *   npx tsx scripts/seed-china.ts <TSVの置き場>          下見
 *   npx tsx scripts/seed-china.ts <TSVの置き場> --write  書き込む
 *
 * TSV は `scripts/loli-dump-china.sh` で取り出す。
 *
 * **日本と作りが違う。**
 * 日本は法文物質名を条文から先に登録してあり、LOLI からは CAS リンクだけを取った。
 * 中国は条文を持っていないので、**法文物質名も LOLI から作る**。
 * LOLI の `As <名前> [<鍵>]` が目録の1項目にあたり、行の CAS がそこにぶら下がる。
 *
 * 入れるのは SDS の第15項（法規情報）で名前が挙がるもの。
 * 入れないものと、その理由は `docs/LOLI取り込み記録_中国.md` に書いてある。
 *
 * **何度流しても結果は同じ。**既にあるものは書き換えず、無いものだけ足す。
 * 人が直した名前や閾値を上書きしない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { parseChinaRow } from "./lib/china-list";

const prisma = new PrismaClient();

/** 中国の法令はこの国の下に付ける */
const COUNTRY_CODE = "CHN";
/** 原文の言語 */
const LANG = "ZH";

interface CategoryDef {
  /** LOLI の一覧番号 */
  listId: number;
  code: string;
  nameOriginal: string;
  nameJa: string;
  nameEn: string;
  /**
   * 下限。**目録に載っているだけで対象になるものは 0 を超えたら該当**とする。
   * 濃度の決まりがあるものだけ数字を入れる。
   */
  lowerPct: number;
  note?: string;
}

interface LawDef {
  code: string;
  nameOriginal: string;
  nameJa: string;
  nameEn: string;
  note: string;
  categories: CategoryDef[];
}

/**
 * 入れる法令と区分。
 *
 * 閾値はどれも「0% を超えたら該当」。中国のこれらの目録は
 * **載っている物質を含むかどうか**で決まり、濃度の下限を持たないため。
 * （濃度で決まるものが出てきたら、その区分だけ数字を入れる）
 */
const LAWS: LawDef[] = [
  {
    code: "CN-HAZCHEM",
    nameOriginal: "危险化学品安全管理条例",
    nameJa: "危険化学品安全管理条例",
    nameEn: "Regulations on the Safety Administration of Hazardous Chemicals",
    note: "SDS第15項の中心。危険化学品目録に載っていれば対象になる",
    categories: [
      {
        listId: 2579,
        code: "HAZ",
        nameOriginal: "危险化学品目录",
        nameJa: "危険化学品目録",
        nameEn: "Catalog of Hazardous Chemicals",
        lowerPct: 0,
      },
      {
        listId: 1945,
        code: "HYPERTOX",
        nameOriginal: "剧毒化学品目录",
        nameJa: "劇毒化学品目録",
        nameEn: "Catalog of Hypertoxic Chemicals",
        lowerPct: 0,
        note: "危険化学品目録のうち、とくに毒性の強いもの",
      },
    ],
  },
  {
    code: "CN-PRECURSOR",
    nameOriginal: "易制毒化学品管理条例",
    nameJa: "易製毒化学品管理条例",
    nameEn: "Regulations on the Administration of Precursor Chemicals",
    note: "麻薬の原料になりうるもの。第I類〜第III類に分かれる",
    categories: [
      {
        listId: 2171,
        code: "PRECURSOR",
        nameOriginal: "易制毒化学品品种目录",
        nameJa: "易製毒化学品品種目録",
        nameEn: "Catalog of Precursor Chemicals",
        lowerPct: 0,
      },
    ],
  },
  {
    code: "CN-EXPLOSIVE",
    nameOriginal: "易制爆危险化学品名录",
    nameJa: "易製爆危険化学品名録",
    nameEn: "List of Explosive Precursors",
    note: "爆発物の原料になりうるもの",
    categories: [
      {
        listId: 5380,
        code: "EXPLOSIVE",
        nameOriginal: "易制爆危险化学品名录",
        nameJa: "易製爆危険化学品名録",
        nameEn: "List of Explosive Precursors",
        lowerPct: 0,
      },
    ],
  },
  {
    code: "CN-CWC",
    nameOriginal: "监控化学品管理条例",
    nameJa: "監控化学品管理条例",
    nameEn: "Regulations on the Administration of Controlled Chemicals",
    note: "化学兵器禁止条約に対応するもの。第1表〜第4表に分かれる",
    categories: [
      {
        listId: 988,
        code: "CONTROLLED",
        nameOriginal: "监控化学品目录",
        nameJa: "監控化学品目録",
        nameEn: "List of Controlled Chemicals",
        lowerPct: 0,
      },
    ],
  },
  {
    code: "CN-PRIORITY",
    nameOriginal: "优先控制化学品名录",
    nameJa: "優先管理化学品名録",
    nameEn: "Catalog of Priority Controlled Chemicals",
    note: "環境リスクの高いものとして優先的に管理される",
    categories: [
      {
        listId: 7583,
        code: "PRIORITY1",
        nameOriginal: "优先控制化学品名录（第一批）",
        nameJa: "優先管理化学品名録（第1次）",
        nameEn: "Catalog of Priority Controlled Chemicals (First Batch)",
        lowerPct: 0,
      },
      {
        listId: 8535,
        code: "PRIORITY2",
        nameOriginal: "优先控制化学品名录（第二批）",
        nameJa: "優先管理化学品名録（第2次）",
        nameEn: "Catalog of Priority Controlled Chemicals (Second Batch)",
        lowerPct: 0,
      },
    ],
  },
  {
    code: "CN-NEWPOL",
    nameOriginal: "重点管控新污染物清单",
    nameJa: "重点管理新汚染物リスト",
    nameEn: "List of New Pollutants for Priority Management",
    note: "使用や製造の禁止・制限が個別に定められている",
    categories: [
      {
        listId: 9637,
        code: "NEWPOL",
        nameOriginal: "重点管控新污染物清单",
        nameJa: "重点管理新汚染物リスト",
        nameEn: "List of New Pollutants for Priority Management",
        lowerPct: 0,
      },
    ],
  },
  {
    code: "CN-RESTRICTED",
    nameOriginal: "中国严格限制的有毒化学品名录",
    nameJa: "中国厳格制限有毒化学品名録",
    nameEn: "Catalog of Severely Restricted Toxic Chemicals",
    note: "輸出入に許可が要るもの",
    categories: [
      {
        listId: 3683,
        code: "RESTRICTED",
        nameOriginal: "中国严格限制的有毒化学品名录",
        nameJa: "中国厳格制限有毒化学品名録",
        nameEn: "Catalog of Severely Restricted Toxic Chemicals",
        lowerPct: 0,
      },
    ],
  },
];

/** 区分けが取れなかったものを入れる先 */
const DEFAULT_CLASS = "DEFAULT";

interface Entry {
  /** 目録の1項目を指す鍵 */
  key: string;
  name: string | null;
  officialNumber: string | null;
  className: string | null;
  /** その項目にぶら下がるCAS */
  cas: Set<string>;
}

/** 一覧を1つ読んで、目録の項目ごとにまとめる */
function readList(dir: string, listId: number): Map<string, Entry> {
  const text = readFileSync(join(dir, `china-${listId}.tsv`), "utf8");
  const entries = new Map<string, Entry>();
  for (const line of text.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const row = parseChinaRow(line.slice(0, tab), line.slice(tab + 1));
    if (!row) continue;
    const found = entries.get(row.entryKey) ?? {
      key: row.entryKey,
      name: row.entryName,
      officialNumber: row.officialNumber,
      className: row.className,
      cas: new Set<string>(),
    };
    // 名前・番号は最初に出たものを使う。同じ項目なら同じ値が入っている
    found.name ??= row.entryName;
    found.officialNumber ??= row.officialNumber;
    found.className ??= row.className;
    found.cas.add(row.cas);
    entries.set(row.entryKey, found);
  }
  return entries;
}

async function main() {
  const dir = process.argv[2];
  const write = process.argv.includes("--write");
  if (!dir || dir.startsWith("--")) throw new Error("TSVの置き場を渡してください");

  const country = await prisma.country.findFirst({
    where: { codeNormalized: normalizeCode(COUNTRY_CODE), deletedAt: null },
    select: { id: true, nameJa: true },
  });
  if (!country) throw new Error(`国 ${COUNTRY_CODE} がありません`);

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在版がありません");

  const source = await prisma.source.findFirst({
    where: { codeNormalized: normalizeCode("LOLI") },
    select: { id: true },
  });
  if (!source) throw new Error("データソース LOLI がありません");

  console.log(`国: ${country.nameJa} / 版: ${version.code}`);
  const tally = { laws: 0, categories: 0, classes: 0, substances: 0, links: 0, skipped: 0 };

  for (const [lawIndex, lawDef] of LAWS.entries()) {
    let law = await prisma.law.findFirst({
      where: { codeNormalized: normalizeCode(lawDef.code) },
      select: { id: true },
    });
    if (!law) {
      tally.laws += 1;
      if (write) {
        law = await prisma.law.create({
          data: {
            code: lawDef.code,
            codeNormalized: normalizeCode(lawDef.code),
            countryId: country.id,
            nameOriginal: lawDef.nameOriginal,
            nameLang: LANG,
            nameJa: lawDef.nameJa,
            nameEn: lawDef.nameEn,
            // 日本のぶんの後ろに並べる
            displayOrder: 100 + lawIndex,
            note: lawDef.note,
          },
          select: { id: true },
        });
      }
    }

    for (const [catIndex, catDef] of lawDef.categories.entries()) {
      const entries = readList(dir, catDef.listId);
      const casCount = [...entries.values()].reduce((n, e) => n + e.cas.size, 0);
      console.log(
        `${lawDef.nameJa} / ${catDef.nameJa}: 項目 ${entries.size}件 / CAS ${casCount}件`,
      );
      if (!write || !law) continue;

      let category = await prisma.regulationCategory.findFirst({
        where: { lawId: law.id, codeNormalized: normalizeCode(catDef.code) },
        select: { id: true },
      });
      if (!category) {
        tally.categories += 1;
        category = await prisma.regulationCategory.create({
          data: {
            code: catDef.code,
            codeNormalized: normalizeCode(catDef.code),
            lawId: law.id,
            nameOriginal: catDef.nameOriginal,
            nameLang: LANG,
            nameJa: catDef.nameJa,
            nameEn: catDef.nameEn,
            displayOrder: catIndex,
            /*
              目録に載っているものを含んでいれば対象。
              0 を超えたら該当（0 ちょうどは「入っていない」なので外す）。
            */
            thresholdLower: catDef.lowerPct,
            lowerBound: catDef.lowerPct === 0 ? "EXCLUSIVE" : "INCLUSIVE",
            thresholdUpper: 100,
            upperBound: "INCLUSIVE",
            note: catDef.note,
          },
          select: { id: true },
        });
      }

      /** 区分け（第I類・第1表など）ごとの入れ先。無いものは DEFAULT にまとめる */
      const classIdOf = new Map<string, string>();
      const classNames = [
        ...new Set([...entries.values()].map((e) => e.className ?? DEFAULT_CLASS)),
      ].sort();
      for (const [i, name] of classNames.entries()) {
        const code =
          name === DEFAULT_CLASS ? DEFAULT_CLASS : name.replace(/\s+/g, "").toUpperCase();
        let cls = await prisma.regulationClass.findFirst({
          where: { categoryId: category.id, codeNormalized: normalizeCode(code) },
          select: { id: true },
        });
        if (!cls) {
          tally.classes += 1;
          cls = await prisma.regulationClass.create({
            data: {
              code,
              codeNormalized: normalizeCode(code),
              categoryId: category.id,
              nameOriginal: name === DEFAULT_CLASS ? null : name,
              nameLang: name === DEFAULT_CLASS ? null : "EN",
              nameEn: name === DEFAULT_CLASS ? null : name,
              displayOrder: i,
            },
            select: { id: true },
          });
        }
        classIdOf.set(name, cls.id);
      }

      /*
        法文物質名とリンクは**まとめて書く**。
        1件ずつ問い合わせると、危険化学品目録だけで往復が2万回を超える。
      */
      const existing = await prisma.statutorySubstance.findMany({
        where: { classId: { in: [...classIdOf.values()] } },
        select: { id: true, codeNormalized: true },
      });
      const idOfCode = new Map(existing.map((x) => [x.codeNormalized, x.id]));
      const bound = catDef.lowerPct === 0 ? ("EXCLUSIVE" as const) : ("INCLUSIVE" as const);

      /** これから作るもの。**既にあるものは触らない**（人が直した名前を消さないため） */
      const toCreate = [];
      /** 「法文物質名のコード」→ ぶら下がるCAS */
      const casOfCode = new Map<string, Set<string>>();

      let order = 0;
      for (const entry of entries.values()) {
        const classId = classIdOf.get(entry.className ?? DEFAULT_CLASS);
        if (!classId) continue;
        // 目録の中で一意になるコード。項目の鍵をそのまま使う
        const code = `${catDef.code}-${entry.key}`.slice(0, 50);
        const normalizedCode = normalizeCode(code);
        casOfCode.set(normalizedCode, entry.cas);
        if (idOfCode.has(normalizedCode)) continue;
        toCreate.push({
          code,
          codeNormalized: normalizedCode,
          classId,
          officialNumber: entry.officialNumber,
          /*
            名前は LOLI の英語。中国語の目録名は持っていないので、
            原文の言語は EN にしておく（ZH と書くと、中国語が入っていると読まれる）。
          */
          nameOriginal: entry.name ?? entry.key,
          nameLang: "EN",
          nameEn: entry.name ?? entry.key,
          displayOrder: order++,
          thresholdLower: catDef.lowerPct,
          lowerBound: bound,
          thresholdUpper: 100,
          upperBound: "INCLUSIVE" as const,
        });
      }
      if (toCreate.length > 0) {
        await prisma.statutorySubstance.createMany({ data: toCreate });
        tally.substances += toCreate.length;
        // 作ったぶんの id を引き直す
        const made = await prisma.statutorySubstance.findMany({
          where: { codeNormalized: { in: toCreate.map((x) => x.codeNormalized) } },
          select: { id: true, codeNormalized: true },
        });
        for (const x of made) idOfCode.set(x.codeNormalized, x.id);
      }

      const links = [];
      for (const [normalizedCode, casSet] of casOfCode) {
        const statutorySubstanceId = idOfCode.get(normalizedCode);
        if (!statutorySubstanceId) continue;
        for (const cas of casSet) {
          const normalized = normalizeCas(cas);
          // LOLI のまとめ番号（RR-...）は CAS ではない。リンクにはしない
          if (!/^\d{2,7}-\d{2}-\d$/.test(normalized)) {
            tally.skipped += 1;
            continue;
          }
          links.push({
            versionId: version.id,
            statutorySubstanceId,
            sourceId: source.id,
            casNumber: cas,
            casNormalized: normalized,
          });
        }
      }
      if (links.length > 0) {
        // 同じ組み合わせは一意制約で弾かれる。読み直しにならないよう skipDuplicates で流す
        const r = await prisma.statutoryCasLink.createMany({ data: links, skipDuplicates: true });
        tally.links += r.count;
      }
    }
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  法令        : ${tally.laws}件`);
  console.log(`  規制区分    : ${tally.categories}件`);
  console.log(`  分類        : ${tally.classes}件`);
  console.log(`  法文物質名  : ${tally.substances}件`);
  console.log(`  CASリンク   : ${tally.links}件`);
  console.log(`  CASでない鍵 : ${tally.skipped}件（LOLIのまとめ番号。リンクにしない）`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
