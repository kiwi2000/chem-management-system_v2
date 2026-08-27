/**
 * EU RoHS（2011/65/EU 附属書II）を入れる。
 *
 *   bash scripts/loli-dump-rohs.sh                                     先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-rohs.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-rohs.ts --write
 *
 * **閾値は均質材料あたり。**ねじのめっき、基板のはんだ、といった分けられない
 * 単位ごとに見る。こちらの組成は製品全体でしか持っていないので、
 * 区分を `HOMOGENEOUS_MATERIAL` にして、**当たっても当たらなくても必ず要確認**にする。
 * 均質材料そのものを原材料として登録し、そちらを判定すれば正しく見られる。
 *
 * **適用条件は法文物質名の備考に書く。**対象の機器や、いつから効くかは
 * 濃度では表せない。判定はそこまで見ないので、読む人が条文へ戻れるようにしておく。
 *
 * CASリンクは LOLI（ListID 1608、271件）から。
 * LOLI は親物質から個々の異性体へ広げた形で持っているので、
 * `As 鉛 [7439-92-1]` のような但し書きを鍵にして、こちらの10種へ結び直す。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SOURCE_CODE = "LOLI";

/** LOLI の Cas 欄には総称の擬似CAS（`RR-…`）も混ざる。CASの形だけ採る */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

interface Restricted {
  /** 附属書IIの項番。法令上の番号として持つ */
  no: string;
  /** LOLI が親として使っているCAS（擬似CASを含む）。ここで結び直す */
  parentCas: string;
  nameJa: string;
  nameEn: string;
  /** 均質材料に対する重量%。これを**超えたら**該当 */
  limit: string;
  /** 元素としてまとめるならその記号。化合物をまとめて数えるために使う */
  element?: string;
  /** 適用条件。濃度では表せないもの */
  note: string;
}

/**
 * 附属書IIの10物質。
 *
 * フタル酸エステル4種（DEHP・BBP・DBP・DIBP）は 2019-07-22 から。
 * 医療機器と監視制御機器はさらに遅れて 2021-07-22 から効く。
 * この差は日付でしか表せないので、備考に書いて人に読んでもらう。
 */
const RESTRICTED: Restricted[] = [
  {
    no: "1",
    parentCas: "7439-92-1",
    nameJa: "鉛",
    nameEn: "Lead",
    limit: "0.1",
    element: "Pb",
    note: "附属書IIIに用途ごとの適用除外がある（はんだ、ガラス、合金など）。除外に当たるかは用途で決まるため、判定では見ていない",
  },
  {
    no: "2",
    parentCas: "7439-97-6",
    nameJa: "水銀",
    nameEn: "Mercury",
    limit: "0.1",
    element: "Hg",
    note: "附属書IIIに用途ごとの適用除外がある（蛍光ランプなど）。除外に当たるかは用途で決まるため、判定では見ていない",
  },
  {
    no: "3",
    parentCas: "7440-43-9",
    nameJa: "カドミウム",
    nameEn: "Cadmium",
    limit: "0.01",
    element: "Cd",
    note: "他の9物質と違い 0.01%。附属書IIIに用途ごとの適用除外がある",
  },
  {
    no: "4",
    parentCas: "18540-29-9",
    nameJa: "六価クロム",
    nameEn: "Hexavalent chromium",
    limit: "0.1",
    element: "Cr",
    note: "**六価のものだけ**が対象。三価クロムは当たらないが、CASからは酸化数を判別できないため、クロム化合物が入っていたら価数を確かめること",
  },
  {
    no: "5",
    parentCas: "RR-00086-2",
    nameJa: "ポリ臭化ビフェニル（PBB）",
    nameEn: "Polybrominated biphenyls (PBB)",
    limit: "0.1",
    note: "総称。臭素の数と位置の違いで多数の異性体がある",
  },
  {
    no: "6",
    parentCas: "90193-67-2",
    nameJa: "ポリ臭化ジフェニルエーテル（PBDE）",
    nameEn: "Polybrominated diphenyl ethers (PBDE)",
    limit: "0.1",
    note: "総称。臭素の数と位置の違いで多数の異性体がある",
  },
  {
    no: "7",
    parentCas: "117-81-7",
    nameJa: "フタル酸ビス（2-エチルヘキシル）（DEHP）",
    nameEn: "Bis(2-ethylhexyl) phthalate (DEHP)",
    limit: "0.1",
    note: "2019-07-22 から。医療機器と監視制御機器（産業用を含む）は 2021-07-22 から",
  },
  {
    no: "8",
    parentCas: "85-68-7",
    nameJa: "フタル酸ブチルベンジル（BBP）",
    nameEn: "Butyl benzyl phthalate (BBP)",
    limit: "0.1",
    note: "2019-07-22 から。医療機器と監視制御機器（産業用を含む）は 2021-07-22 から",
  },
  {
    no: "9",
    parentCas: "84-74-2",
    nameJa: "フタル酸ジブチル（DBP）",
    nameEn: "Dibutyl phthalate (DBP)",
    limit: "0.1",
    note: "2019-07-22 から。医療機器と監視制御機器（産業用を含む）は 2021-07-22 から",
  },
  {
    no: "10",
    parentCas: "84-69-5",
    nameJa: "フタル酸ジイソブチル（DIBP）",
    nameEn: "Diisobutyl phthalate (DIBP)",
    limit: "0.1",
    note: "2019-07-22 から。医療機器と監視制御機器（産業用を含む）は 2021-07-22 から",
  },
];

const LAW_CODE = "EU-ROHS";
const CATEGORY_CODE = "ANNEX2";

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const country = await prisma.country.findFirst({
    where: { codeNormalized: normalizeCode("EU"), deletedAt: null },
    select: { id: true },
  });
  if (!country)
    throw new Error("国「EU」がありません。先に seed-international.ts を流してください");

  const language = await prisma.language.findFirst({
    where: { code: "EN" },
    select: { code: true },
  });
  const nameLang = language?.code ?? "EN";

  // --- 法令 -----------------------------------------------------------------
  let law = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(LAW_CODE) },
    select: { id: true },
  });
  if (!law && write) {
    law = await prisma.law.create({
      data: {
        code: LAW_CODE,
        codeNormalized: normalizeCode(LAW_CODE),
        countryId: country.id,
        nameOriginal:
          "Directive 2011/65/EU on the restriction of the use of certain hazardous substances in electrical and electronic equipment",
        nameLang,
        nameJa: "RoHS指令",
        nameEn: "RoHS Directive (2011/65/EU)",
        displayOrder: 30,
      },
      select: { id: true },
    });
    console.log("  法令 EU-ROHS を作りました");
  }
  if (!law) {
    console.log("  下見のためここで止めます（法令が無いので配下は作れません）");
    await prisma.$disconnect();
    return;
  }

  // --- 区分 -----------------------------------------------------------------
  let category = await prisma.regulationCategory.findFirst({
    where: { lawId: law.id, codeNormalized: normalizeCode(CATEGORY_CODE) },
    select: { id: true },
  });
  const categoryData = {
    nameOriginal:
      "Restricted substances referred to in Article 4(1) and maximum concentration values tolerated by weight in homogeneous materials",
    nameLang,
    nameJa: "制限物質（附属書II）",
    nameEn: "Restricted substances (Annex II)",
    displayOrder: 10,
    /*
      **均質材料あたり。**製品全体で割ると必ず薄まるので、
      当たっても当たらなくても要確認になる
    */
    thresholdBasis: "HOMOGENEOUS_MATERIAL" as const,
    // 区分の閾値は法文物質名を作るときのひな型。判定には使わない
    thresholdLower: "0.1",
    lowerBound: "EXCLUSIVE" as const,
    thresholdUpper: "100",
    upperBound: "INCLUSIVE" as const,
    note: "対象は電気電子機器（EEE）。附属書Iのカテゴリに入るもの。附属書IIIとIVに用途ごとの適用除外がある",
  };
  if (write) {
    category = category
      ? await prisma.regulationCategory.update({
          where: { id: category.id },
          data: categoryData,
          select: { id: true },
        })
      : await prisma.regulationCategory.create({
          data: {
            ...categoryData,
            code: CATEGORY_CODE,
            codeNormalized: normalizeCode(CATEGORY_CODE),
            lawId: law.id,
          },
          select: { id: true },
        });
  }
  if (!category) {
    console.log("  下見のためここで止めます");
    await prisma.$disconnect();
    return;
  }

  // --- 分類（分けないので名前のない受け皿を1件） -------------------------------
  let cls = await prisma.regulationClass.findFirst({
    where: { categoryId: category.id, deletedAt: null },
    select: { id: true },
  });
  if (!cls && write) {
    cls = await prisma.regulationClass.create({
      data: {
        code: "DEFAULT",
        codeNormalized: "DEFAULT",
        categoryId: category.id,
        displayOrder: 0,
      },
      select: { id: true },
    });
  }
  if (!cls) {
    await prisma.$disconnect();
    return;
  }

  // --- 法文物質名 -------------------------------------------------------------
  /** 附属書IIの項番 → こちらの法文物質名の id */
  const idOfParent = new Map<string, string>();
  for (const [i, r] of RESTRICTED.entries()) {
    const code = `${LAW_CODE}-${CATEGORY_CODE}-${r.no.padStart(2, "0")}`;
    const data = {
      officialNumber: `附属書II ${r.no}`,
      nameOriginal: r.nameEn,
      nameLang,
      nameJa: r.nameJa,
      nameEn: r.nameEn,
      displayOrder: i + 1,
      /*
        金属は**元素としてまとめる**。「鉛及びその化合物」と同じ考えかたで、
        化合物のぶんも鉛として数えないと、合計が足りずに見落とす
      */
      aggregation: r.element ? ("ELEMENT" as const) : ("SUM" as const),
      metalEtc: r.element ?? null,
      // 「〇.一％を超えるもの」。以下は当たらない
      thresholdLower: r.limit,
      lowerBound: "EXCLUSIVE" as const,
      thresholdUpper: "100",
      upperBound: "INCLUSIVE" as const,
      note: r.note,
    };
    let sub = await prisma.statutorySubstance.findFirst({
      where: { classId: cls.id, codeNormalized: normalizeCode(code) },
      select: { id: true },
    });
    if (write) {
      sub = sub
        ? await prisma.statutorySubstance.update({
            where: { id: sub.id },
            data,
            select: { id: true },
          })
        : await prisma.statutorySubstance.create({
            data: { ...data, code, codeNormalized: normalizeCode(code), classId: cls.id },
            select: { id: true },
          });
    }
    if (sub) idOfParent.set(r.parentCas, sub.id);
    console.log(
      `  ${r.no.padStart(2)} ${r.nameJa}（${r.limit}% 超で該当${r.element ? ` / ${r.element}換算` : ""}）`,
    );
  }

  // --- CASリンク ---------------------------------------------------------------
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);

  const rows = readFileSync(join(process.cwd(), "scripts/data/loli-eu-rohs.tsv"), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t"));

  const seen = new Set<string>();
  const missed = new Set<string>();
  let skippedShape = 0;
  const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
  for (const [parent, cas] of rows) {
    if (!parent || !cas) continue;
    if (!CAS_SHAPE.test(cas)) {
      skippedShape += 1;
      continue;
    }
    const id = idOfParent.get(parent);
    if (!id) {
      missed.add(parent);
      continue;
    }
    const casNormalized = normalizeCas(cas);
    const dedup = `${id}/${casNormalized}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    data.push({ statutorySubstanceId: id, casNumber: cas, casNormalized });
  }

  if (write) {
    const removed = await prisma.statutoryCasLink.deleteMany({
      where: {
        versionId: version.id,
        sourceId: source.id,
        statutorySubstanceId: { in: [...idOfParent.values()] },
      },
    });
    for (let i = 0; i < data.length; i += 5000) {
      await prisma.statutoryCasLink.createMany({
        data: data
          .slice(i, i + 5000)
          .map((d) => ({ ...d, versionId: version.id, sourceId: source.id })),
        skipDuplicates: true,
      });
    }
    console.log(
      `\n  ${version.code} × ${source.code}: ${removed.count} 件を消し ${data.length} 件を入れました`,
    );
  } else {
    console.log(`\n  ${version.code} × ${source.code} に ${data.length} 件を入れる予定です`);
  }
  console.log(`  CASの形でない ${skippedShape} 件、親が合わない ${missed.size} 種を飛ばしました`);
  if (missed.size > 0) console.log(`  合わなかった親: ${[...missed].join(", ")}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
