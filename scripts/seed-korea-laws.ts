/**
 * 韓国の法令・規制区分・法文物質名を入れる。CASリンクは seed-korea-links.ts。
 *
 *   bash scripts/loli-dump-korea.sh                                        先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-korea-laws.ts
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-korea-laws.ts --write
 *
 * **法文物質名は号ごとに作る。**日本・中国と同じ考えかたで、
 * 号（`code` または `refno`）を法令上の番号として持ち、そこにCASを結ぶ。
 * RoHS だけは号を持たないので、EU RoHS と同じく親物質の10件を並べる。
 *
 * 名前の出どころは2つ。
 *
 *   listedunder    一覧が号の名前を持っているとき（PRTR・POPs など）。英語
 *   代表CASの名前  持っていないとき（ISHA・CCA など）。その号のいちばん小さいCASの名前
 *
 * 後者は**外部データベースの物質名であって法令の言葉ではない**。備考にそう書く。
 *
 * **閾値は号ごとに違う。**一律ではないので `korea-<名前>-thr.tsv` から読む。
 * 数値でないもの（重点管理の「CMR」、POPsの「Present」）は閾値にせず備考へ回す。
 *
 * **法令そのものはバージョンを持たない。**バージョンで分かれるのはCASリンクだけなので、
 * ここは1回入れれば足りる。入れ直すと同じ内容で上書きする。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CategoryDef {
  /** scripts/data/korea-<tsv>.tsv を読む */
  tsv: string;
  code: string;
  nameJa: string;
  nameEn: string;
  nameOriginal: string;
  /** 号に閾値が無いときの既定（ひな型にも使う） */
  lower?: string;
  note?: string;
}

interface LawDef {
  code: string;
  nameJa: string;
  nameEn: string;
  nameOriginal: string;
  displayOrder: number;
  categories: CategoryDef[];
}

/**
 * 入れる法令。
 *
 * 選んだのは**製品の可否に直結するもの**。GHS分類（有害性の区分そのもの）や
 * 化粧品・食品・医薬品の基準は入れていない。分類は規制ではないので、
 * 判定に混ぜるとどの製品もすべて該当してしまう。
 */
const LAWS: LawDef[] = [
  {
    code: "KR-KREACH",
    nameJa: "化学物質の登録及び評価等に関する法律（K-REACH）",
    nameEn: "Act on Registration and Evaluation of Chemical Substances (K-REACH)",
    nameOriginal: "화학물질의 등록 및 평가 등에 관한 법률",
    displayOrder: 10,
    categories: [
      {
        tsv: "kreach-prohibited",
        code: "PROHIBITED",
        nameJa: "禁止物質",
        nameEn: "Prohibited substances",
        nameOriginal: "금지물질",
        note: "製造・輸入・販売・保管・運搬・使用が禁じられる",
      },
      {
        tsv: "kreach-restricted",
        code: "RESTRICTED",
        nameJa: "制限物質",
        nameEn: "Restricted substances",
        nameOriginal: "제한물질",
        note: "特定の用途での製造・輸入・使用が制限される。用途は条文で決まるため、判定では見ていない",
      },
      /*
        有害化学物質（유독물질）は、告示が**有害性の種類ごとに**指定する。
        同じ号が急性・慢性・生態のうち複数に載ることがあり、閾値もそれぞれ違う。
        1つの区分にまとめると閾値を1つしか持てないので、3つに分ける。

        **区分の名前は英語のまま原語欄にも入れている。**この3つは
        情報源が英語でしか名前を持たず、韓国語の言い回しを当てると造語になるため。
      */
      {
        tsv: "kreach-toxic-acute",
        code: "TOXIC_ACUTE",
        nameJa: "急性毒性物質（人の健康）",
        nameEn: "Acute toxic substances for human health",
        nameOriginal: "Acute Toxic Substances for Human Health",
        note: "有害化学物質のうち、人の健康への急性の有害性で指定されたもの",
      },
      {
        tsv: "kreach-toxic-chronic",
        code: "TOXIC_CHRONIC",
        nameJa: "慢性毒性物質（人の健康）",
        nameEn: "Chronic toxic substances for human health",
        nameOriginal: "Chronic Toxic Substances for Human Health",
        note: "有害化学物質のうち、人の健康への慢性の有害性で指定されたもの",
      },
      {
        tsv: "kreach-toxic-eco",
        code: "TOXIC_ECO",
        nameJa: "生態毒性物質",
        nameEn: "Ecological toxic substances",
        nameOriginal: "Ecological Toxic Substances",
        note: "有害化学物質のうち、生態への有害性で指定されたもの",
      },
      {
        tsv: "kreach-priority",
        code: "PRIORITY",
        nameJa: "重点管理物質",
        nameEn: "Substances of concern",
        nameOriginal: "중점관리물질",
        note: "有害性が高いものとして指定され、含有量の報告が要る。濃度の下限は決まっていない",
      },
    ],
  },
  {
    code: "KR-ISHA",
    nameJa: "産業安全保健法",
    nameEn: "Industrial Safety and Health Act",
    nameOriginal: "산업안전보건법",
    displayOrder: 20,
    categories: [
      {
        tsv: "isha-ban",
        code: "MFG_BAN",
        nameJa: "製造等禁止物質",
        nameEn: "Substances prohibited for manufacture",
        nameOriginal: "제조등금지물질",
        lower: "1",
        note: "製造・輸入・譲渡・使用が禁じられる",
      },
      {
        tsv: "isha-permit",
        code: "MFG_PERMIT",
        nameJa: "許可対象物質",
        nameEn: "Substances requiring permission",
        nameOriginal: "허가대상물질",
        lower: "1",
        note: "製造・使用に雇用労働部長官の許可が要る",
      },
    ],
  },
  {
    code: "KR-CCA",
    nameJa: "化学物質管理法",
    nameEn: "Chemicals Control Act",
    nameOriginal: "화학물질관리법",
    displayOrder: 30,
    categories: [
      {
        tsv: "cca-accident",
        code: "ACCIDENT",
        nameJa: "事故備え物質",
        nameEn: "Accident precaution chemicals",
        nameOriginal: "사고대비물질",
        note: "事故が起きたときの被害が大きいものとして指定され、取扱基準と自主管理計画が要る",
      },
    ],
  },
  {
    code: "KR-PRTR",
    nameJa: "化学物質排出量調査（PRTR）",
    nameEn: "Pollutant Release and Transfer Registers (PRTR)",
    nameOriginal: "화학물질 배출량조사",
    displayOrder: 40,
    categories: [
      {
        tsv: "prtr-c1",
        code: "GROUP1",
        nameJa: "第1類",
        nameEn: "Group I",
        nameOriginal: "1군",
        note: "排出量・移動量の届出が要る",
      },
      {
        tsv: "prtr-c2",
        code: "GROUP2",
        nameJa: "第2類",
        nameEn: "Group II",
        nameOriginal: "2군",
        note: "排出量・移動量の届出が要る",
      },
    ],
  },
  {
    code: "KR-POPS",
    nameJa: "残留性有機汚染物質管理法",
    nameEn: "Persistent Organic Pollutants Control Act",
    nameOriginal: "잔류성유기오염물질 관리법",
    displayOrder: 50,
    categories: [
      {
        tsv: "pops",
        code: "POPS",
        nameJa: "残留性汚染物質",
        nameEn: "Persistent pollutants",
        nameOriginal: "잔류성오염물질",
        note: "ストックホルム条約に対応するもの。濃度の下限は決まっていない",
      },
    ],
  },
];

/**
 * 韓国RoHS（資源循環法）。
 *
 * 号を持たないので、EU RoHS と同じく**親物質の10件**を並べ、そこにCASを結ぶ。
 * 制限値も並べかたも EU RoHS と揃っている（カドミウムだけ 0.01%）。
 */
const ROHS_LAW = {
  code: "KR-ROHS",
  nameJa: "電気電子製品及び自動車の資源循環に関する法律（韓国RoHS）",
  nameEn: "Act on Resource Circulation of Electrical and Electronic Equipment and Vehicles",
  nameOriginal: "전기·전자제품 및 자동차의 자원순환에 관한 법률",
  displayOrder: 60,
};

interface RohsItem {
  no: string;
  /** LOLI が親として持っているコード。CASのこともあれば `RR-…` のこともある */
  parent: string;
  nameJa: string;
  nameEn: string;
  limit: string;
  /** 元素換算する金属 */
  element?: string;
}

const ROHS: RohsItem[] = [
  { no: "1", parent: "7439-92-1", nameJa: "鉛", nameEn: "Lead", limit: "0.1", element: "Pb" },
  { no: "2", parent: "7439-97-6", nameJa: "水銀", nameEn: "Mercury", limit: "0.1", element: "Hg" },
  {
    no: "3",
    parent: "7440-43-9",
    nameJa: "カドミウム",
    nameEn: "Cadmium",
    limit: "0.01",
    element: "Cd",
  },
  {
    no: "4",
    parent: "18540-29-9",
    nameJa: "六価クロム",
    nameEn: "Hexavalent chromium",
    limit: "0.1",
    element: "Cr",
  },
  {
    no: "5",
    parent: "RR-00086-2",
    nameJa: "ポリ臭化ビフェニル（PBB）",
    nameEn: "Polybrominated biphenyls (PBB)",
    limit: "0.1",
  },
  {
    no: "6",
    parent: "90193-67-2",
    nameJa: "ポリ臭化ジフェニルエーテル（PBDE）",
    nameEn: "Polybrominated diphenyl ethers (PBDE)",
    limit: "0.1",
  },
  {
    no: "7",
    parent: "117-81-7",
    nameJa: "フタル酸ビス（2-エチルヘキシル）（DEHP）",
    nameEn: "Bis(2-ethylhexyl) phthalate (DEHP)",
    limit: "0.1",
  },
  {
    no: "8",
    parent: "85-68-7",
    nameJa: "フタル酸ブチルベンジル（BBP）",
    nameEn: "Butyl benzyl phthalate (BBP)",
    limit: "0.1",
  },
  {
    no: "9",
    parent: "84-74-2",
    nameJa: "フタル酸ジブチル（DBP）",
    nameEn: "Dibutyl phthalate (DBP)",
    limit: "0.1",
  },
  {
    no: "10",
    parent: "84-69-5",
    nameJa: "フタル酸ジイソブチル（DIBP）",
    nameEn: "Diisobutyl phthalate (DIBP)",
    limit: "0.1",
  },
];

const data = (name: string) => join(process.cwd(), "scripts/data", `korea-${name}.tsv`);

/** 2欄のTSVを読む。同じ鍵が並ぶことがあるので値は配列 */
function readPairs(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const [k, v] = line.replace(/\r$/, "").split("\t");
    if (!k || !v) continue;
    const list = out.get(k) ?? [];
    list.push(v);
    out.set(k, list);
  }
  return out;
}

/** CAS → 名前。号の名前が無いときの代わりに使う */
function readCasNames(): Map<string, { ja: string; en: string }> {
  const out = new Map<string, { ja: string; en: string }>();
  const path = join(process.cwd(), "scripts/data/korea-cas-names.tsv");
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const [cas, ja, en] = line.replace(/\r$/, "").split("\t");
    if (!cas) continue;
    out.set(normalizeCas(cas.trim()), { ja: (ja ?? "").trim(), en: (en ?? "").trim() });
  }
  return out;
}

/**
 * `値/単位/種類` を閾値に直す。
 *
 * 数値のときだけ閾値にする。`>=` が付いていれば以上（境界を含む）、
 * 付いていなければ超（含まない）。数値でないものは備考に回す。
 */
function readThreshold(raw: string | undefined, fallback: string) {
  const none = { lower: fallback, bound: "EXCLUSIVE" as const, note: null as string | null };
  if (!raw) return none;
  const [value = "", unit = "", type = ""] = raw.split("/");
  const m = /^(>=)?\s*([\d.]+)$/.exec(value.trim());
  if (m && unit.includes("%")) {
    return {
      lower: m[2],
      bound: m[1] ? ("INCLUSIVE" as const) : ("EXCLUSIVE" as const),
      note: null,
    };
  }
  // 数値でないもの。重点管理は選ばれた理由、POPs は条約の附属書
  if (/^present$/i.test(value.trim())) {
    return { ...none, note: type ? `ストックホルム条約 附属書${type}` : null };
  }
  if (value.trim()) return { ...none, note: `指定の理由：${value.trim()}` };
  if (type.trim()) return { ...none, note: type.trim() };
  return none;
}

/** 号の並び。`06-4-2` が `06-4-10` より先に来るよう、数字は数として見る */
const orderOf = (k: string) =>
  k
    .split(/[^0-9a-zA-Z]+/)
    .map((p) => (/^\d+$/.test(p) ? p.padStart(6, "0") : p))
    .join("-");

/** 法令を1件、あれば上書きで作る */
async function upsertLaw(def: typeof ROHS_LAW, countryId: string, write: boolean) {
  const found = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(def.code) },
    select: { id: true },
  });
  const payload = {
    countryId,
    nameOriginal: def.nameOriginal,
    // 原文はハングル
    nameLang: "KO",
    nameJa: def.nameJa,
    nameEn: def.nameEn,
    displayOrder: def.displayOrder,
  };
  if (!write) return found;
  return found
    ? prisma.law.update({ where: { id: found.id }, data: payload, select: { id: true } })
    : prisma.law.create({
        data: { ...payload, code: def.code, codeNormalized: normalizeCode(def.code) },
        select: { id: true },
      });
}

/** 区分と、その下の名前のない受け皿を作る */
async function upsertCategory(
  lawId: string,
  code: string,
  payload: Record<string, unknown>,
): Promise<{ categoryId: string; classId: string }> {
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
  const classId =
    cls?.id ??
    (
      await prisma.regulationClass.create({
        data: { code: "DEFAULT", codeNormalized: "DEFAULT", categoryId: saved.id, displayOrder: 0 },
        select: { id: true },
      })
    ).id;
  return { categoryId: saved.id, classId };
}

async function upsertSubstance(classId: string, code: string, payload: Record<string, unknown>) {
  const found = await prisma.statutorySubstance.findFirst({
    where: { classId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  if (found) {
    await prisma.statutorySubstance.update({ where: { id: found.id }, data: payload as never });
    return;
  }
  await prisma.statutorySubstance.create({
    data: { ...payload, code, codeNormalized: normalizeCode(code), classId } as never,
  });
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const country = await prisma.country.findFirst({
    where: { codeNormalized: normalizeCode("KOR"), deletedAt: null },
    select: { id: true },
  });
  if (!country) throw new Error("国「KOR」がありません");
  const casNames = readCasNames();

  // --- 号のある法令 -----------------------------------------------------------
  for (const law of LAWS) {
    const row = await upsertLaw(law, country.id, write);
    console.log(`\n${law.code} ${law.nameJa}`);

    for (const [ci, cat] of law.categories.entries()) {
      const keys = readPairs(data(cat.tsv));
      const names = readPairs(data(`${cat.tsv}-name`));
      const thr = readPairs(data(`${cat.tsv}-thr`));
      const sorted = [...keys.keys()].sort((a, b) => orderOf(a).localeCompare(orderOf(b)));

      let classId: string | null = null;
      if (write && row) {
        const made = await upsertCategory(row.id, cat.code, {
          nameOriginal: cat.nameOriginal,
          nameLang: "KO",
          nameJa: cat.nameJa,
          nameEn: cat.nameEn,
          displayOrder: (ci + 1) * 10,
          // 区分の閾値は法文物質名を作るときのひな型。判定には使わない
          thresholdLower: cat.lower ?? "0",
          lowerBound: "EXCLUSIVE",
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          thresholdBasis: "PRODUCT",
          note: cat.note ?? null,
        });
        classId = made.classId;
      }

      let named = 0;
      let fromCas = 0;
      let withThr = 0;
      for (const [i, key] of sorted.entries()) {
        // 同じ号に別名が並ぶことがある（鉛クロム酸の顔料など）。全部つなぐ
        const listed = [...new Set(names.get(key) ?? [])].join(" / ") || null;
        const rep = (keys.get(key) ?? []).map((c) => normalizeCas(c)).sort()[0];
        const byCas = rep ? casNames.get(rep) : undefined;
        if (listed) named += 1;
        else if (byCas) fromCas += 1;

        const t = readThreshold(thr.get(key)?.[0], cat.lower ?? "0");
        if (t.lower !== (cat.lower ?? "0")) withThr += 1;

        const nameEn = listed ?? byCas?.en ?? key;
        if (!write || !classId) continue;

        await upsertSubstance(classId, `${law.code}-${cat.code}-${key}`, {
          officialNumber: key,
          nameOriginal: nameEn,
          nameLang: "EN",
          nameJa: listed ? null : byCas?.ja || null,
          nameEn,
          displayOrder: i + 1,
          aggregation: "NONE",
          metalEtc: null,
          thresholdLower: t.lower,
          lowerBound: t.bound,
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          note:
            [
              t.note,
              listed
                ? null
                : "名前は外部データベースの物質名。法令の言葉ではないので、条文で確かめること",
            ]
              .filter(Boolean)
              .join("／") || null,
        });
      }
      console.log(
        `  ${cat.code.padEnd(11)} 号 ${String(sorted.length).padStart(5)} 件` +
          `（一覧の名前 ${named} / 物質名で補う ${fromCas} / 閾値あり ${withThr}）`,
      );
    }
  }

  // --- RoHS（号を持たない） ----------------------------------------------------
  const rohsLaw = await upsertLaw(ROHS_LAW, country.id, write);
  console.log(`\n${ROHS_LAW.code} ${ROHS_LAW.nameJa}`);
  if (write && rohsLaw) {
    const made = await upsertCategory(rohsLaw.id, "RESTRICTED", {
      nameOriginal: "사용제한물질",
      nameLang: "KO",
      nameJa: "制限物質",
      nameEn: "Restricted substances",
      displayOrder: 10,
      // **均質材料あたり。**製品全体で割ると必ず薄まるので、判定は必ず要確認になる
      thresholdBasis: "HOMOGENEOUS_MATERIAL",
      thresholdLower: "0.1",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      note: "対象は電気電子製品と自動車。濃度は均質材料あたり。用途ごとの適用除外があり、当たるかは用途で決まるため判定では見ていない",
    });
    for (const [i, r] of ROHS.entries()) {
      await upsertSubstance(made.classId, `KR-ROHS-RESTRICTED-${r.no.padStart(2, "0")}`, {
        officialNumber: r.no,
        nameOriginal: r.nameEn,
        nameLang: "EN",
        nameJa: r.nameJa,
        nameEn: r.nameEn,
        displayOrder: i + 1,
        /*
          金属は**元素としてまとめる**。「鉛及びその化合物」と同じ考えかたで、
          化合物のぶんも鉛として数えないと、合計が足りずに見落とす
        */
        aggregation: r.element ? "ELEMENT" : "SUM",
        metalEtc: r.element ?? null,
        thresholdLower: r.limit,
        lowerBound: "EXCLUSIVE",
        thresholdUpper: "100",
        upperBound: "INCLUSIVE",
        note: null,
      });
    }
  }
  console.log(`  RESTRICTED  号 ${String(ROHS.length).padStart(5)} 件（EU RoHS と同じ10件）`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
