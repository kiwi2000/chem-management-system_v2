/**
 * CASリンクを取り込む。元は LOLI（社内SQL Server）。
 *
 * 突合の鍵は名前ではなく**番号**。区分によって何の番号かが違う。
 *
 *   C1 / C2 … 政令番号（Cabinet Order Number）
 *   MON     … 官報公示整理番号の通し番号（Official Gazette Number）
 *   PRI     … 優先評価化学物質の通し番号（Substance control number）
 *   SGN     … 通し番号が無いので、官報公示整理番号そのもので突き合わせる
 *
 * 取り出しかたは `scripts/sql/` の同名のSQLを参照。
 * 同じ版・同じデータソースへの取り込みは**入れ替え**なので、先に消してから入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-cas-links.ts [版コード] [区分コード...]
 *
 * 版コードを省くと 2026Q3。区分コードを省くと全部。データソースは LOLI 固定。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";

/** 突合の鍵を、こちらのどの欄から取るか */
type MatchBy = "number" | "gazette";

interface Job {
  law: string;
  category: string;
  tsv: string;
  matchBy: MatchBy;
  /**
   * LOLI側の鍵から落とす前置き。条や別表の番号が付いているものがある。
   *   安衛法 表示: 2-0305 → 305（則別表第2の305号）
   *   毒劇法 劇物: 2-1-79 → 79（指定令2条1項79号）
   * 前置きが合わない行は、その区分のものではないので飛ばす。
   */
  strip?: string;
  /** 0埋めを外すか。LOLI は 0305 のように桁を揃えていることがある */
  unpad?: boolean;
}

const JOBS: Job[] = [
  // 化審法。番号の種類は区分ごとに違う（政令番号・通し番号・官報公示整理番号）
  { law: "JP-CSCL", category: "C1", tsv: "loli-cscl-c1.tsv", matchBy: "number" },
  { law: "JP-CSCL", category: "C2", tsv: "loli-cscl-c2.tsv", matchBy: "number" },
  { law: "JP-CSCL", category: "MON", tsv: "loli-cscl-mon.tsv", matchBy: "number" },
  { law: "JP-CSCL", category: "PRI", tsv: "loli-cscl-pri.tsv", matchBy: "number" },
  { law: "JP-CSCL", category: "SGN", tsv: "loli-cscl-sgn.tsv", matchBy: "gazette" },
  // 化管法。LOLI の Control No. は別の番号なので使わない。政令番号（Ordinance No.）で引く
  { law: "JP-PRTR", category: "C1", tsv: "loli-prtr-c1.tsv", matchBy: "number" },
  { law: "JP-PRTR", category: "SC1", tsv: "loli-prtr-sc1.tsv", matchBy: "number" },
  { law: "JP-PRTR", category: "C2", tsv: "loli-prtr-c2.tsv", matchBy: "number" },
  // 毒劇法。指定令の条・項を落とすと、こちらの号番号になる
  { law: "JP-PDSCA", category: "TOX", tsv: "loli-pdsca-tox.tsv", matchBy: "number", strip: "1-" },
  { law: "JP-PDSCA", category: "DEL", tsv: "loli-pdsca-del.tsv", matchBy: "number", strip: "2-1-" },
  // 安衛法
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-label.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    tsv: "loli-isha-sds.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "MFG_PERMIT",
    tsv: "loli-isha-mfgpermit.tsv",
    matchBy: "number",
    strip: "3-1-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "MFG_BAN",
    tsv: "loli-isha-mfgban.tsv",
    matchBy: "number",
    strip: "16-1-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "SPEC1",
    tsv: "loli-isha-spec1.tsv",
    matchBy: "number",
    strip: "1-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "SPEC2",
    tsv: "loli-isha-spec2.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
  },
  {
    law: "JP-ISHA",
    category: "SPEC3",
    tsv: "loli-isha-spec3.tsv",
    matchBy: "number",
    strip: "3-",
    unpad: true,
  },
];

/** LOLI 側の鍵を、こちらの番号の書き方にそろえる。合わなければ null */
function toKey(raw: string, job: Job): string | null {
  let k = raw;
  if (job.strip) {
    if (!k.startsWith(job.strip)) return null;
    k = k.slice(job.strip.length);
  }
  // 「0305」「0100-2」のような0埋めを外す。枝番も区切りごとに外す
  if (job.unpad) k = k.replace(/\d+/g, (d) => String(Number(d)));
  return k === "" ? null : k;
}

/** LOLI の Cas 欄には UN番号や社内番号（RR-…）も混ざる。CASの形をしたものだけ採る */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 備考に「官報公示整理番号: 5-7143」と書いてある。そこだけ取り出す */
const GAZETTE = /官報公示整理番号[:：]\s*([0-9]+-[0-9]+)/;

/**
 * 安衛法の有機溶剤（則別表第6の2）。
 *
 * LOLI の有機溶剤の一覧には号番号が入っておらず、番号では突き合わせられない。
 * 有機溶剤はほぼすべて表示対象物質・通知対象物質（則別表第2）でもあるので、
 * **そちらに結び付いたCASを、法文物質名を頼りに引いてくる**。
 *
 * 名前で引くのは本来避けたいが、ここは同じ法令の同じ表記どうしで、
 * 相手は44件しかなく、対応は目で確かめられる。書き方が違うものだけ
 * `scripts/data/isha-org-map.tsv` に対応を書いてある。
 */
async function runOrganicSolvents(versionId: string, sourceId: string) {
  const org = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: {
        category: { codeNormalized: "ORG", law: { codeNormalized: "JP-ISHA" } },
      },
    },
    select: { id: true, officialNumber: true, nameOriginal: true },
    orderBy: { displayOrder: "asc" },
  });

  // 引いてくる先。表示・通知のどちらに載っていてもよい
  const donors = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: {
        category: {
          codeNormalized: { in: ["LABEL", "SDS"] },
          law: { codeNormalized: "JP-ISHA" },
        },
      },
    },
    select: { id: true, nameOriginal: true },
  });
  const donorByName = new Map<string, string[]>();
  for (const d of donors) {
    const list = donorByName.get(d.nameOriginal);
    if (list) list.push(d.id);
    else donorByName.set(d.nameOriginal, [d.id]);
  }

  // 書き方が違うものの対応表。行頭が # の行は覚え書き
  const map = new Map<string, string>();
  const mapText = readFileSync(join(process.cwd(), "scripts/data/isha-org-map.tsv"), "utf-8");
  for (const line of mapText.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const [num, name] = t.split(/\t+/);
    if (num && name) map.set(num, name);
  }

  const missing: string[] = [];
  let linked = 0;
  let total = 0;

  await prisma.statutoryCasLink.deleteMany({
    where: { versionId, sourceId, statutorySubstanceId: { in: org.map((o) => o.id) } },
  });

  for (const o of org) {
    const wanted = (o.officialNumber && map.get(o.officialNumber)) ?? o.nameOriginal;
    const donorIds = donorByName.get(wanted);
    if (!donorIds) {
      missing.push(`${o.officialNumber} ${o.nameOriginal}`);
      continue;
    }
    const links = await prisma.statutoryCasLink.findMany({
      where: { versionId, sourceId, statutorySubstanceId: { in: donorIds } },
      select: {
        casNumber: true,
        casNormalized: true,
        excluded: true,
      },
    });
    const seen = new Set<string>();
    const data = links
      .filter((l) => !seen.has(l.casNormalized) && seen.add(l.casNormalized))
      .map((l) => ({
        versionId,
        sourceId,
        statutorySubstanceId: o.id,
        casNumber: l.casNumber,
        casNormalized: l.casNormalized,
        excluded: l.excluded,
      }));
    if (data.length === 0) {
      missing.push(`${o.officialNumber} ${o.nameOriginal}（相手にCASなし）`);
      continue;
    }
    await prisma.statutoryCasLink.createMany({ data });
    linked += 1;
    total += data.length;
  }

  console.log(
    `JP-ISHA ORG: ${total} 件を入れました（法文物質名 ${linked}/${org.length} 件に結び付き、` +
      `引いてくる先が無い ${missing.length} 件を飛ばしました）`,
  );
  for (const m of missing) console.log(`  ${m}`);
}

async function run(job: Job, versionId: string, sourceId: string) {
  const substances = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: {
        category: {
          codeNormalized: job.category,
          law: { codeNormalized: job.law },
        },
      },
    },
    select: { id: true, officialNumber: true, note: true },
  });

  // 鍵 → 法文物質名。同じ鍵が2つ以上あることは無い前提で、あれば先勝ちにする
  const byKey = new Map<string, string>();
  for (const s of substances) {
    const key =
      job.matchBy === "number" ? s.officialNumber : (GAZETTE.exec(s.note ?? "")?.[1] ?? null);
    if (key && !byKey.has(key)) byKey.set(key, s.id);
  }

  const rows = readFileSync(join(process.cwd(), "scripts/data", job.tsv), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t"));

  let skippedShape = 0;
  const missed = new Set<string>();
  const seen = new Set<string>();
  const data: {
    statutorySubstanceId: string;
    casNumber: string;
    casNormalized: string;
  }[] = [];

  for (const [key, cas] of rows) {
    if (!key || !cas) continue;
    if (!CAS_SHAPE.test(cas)) {
      skippedShape += 1;
      continue;
    }
    const mapped = toKey(key, job);
    if (mapped === null) {
      missed.add(key);
      continue;
    }
    const id = byKey.get(mapped);
    if (!id) {
      missed.add(mapped);
      continue;
    }
    const casNormalized = normalizeCas(cas);
    const dedup = `${id}/${casNormalized}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    data.push({
      statutorySubstanceId: id,
      casNumber: cas,
      casNormalized,
    });
  }

  // この版・このデータソース・この区分ぶんは入れ替え。前の中身は残さない
  const removed = await prisma.statutoryCasLink.deleteMany({
    where: { versionId, sourceId, statutorySubstanceId: { in: substances.map((s) => s.id) } },
  });
  await prisma.statutoryCasLink.createMany({
    data: data.map((d) => ({ ...d, versionId, sourceId })),
  });

  const linked = new Set(data.map((d) => d.statutorySubstanceId)).size;
  console.log(
    `${job.law} ${job.category}: ${removed.count} 件を消し ${data.length} 件を入れました` +
      `（法文物質名 ${linked}/${substances.length} 件に結び付き、` +
      `CASの形でない ${skippedShape} 件、番号が合わない ${missed.size} 種を飛ばしました）`,
  );
  if (missed.size > 0 && missed.size <= 10) {
    console.log(`  合わなかった番号: ${[...missed].join(", ")}`);
  }
}

async function main() {
  const [versionArg, ...only] = process.argv.slice(2);
  const versionCode = versionArg ?? "2026Q3";

  const version = await prisma.linkSetVersion.findFirst({
    where: { codeNormalized: versionCode.toUpperCase(), deletedAt: null },
  });
  if (!version) throw new Error(`バージョン ${versionCode} がありません`);
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
  });
  if (!source) throw new Error(`データソース種別 ${SOURCE_CODE} がありません`);

  const jobs = only.length > 0 ? JOBS.filter((j) => only.includes(j.category)) : JOBS;
  console.log(`${version.code} × ${source.code} に取り込みます（${jobs.length} 区分）`);
  for (const job of jobs) await run(job, version.id, source.id);

  // 有機溶剤は番号が無いので最後に回す。表示・通知が入っていることが前提
  if (only.length === 0 || only.includes("ORG")) {
    await runOrganicSolvents(version.id, source.id);
  }

  // 取り込んだ日付を、そのデータソースの行に控える
  await prisma.linkVersionSource.updateMany({
    where: { versionId: version.id, sourceId: source.id },
    data: { loadedAt: new Date() },
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
