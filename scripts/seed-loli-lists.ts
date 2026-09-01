/**
 * LOLI にあって本システムに無かった規制を入れる。区分・法文物質名・CASリンクまで。
 *
 *   bash scripts/loli-dump-lists.sh                             先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-loli-lists.ts
 *   ... scripts/seed-loli-lists.ts --write
 *
 * 入るもの
 *   INT-OZONE  モントリオール議定書   附属書A〜F（法令の箱だけあって中身が空だった）
 *   EU-POPS    EU POPs規則(2019/1021) 附属書I（禁止）・附属書III（排出削減）
 *   US-PROP65  カリフォルニア Prop 65 発がん性・生殖毒性（男/女）・発生毒性
 *
 * **法文物質名は親物質ごとに作る。**LOLI は規制が挙げるまとまり（「HCFC類」など）から
 * 個々の異性体・塩へ広げた形で持つ。広げたぶんは法文物質名ではなくCASリンク。
 *
 * **番号は親のCAS。**どの規制も附属書の中で通し番号を持たないため、
 * まとめの鍵になっている親のCAS（LOLI の内部コードになることもある）をそのまま置く。
 * 条約の取り込み（seed-treaty-laws.ts）と同じ考え方。
 *
 * **閾値は置かない（0%超）。**3つとも含有率の下限を法文が持たない。
 * Prop 65 は「安全とみなす量（NSRL/MADL）」を別に持つが、これは1日あたりの摂取量で
 * 製品の含有率ではないので、区分の閾値にはしない。
 *
 * 何度流しても同じ結果になる（足すか、書き換えるだけ。消さない）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** CASリンクの出どころ。取り出し元が LOLI なので LOLI で入れる */
const SOURCE_CODE = "LOLI";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

interface CategoryDef {
  code: string;
  nameJa: string;
  nameEn: string;
  /** その区分に入れるくくり（取り出しで付けた札）。省くと全部 */
  values?: string[];
  note: string;
}

interface LawDef {
  /** scripts/data/list-<tsv>*.tsv を読む */
  tsv: string;
  law: string;
  nameJa: string;
  /** 法令が無いときに作る。すでにあるものは触らない */
  create?: {
    country: string;
    nameOriginal: string;
    nameJa: string;
    displayOrder: number;
    note: string;
  };
  categories: CategoryDef[];
  /** くくりを備考に書き残すときの書きかた（区分に使わないとき） */
  valueNote?: (values: string[]) => string;
}

const LAWS: LawDef[] = [
  {
    tsv: "ozone",
    law: "INT-OZONE",
    nameJa: "モントリオール議定書",
    /*
      附属書ごとに削減の期限が違う（A・B は全廃済み、C は HCFC、F は HFC）。
      グループは同じ附属書の中の細分なので、区分は附属書ごとにまとめる
    */
    categories: [
      {
        code: "ANNEX_A",
        nameJa: "附属書A（CFC・ハロン）",
        nameEn: "Annex A (CFCs and halons)",
        values: ["Annex A Group I", "Annex A Group II"],
        note: "特定フロン（CFC）とハロン。先進国・途上国とも全廃済み",
      },
      {
        code: "ANNEX_B",
        nameJa: "附属書B（その他CFC・四塩化炭素等）",
        nameEn: "Annex B (Other CFCs, carbon tetrachloride, methyl chloroform)",
        values: ["Annex B Group I", "Annex B Group II", "Annex B Group III"],
        note: "その他の特定フロン、四塩化炭素、1,1,1-トリクロロエタン。全廃済み",
      },
      {
        code: "ANNEX_C",
        nameJa: "附属書C（HCFC等）",
        nameEn: "Annex C (HCFCs, HBFCs, bromochloromethane)",
        values: ["Annex C Group I", "Annex C Group II", "Annex C Group III"],
        note: "指定フロン（HCFC）ほか。段階的に削減中",
      },
      {
        code: "ANNEX_E",
        nameJa: "附属書E（臭化メチル）",
        nameEn: "Annex E (Methyl bromide)",
        values: ["Annex E"],
        note: "臭化メチル。検疫・出荷前の用途を除いて全廃済み",
      },
      {
        code: "ANNEX_F",
        nameJa: "附属書F（HFC）",
        nameEn: "Annex F (HFCs)",
        values: ["Annex F Group I", "Annex F Group II"],
        note: "代替フロン（HFC）。キガリ改正で削減対象になった。オゾン層は壊さないが温室効果が大きい",
      },
    ],
    valueNote: (v) => `附属書のグループ: ${v.join(" / ")}`,
  },
  {
    tsv: "eupops",
    law: "EU-POPS",
    nameJa: "EU POPs規則",
    create: {
      country: "EU",
      nameOriginal: "Regulation (EU) 2019/1021 on persistent organic pollutants",
      nameJa: "残留性有機汚染物質に関する規則（EU POPs規則）",
      displayOrder: 320,
      note: "ストックホルム条約のEU国内法。附属書Iに載ると製造・上市・使用が原則禁止。SDSの第15項",
    },
    categories: [
      {
        code: "ANNEX1",
        nameJa: "附属書I（禁止物質）",
        nameEn: "Annex I (Prohibited substances)",
        values: ["Annex I"],
        note: "製造・上市・使用が原則禁止。物質ごとに非意図的な微量混入の限度が定められているものがある",
      },
      {
        code: "ANNEX3",
        nameJa: "附属書III（排出削減対象）",
        nameEn: "Annex III (Substances subject to release reduction provisions)",
        values: ["Annex III"],
        note: "非意図的に生成する物質。排出目録の作成と削減が求められる",
      },
    ],
  },
  {
    tsv: "prop65",
    law: "US-PROP65",
    nameJa: "カリフォルニア Proposition 65",
    create: {
      country: "USA",
      nameOriginal:
        "California Safe Drinking Water and Toxic Enforcement Act of 1986 (Proposition 65)",
      nameJa: "カリフォルニア州 安全飲料水及び有害物質施行法（Proposition 65）",
      displayOrder: 420,
      note: "カリフォルニア州で製品を売るときに警告表示が要る物質の一覧。州が公表し、随時追加される",
    },
    /*
      州の一覧は「がん」「生殖毒性（男性）」「生殖毒性（女性）」「発生毒性」に分かれ、
      同じ物質が複数に載る。**警告表示が要ることは同じ**なので、載っている理由ごとに区分を分ける
    */
    categories: [
      {
        code: "CANCER",
        nameJa: "発がん性",
        nameEn: "Carcinogens",
        values: ["Carcinogens"],
        note: "がんを引き起こすとして州が公表した物質",
      },
      {
        code: "DEV",
        nameJa: "発生毒性",
        nameEn: "Developmental toxicity",
        values: ["Developmental toxicity"],
        note: "胎児の発生に影響するとして州が公表した物質",
      },
      {
        code: "REPRO_M",
        nameJa: "生殖毒性（男性）",
        nameEn: "Reproductive toxicity (male)",
        values: ["Reproductive toxicity male"],
        note: "男性の生殖機能に影響するとして州が公表した物質",
      },
      {
        code: "REPRO_F",
        nameJa: "生殖毒性（女性）",
        nameEn: "Reproductive toxicity (female)",
        values: ["Reproductive toxicity female"],
        note: "女性の生殖機能に影響するとして州が公表した物質",
      },
    ],
  },
];

/** 鍵と値の並びに読む */
function readPairs(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const text = readFileSync(join(process.cwd(), "scripts/data", `${file}.tsv`), "utf-8");
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "") continue;
    const [k, v] = row.split("\t");
    if (!k || !v) continue;
    const got = map.get(k);
    if (got) got.push(v);
    else map.set(k, [v]);
  }
  return map;
}

/** CASは数の順、LOLI の内部コードは後ろにまとめる */
function orderOf(key: string): string {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(key);
  if (!m) return `z${key}`;
  return `a${m[1].padStart(9, "0")}-${m[2]}-${m[3]}`;
}

const THRESHOLD = {
  thresholdLower: "0",
  lowerBound: "EXCLUSIVE" as const,
  thresholdUpper: "100",
  upperBound: "INCLUSIVE" as const,
};

async function findOrCreateLaw(def: LawDef): Promise<string> {
  const found = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(def.law), deletedAt: null },
    select: { id: true },
  });
  if (found) return found.id;
  if (!def.create) throw new Error(`法令 ${def.law} がありません`);

  const country = await prisma.country.findFirst({
    where: { codeNormalized: normalizeCode(def.create.country), deletedAt: null },
    select: { id: true },
  });
  if (!country) throw new Error(`国 ${def.create.country} がありません`);

  const law = await prisma.law.create({
    data: {
      code: def.law,
      codeNormalized: normalizeCode(def.law),
      countryId: country.id,
      nameOriginal: def.create.nameOriginal,
      nameLang: "EN",
      nameJa: def.create.nameJa,
      nameEn: def.create.nameOriginal,
      displayOrder: def.create.displayOrder,
      note: def.create.note,
    },
    select: { id: true },
  });
  console.log(`  法令を作りました: ${def.law}`);
  return law.id;
}

async function upsertCategory(lawId: string, code: string, payload: Record<string, unknown>) {
  const found = await prisma.regulationCategory.findFirst({
    where: { lawId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  const saved = found
    ? await prisma.regulationCategory.update({
        where: { id: found.id },
        data: payload,
        select: { id: true },
      })
    : await prisma.regulationCategory.create({
        data: { ...payload, code, codeNormalized: normalizeCode(code), lawId } as never,
        select: { id: true },
      });
  const cls = await prisma.regulationClass.findFirst({
    where: { categoryId: saved.id, deletedAt: null },
    select: { id: true },
  });
  return (
    cls?.id ??
    (
      await prisma.regulationClass.create({
        data: { code: "DEFAULT", codeNormalized: "DEFAULT", categoryId: saved.id, displayOrder: 0 },
        select: { id: true },
      })
    ).id
  );
}

async function upsertSubstance(
  classId: string,
  code: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const found = await prisma.statutorySubstance.findFirst({
    where: { classId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  if (found) {
    await prisma.statutorySubstance.update({ where: { id: found.id }, data: payload as never });
    return found.id;
  }
  const made = await prisma.statutorySubstance.create({
    data: { ...payload, code, codeNormalized: normalizeCode(code), classId } as never,
    select: { id: true },
  });
  return made.id;
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  // CASリンクは物質マスタにある番号にだけ張れる
  const known = new Set(
    (await prisma.substance.findMany({ select: { casNumber: true } }))
      .map((s) => s.casNumber)
      .filter((c): c is string => !!c),
  );

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
  console.log(`  入れ先: ${version.code} × ${source.code}`);

  for (const def of LAWS) {
    const keys = readPairs(`list-${def.tsv}`);
    const names = readPairs(`list-${def.tsv}-name`);
    const groups = readPairs(`list-${def.tsv}-group`);
    const casAll = [...keys.values()].reduce((a, b) => a + b.length, 0);
    console.log(`\n${def.law} ${def.nameJa}  親物質 ${keys.size} 種 / CAS ${casAll} 件`);

    const lawId = write ? await findOrCreateLaw(def) : null;

    for (const [ci, cat] of def.categories.entries()) {
      const mine = [...keys.keys()]
        .filter((k) => !cat.values || (groups.get(k) ?? []).some((v) => cat.values.includes(v)))
        .sort((a, b) => orderOf(a).localeCompare(orderOf(b)));

      let classId: string | null = null;
      if (write && lawId) {
        classId = await upsertCategory(lawId, cat.code, {
          nameOriginal: cat.nameEn,
          nameLang: "EN",
          nameJa: cat.nameJa,
          nameEn: cat.nameEn,
          displayOrder: (ci + 1) * 10,
          ...THRESHOLD,
          thresholdBasis: "PRODUCT",
          note: cat.note,
        });
      }

      let casCount = 0;
      let linked = 0;
      for (const [i, key] of mine.entries()) {
        const cas = [
          ...new Set((keys.get(key) ?? []).filter((c) => CAS_SHAPE.test(c) && known.has(c))),
        ];
        casCount += cas.length;
        const nameEn = names.get(key)?.[0] ?? key;
        if (!write || !classId) continue;

        const vals = groups.get(key) ?? [];
        const id = await upsertSubstance(classId, `${def.law}-${cat.code}-${key}`, {
          officialNumber: key,
          nameOriginal: nameEn,
          nameLang: "EN",
          nameJa: null,
          nameEn,
          displayOrder: i + 1,
          aggregation: "NONE",
          metalEtc: null,
          ...THRESHOLD,
          note: def.valueNote && vals.length > 0 ? def.valueNote(vals) : null,
        });

        const rows = cas.map((c) => ({
          statutorySubstanceId: id,
          casNumber: c,
          casNormalized: normalizeCas(c),
          versionId: version.id,
          sourceId: source.id,
        }));
        // その法文物質名ぶんだけ入れ替える。ほかのバージョン・ほかの出どころには触らない
        await prisma.statutoryCasLink.deleteMany({
          where: { versionId: version.id, sourceId: source.id, statutorySubstanceId: id },
        });
        const made = await prisma.statutoryCasLink.createMany({
          data: rows,
          skipDuplicates: true,
        });
        linked += made.count;
      }
      console.log(
        `  ${cat.code.padEnd(9)}${cat.nameJa.padEnd(20)}法文物質名 ${String(mine.length).padStart(4)} 件 / CAS ${String(casCount).padStart(5)} 件${write ? ` / 新しく張った ${linked} 件` : ""}`,
      );
    }
  }
  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
