/**
 * LOLI の ListData.Data（一覧ごとの、CAS についての文章）を、CASリンクに添える。
 *
 *   node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/seed-link-data.ts [バージョン]
 *   node ... scripts/seed-link-data.ts ids        取り出しに使う一覧IDをカンマ区切りで吐く
 *
 * 読むのは scripts/data/loli-data-LOLI4_Datafeed_<バージョン>.tsv（scripts/loli-dump-data.sh）。
 * 列は ListID, Cas, Data（英語）, 日本語訳（無ければ NULL）。
 *
 * **リンクはどの一覧から来たかを持っていない。**そこで、こちらの規制区分 ↔ LOLI の一覧ID の
 * 対応表（LISTS）を持ち、区分のリンクの CAS を一覧の行と突き合わせる。1つの区分が
 * 複数の一覧から来ているときは、並べた順で最初に当たった一覧の文章を採る。
 *
 * 触るのは LOLI のリンクだけ。ほかのデータソース（CHRIP・MHLW・USER）の文章は別の仕組みで入れる。
 * 同じ版・同じ区分の古い文章は消して入れ直す（一覧の文章が変わったときに残さないため）。
 */
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

/** 規制区分 ↔ LOLI の一覧ID。law か country のどちらかで区分を引く */
interface ListMap {
  law?: string;
  country?: string;
  category: string;
  listIds: number[];
}

/**
 * 対応表。**取り出しスクリプトが何を取るかもここで決まる**（`ids` で吐く）。
 * どの一覧がどの区分かは docs/法規制データの作り方.md 4-0a と各 loli-dump-*.sh。
 */
const LISTS: ListMap[] = [
  // 日本
  { law: "JP-CSCL", category: "C1", listIds: [631] },
  { law: "JP-CSCL", category: "C2", listIds: [631] },
  { law: "JP-CSCL", category: "MON", listIds: [634] },
  { law: "JP-CSCL", category: "PRI", listIds: [4589] },
  { law: "JP-CSCL", category: "SGN", listIds: [10077] },
  { law: "JP-PRTR", category: "C1", listIds: [9013] },
  { law: "JP-PRTR", category: "SC1", listIds: [9013] },
  { law: "JP-PRTR", category: "C2", listIds: [9014] },
  { law: "JP-PDSCA", category: "TOX", listIds: [1015] },
  { law: "JP-PDSCA", category: "DEL", listIds: [1015] },
  { law: "JP-ISHA", category: "LABEL", listIds: [9908, 9907, 1818] },
  { law: "JP-ISHA", category: "SDS", listIds: [9906, 9905, 1818] },
  { law: "JP-ISHA", category: "MFG_PERMIT", listIds: [1818] },
  { law: "JP-ISHA", category: "MFG_BAN", listIds: [1816] },
  { law: "JP-ISHA", category: "SPEC1", listIds: [2226] },
  { law: "JP-ISHA", category: "SPEC2", listIds: [2226] },
  { law: "JP-ISHA", category: "SPEC3", listIds: [2226] },
  { law: "JP-ISHA", category: "ORG", listIds: [1813] },
  { law: "JP-ISHA", category: "SPEC_MGMT", listIds: [4534] },
  { law: "JP-ISHA", category: "SKIN", listIds: [9888, 9889, 9891, 9892] },
  { law: "JP-ISHA", category: "CARC30", listIds: [9624] },
  { law: "JP-ISHA", category: "LEAD", listIds: [2036, 2043] },
  { law: "JP-APA", category: "HAZARD", listIds: [7782] },
  { law: "JP-APA", category: "HAP", listIds: [3074] },
  { law: "JP-APA", category: "HAP-PRI", listIds: [3074] },
  { law: "JP-APA", category: "SPECIAL", listIds: [3072] },
  { law: "JP-WPCA", category: "HAZARD", listIds: [5605] },
  { law: "JP-WPCA", category: "DESIGNATED", listIds: [5606] },
  { law: "JP-SCCA", category: "SPECIFIED", listIds: [4021] },
  { law: "JP-CWCA", category: "SPECIFIED", listIds: [4048, 4043] },
  { law: "JP-CWCA", category: "DESIG1", listIds: [4055, 4050] },
  { law: "JP-CWCA", category: "DESIG2", listIds: [4057, 4056] },
  {
    law: "JP-OZONE",
    category: "SPECIFIED",
    listIds: [1213, 1212, 1211, 1210, 1209, 1208, 1207, 2049, 1206],
  },
  { law: "JP-OZONE", category: "ALTERNATIVE", listIds: [7988, 7989] },
  // 米国
  { law: "US-EPCRA", category: "TRI", listIds: [428] },
  { law: "US-TSCA", category: "SEC6", listIds: [635] },
  { law: "US-PROP65", category: "CANCER", listIds: [409] },
  { law: "US-PROP65", category: "DEV", listIds: [410] },
  { law: "US-PROP65", category: "REPRO_M", listIds: [411] },
  { law: "US-PROP65", category: "REPRO_F", listIds: [412] },
  // EU
  { law: "EU-REACH", category: "ANNEX14", listIds: [3614] },
  { law: "EU-REACH", category: "ANNEX17", listIds: [2459] },
  { law: "EU-REACH", category: "SVHC", listIds: [3611] },
  { law: "EU-ROHS", category: "ANNEX2", listIds: [1608] },
  { law: "EU-POPS", category: "ANNEX1", listIds: [2550] },
  { law: "EU-POPS", category: "ANNEX3", listIds: [2549] },
  // 条約
  { law: "INT-OZONE", category: "ANNEX_A", listIds: [1075, 1089] },
  { law: "INT-OZONE", category: "ANNEX_B", listIds: [1090, 1091, 1092] },
  { law: "INT-OZONE", category: "ANNEX_C", listIds: [1093, 1094, 1095] },
  { law: "INT-OZONE", category: "ANNEX_E", listIds: [1096] },
  { law: "INT-OZONE", category: "ANNEX_F", listIds: [7185, 7186] },
  { law: "INT-POPS", category: "ANNEX_A", listIds: [798] },
  { law: "INT-POPS", category: "ANNEX_B", listIds: [798] },
  { law: "INT-POPS", category: "ANNEX_C", listIds: [798] },
  { law: "INT-PIC", category: "ANNEX3", listIds: [664] },
  { law: "INT-MINAMATA", category: "COVERED", listIds: [7711] },
  // 中国（法律コードは国で引く。scripts/seed-china-links.ts と同じ）
  { country: "CHN", category: "HAZ", listIds: [2579] },
  { country: "CHN", category: "HYPERTOX", listIds: [1945] },
  { country: "CHN", category: "EXPLOSIVE", listIds: [5380] },
  { country: "CHN", category: "PRIORITY1", listIds: [7583] },
  { country: "CHN", category: "PRIORITY2", listIds: [8535] },
  { country: "CHN", category: "NEWPOL", listIds: [9637] },
  { country: "CHN", category: "RESTRICTED", listIds: [3683] },
  { country: "CHN", category: "PRECURSOR", listIds: [2171] },
  { country: "CHN", category: "CONTROLLED", listIds: [988] },
  // 韓国
  { law: "KR-KREACH", category: "PROHIBITED", listIds: [1887] },
  { law: "KR-KREACH", category: "RESTRICTED", listIds: [1888] },
  { law: "KR-KREACH", category: "PRIORITY", listIds: [7914] },
  { law: "KR-ISHA", category: "MFG_BAN", listIds: [1581] },
  { law: "KR-ISHA", category: "MFG_PERMIT", listIds: [1580] },
  { law: "KR-CCA", category: "TOXIC_ACUTE", listIds: [10266] },
  { law: "KR-CCA", category: "TOXIC_CHRONIC", listIds: [10267] },
  { law: "KR-CCA", category: "TOXIC_ECO", listIds: [10268] },
  { law: "KR-CCA", category: "ACCIDENT", listIds: [3564] },
  { law: "KR-PRTR", category: "GROUP1", listIds: [2480] },
  { law: "KR-PRTR", category: "GROUP2", listIds: [2479] },
  { law: "KR-POPS", category: "POPS", listIds: [9020] },
  { law: "KR-ROHS", category: "RESTRICTED", listIds: [6285] },
];

const SOURCE = "LOLI";

interface Row {
  text: string;
  textJa: string | null;
}

/** 取り出したファイルを (一覧ID, 正規化CAS) → 文章 に */
function readData(version: string): Map<string, Row> {
  const file = join(process.cwd(), "scripts/data", `loli-data-LOLI4_Datafeed_${version}.tsv`);
  const out = new Map<string, Row>();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const [listId = "", cas = "", text = "", ja = ""] = line.split("\t");
    if (!listId || !cas || !text) continue;
    const key = `${listId.trim()}\t${normalizeCas(cas)}`;
    // 同じ一覧・同じCASが複数行あれば最初のものを採る（並びは一覧ID・CAS順）
    if (!out.has(key)) {
      out.set(key, { text: text.trim(), textJa: ja && ja.trim() !== "NULL" ? ja.trim() : null });
    }
  }
  return out;
}

async function main() {
  const arg = process.argv[2] ?? "2026Q3";
  if (arg === "ids") {
    process.stdout.write(
      [...new Set(LISTS.flatMap((l) => l.listIds))].sort((a, b) => a - b).join(","),
    );
    return;
  }
  const version = arg;

  const [ver, source] = await Promise.all([
    prisma.linkSetVersion.findFirst({
      where: { codeNormalized: normalizeCode(version), deletedAt: null },
      select: { id: true, code: true },
    }),
    prisma.source.findFirst({ where: { code: SOURCE }, select: { id: true } }),
  ]);
  if (!ver) throw new Error(`バージョン ${version} がありません`);
  if (!source) throw new Error(`データソース ${SOURCE} がありません`);

  const data = readData(version);
  console.log(`${ver.code}: 取り出した文章 ${data.size} 行`);

  let totalLinks = 0;
  let totalWith = 0;
  let totalJa = 0;
  for (const map of LISTS) {
    const category = await prisma.regulationCategory.findFirst({
      where: {
        deletedAt: null,
        codeNormalized: normalizeCode(map.category),
        law: map.law
          ? { deletedAt: null, codeNormalized: normalizeCode(map.law) }
          : { deletedAt: null, country: { code: map.country } },
      },
      select: { id: true, code: true, law: { select: { code: true } } },
    });
    if (!category) {
      console.log(`  ${(map.law ?? map.country) + "/" + map.category}: 区分が無いので飛ばす`);
      continue;
    }
    const links = await prisma.statutoryCasLink.findMany({
      where: {
        versionId: ver.id,
        sourceId: source.id,
        statutorySubstance: { regulationClass: { categoryId: category.id } },
      },
      select: { id: true, casNormalized: true },
    });
    const rows: { linkId: string; text: string; textJa: string | null }[] = [];
    for (const l of links) {
      for (const listId of map.listIds) {
        const hit = data.get(`${listId}\t${l.casNormalized}`);
        if (hit) {
          rows.push({ linkId: l.id, ...hit });
          break;
        }
      }
    }
    if (links.length > 0) {
      await prisma.$transaction([
        prisma.statutoryCasLinkData.deleteMany({
          where: { linkId: { in: links.map((l) => l.id) } },
        }),
        ...(rows.length ? [prisma.statutoryCasLinkData.createMany({ data: rows })] : []),
      ]);
    }
    const ja = rows.filter((r) => r.textJa).length;
    totalLinks += links.length;
    totalWith += rows.length;
    totalJa += ja;
    console.log(
      `  ${`${category.law.code}/${category.code}`.padEnd(26)} リンク ${String(links.length).padStart(6)} / 文章 ${String(rows.length).padStart(6)} / 日本語 ${String(ja).padStart(6)}`,
    );
  }
  console.log(`合計: リンク ${totalLinks} / 文章 ${totalWith} / 日本語 ${totalJa}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
