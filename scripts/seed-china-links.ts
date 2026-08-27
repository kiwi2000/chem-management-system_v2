/**
 * 中国のCASリンクを LOLI から入れる。日本の `seed-cas-links.ts` と同じ考え方。
 *
 *   bash scripts/loli-dump-china.sh                            先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-china-links.ts
 *
 * **突合の鍵は番号。**目録の序号を LOLI も `refno` に持っている（第4章 4-2b）。
 * 易製毒（2171）と監控（988）だけは LOLI に番号が無く、
 * 総称の親（`As … [鍵]`）で結ぶ。
 *
 * 同じバージョン・同じデータソース・同じ区分への取り込みは**入れ替え**。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SOURCE_CODE = "LOLI";

/** LOLI の Cas 欄には UN番号や総称の擬似CAS（`RR-…`）も混ざる。CASの形だけ採る */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 漢数字（1〜13だけ出てくる）。重点管控新汚染物の番号に使う */
const KANJI: Record<string, string> = {
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
  十: "10",
  十一: "11",
  十二: "12",
  十三: "13",
};

interface Job {
  /** 規制区分のコード */
  category: string;
  tsv: string;
  /**
   * こちらの法文物質名から鍵を作る。
   * `number` は序号、`code` は法文物質名のコードの区分名を外したもの
   */
  by: "number" | "code";
  /** LOLI の鍵から、最初の区切りまでを使う（総称の下に個別物質が並ぶもの） */
  head?: boolean;
}

const JOBS: Job[] = [
  { category: "HAZ", tsv: "china-haz", by: "number" },
  { category: "HYPERTOX", tsv: "china-hypertox", by: "number" },
  { category: "EXPLOSIVE", tsv: "china-explosive", by: "number" },
  { category: "PRIORITY1", tsv: "china-priority1", by: "number" },
  { category: "PRIORITY2", tsv: "china-priority2", by: "number" },
  { category: "NEWPOL", tsv: "china-newpol", by: "number" },
  /*
    厳格制限は LOLI が **1番（PFOS類）だけ13物質に割っている**（`1-01`〜`1-13`）。
    2番から先は `2` `3` … とそのまま。最初の区切りまでを号として使う
  */
  { category: "RESTRICTED", tsv: "china-restricted", by: "number", head: true },
  // LOLI に番号が無い2つ。総称の親で結ぶ
  { category: "PRECURSOR", tsv: "china-precursor", by: "code" },
  { category: "CONTROLLED", tsv: "china-controlled", by: "code" },
];

/**
 * 重点管控新汚染物清单だけ、LOLI と原文で番号の付け方が違う。
 *
 * LOLI は `01`〜`15` の通し番号。原文は `一`〜`十三` と、
 * 「十四 已淘汰类」の下に10物質（`十四-1`〜`十四-10`）。
 *
 * **LOLI は已淘汰类のうち2物質しか持たない**ので、そこだけ手で対応を書く。
 * 中身を確かめてある（14 = α-硫丹 959-98-8、15 = 多氯联苯 1336-36-3）。
 */
const NEWPOL_EXTRA: Record<string, string> = { "14": "十四-9", "15": "十四-10" };

/** 先頭の0を落とし、大文字にそろえる */
const norm = (s: string) =>
  s
    .trim()
    .replace(/^0+(?=\d)/, "")
    .toUpperCase();

/**
 * LOLI の鍵を、こちらの番号の書き方にそろえる。
 *
 * **1つの欄に序号が2つ入っていることがある**（危険化学品目録の `0102, 1489`）。
 * カンマで分けて両方に結ぶ。日本の有機溶剤と同じ（第4章 4-3）
 */
function toKeys(raw: string, job: Job): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    let k = part.trim();
    if (k === "") continue;
    if (job.head) k = k.split("-")[0]!;
    k = norm(k);
    if (job.category === "NEWPOL") {
      const mapped = NEWPOL_EXTRA[k] ?? Object.entries(KANJI).find(([, v]) => v === k)?.[0];
      if (mapped) out.push(mapped);
      continue;
    }
    out.push(k);
  }
  return out;
}

async function run(job: Job, versionId: string, sourceId: string) {
  const subs = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: { category: { code: job.category, law: { country: { code: "CHN" } } } },
    },
    select: { id: true, code: true, officialNumber: true },
  });

  const byKey = new Map<string, string>();
  for (const s of subs) {
    const k =
      job.by === "number"
        ? s.officialNumber
          ? norm(s.officialNumber)
          : null
        : norm(s.code.replace(new RegExp(`^${job.category}-`), ""));
    if (k && !byKey.has(k)) byKey.set(k, s.id);
  }

  const rows = readFileSync(join(process.cwd(), "scripts/data", `${job.tsv}.tsv`), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t"));

  const seen = new Set<string>();
  const missed = new Set<string>();
  let skippedShape = 0;
  const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
  for (const [raw, cas] of rows) {
    if (!raw || !cas) continue;
    if (!CAS_SHAPE.test(cas)) {
      skippedShape += 1;
      continue;
    }
    const keys = toKeys(raw, job);
    if (keys.length === 0) {
      missed.add(raw);
      continue;
    }
    const casNormalized = normalizeCas(cas);
    for (const key of keys) {
      const id = byKey.get(job.category === "NEWPOL" ? key : norm(key));
      if (!id) {
        missed.add(key);
        continue;
      }
      const dedup = `${id}/${casNormalized}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      data.push({ statutorySubstanceId: id, casNumber: cas, casNormalized });
    }
  }

  const removed = await prisma.statutoryCasLink.deleteMany({
    where: { versionId, sourceId, statutorySubstanceId: { in: subs.map((s) => s.id) } },
  });
  for (let i = 0; i < data.length; i += 5000) {
    await prisma.statutoryCasLink.createMany({
      data: data.slice(i, i + 5000).map((d) => ({ ...d, versionId, sourceId })),
      skipDuplicates: true,
    });
  }

  const linked = new Set(data.map((d) => d.statutorySubstanceId)).size;
  console.log(
    `${job.category.padEnd(11)} ${String(removed.count).padStart(6)} 件を消し ${String(data.length).padStart(6)} 件を入れました` +
      `（法文物質名 ${linked}/${subs.length} 件に結び付き、` +
      `CASの形でない ${skippedShape} 件、番号が合わない ${missed.size} 種を飛ばしました）`,
  );
  if (missed.size > 0 && missed.size <= 12) {
    console.log(`  合わなかった番号: ${[...missed].join(", ")}`);
  }
}

async function main() {
  const only = process.argv.slice(2);
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);

  const jobs = only.length > 0 ? JOBS.filter((j) => only.includes(j.category)) : JOBS;
  console.log(`${version.code} × ${source.code} に取り込みます（${jobs.length} 区分）`);
  for (const job of jobs) await run(job, version.id, source.id);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
