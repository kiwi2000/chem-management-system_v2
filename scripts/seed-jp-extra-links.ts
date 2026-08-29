/**
 * あとから足した日本の法規制の、法文物質名とCASの結び付けを入れる。
 * 法令の中身は seed-jp-extra-laws.ts。
 *
 *   bash scripts/loli-dump-jp-extra.sh                       現在のバージョンぶんを取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-jp-extra-links.ts 2026Q3 --write
 *
 * **バージョンは引数で選べる。**省くと現在のバージョン。
 * データソースは LOLI。CHRIP のぶんは別に入れる（入れ先が違うので混ぜない）。
 *
 * **突き合わせかたは法規制ごとに違う。**
 *
 *   皮膚等障害・がん原性物質  法文物質名の番号が CAS。LOLI の CAS をそのまま当てる
 *   鉛等・四アルキル鉛等     法文の定義は1件だけ。その一覧の CAS を全部そこへ結ぶ
 *   オゾン層保護法          LOLI が法文の号番号を持っているものはその番号で、
 *                          持っていないものは物質マスタの日本語名で CAS に直して当てる
 *
 * **CASは外部データベースがすでに展開したものをそのまま使う。**
 * 総称からこちらで広げることはしない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DATA = join(process.cwd(), "scripts", "data");

const SOURCE_CODE = "LOLI";
/** `1333-86-4` の形だけを通す。`RR-…` のような内部コードは入れない */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 取り出したファイルと、法令・区分・分類の対応。seed-jp-extra-laws.ts と合わせること */
interface SetDef {
  tsv: string[];
  law: string;
  category: string;
  cls: string;
  /** 号の当てかた */
  match: "cas" | "single" | "ozone";
  /** ozone のとき、法文の別表（`1` か `2`）と項 */
  table?: string;
  paragraph?: string;
}

const SETS: SetDef[] = [
  // 皮膚等障害。LOLI の4つの一覧をまとめて当てる（分類は厚生労働省の印で決まっている）
  {
    tsv: ["skin-irritation", "skin-eye", "skin-specified", "skin-absorption"],
    law: "JP-ISHA",
    category: "SKIN",
    cls: "IRRITATION",
    match: "cas",
  },
  {
    tsv: ["skin-absorption", "skin-eye", "skin-specified", "skin-irritation"],
    law: "JP-ISHA",
    category: "SKIN",
    cls: "ABSORPTION",
    match: "cas",
  },
  {
    tsv: ["skin-specified", "skin-eye", "skin-irritation", "skin-absorption"],
    law: "JP-ISHA",
    category: "SKIN",
    cls: "SPECIAL",
    match: "cas",
  },
  { tsv: ["carcinogen30"], law: "JP-ISHA", category: "CARC30", cls: "DEFAULT", match: "cas" },
  { tsv: ["lead"], law: "JP-ISHA", category: "LEAD", cls: "LEAD", match: "single" },
  {
    tsv: ["tetraalkyl-lead"],
    law: "JP-ISHA",
    category: "LEAD",
    cls: "TETRAALKYL",
    match: "single",
  },
];

/** オゾン層保護法。LOLI の一覧と、法文の別表・項の対応 */
const OZONE: { tsv: string; category: string; table: string; paragraph: string }[] = [
  { tsv: "ozone-a1", category: "SPECIFIED", table: "1", paragraph: "1" },
  { tsv: "ozone-a2", category: "SPECIFIED", table: "1", paragraph: "2" },
  { tsv: "ozone-b1", category: "SPECIFIED", table: "1", paragraph: "3" },
  { tsv: "ozone-b2", category: "SPECIFIED", table: "1", paragraph: "4" },
  { tsv: "ozone-b3", category: "SPECIFIED", table: "1", paragraph: "5" },
  { tsv: "ozone-c1", category: "SPECIFIED", table: "1", paragraph: "6" },
  { tsv: "ozone-c2", category: "SPECIFIED", table: "1", paragraph: "7" },
  { tsv: "ozone-c3", category: "SPECIFIED", table: "1", paragraph: "8" },
  { tsv: "ozone-e1", category: "SPECIFIED", table: "1", paragraph: "9" },
  { tsv: "ozone-f1", category: "ALTERNATIVE", table: "2", paragraph: "1" },
  { tsv: "ozone-f2", category: "ALTERNATIVE", table: "2", paragraph: "2" },
];

function readPairs(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of readFileSync(join(DATA, `jp-extra-${file}.tsv`), "utf8").split("\n")) {
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

/** 比べる前に形をそろえる。かっこ・中黒・長音の揺れを吸収する */
const normName = (s: string) =>
  s
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐－―ー−–—-]/g, "")
    .replace(/[・･,，]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

async function substancesOf(law: string, category: string, cls: string) {
  return prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: {
        deletedAt: null,
        codeNormalized: normalizeCode(cls),
        category: {
          deletedAt: null,
          codeNormalized: normalizeCode(category),
          law: { deletedAt: null, codeNormalized: normalizeCode(law) },
        },
      },
    },
    select: { id: true, officialNumber: true, nameJa: true },
  });
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const versionArg = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
  const version = await prisma.linkSetVersion.findFirst({
    where: versionArg
      ? { codeNormalized: versionArg.toUpperCase(), deletedAt: null }
      : { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) {
    throw new Error(
      versionArg ? `バージョン ${versionArg} がありません` : "現在のバージョンが決まっていません",
    );
  }
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  console.log(`  入れ先: ${version.code} × ${source.code}\n`);

  /** 物質マスタの日本語名から CAS を引く。オゾン層保護法の突き合わせに使う */
  const master = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { not: null } },
    select: { casNumber: true, nameJa: true, nameEn: true },
  });
  const casOfName = new Map<string, string>();
  const casOfEnName = new Map<string, string>();
  for (const s of master) {
    if (!s.casNumber) continue;
    const ja = normName(s.nameJa ?? "");
    if (ja && !casOfName.has(ja)) casOfName.set(ja, s.casNumber);
    const en = normName(s.nameEn ?? "");
    if (en && !casOfEnName.has(en)) casOfEnName.set(en, s.casNumber);
  }

  let total = 0;
  const put = async (
    label: string,
    subs: { id: string }[],
    data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[],
    extra: string,
  ) => {
    if (write) {
      // その分類ぶんだけ入れ替える。ほかの分類やほかのバージョンには触らない
      await prisma.statutoryCasLink.deleteMany({
        where: {
          versionId: version.id,
          sourceId: source.id,
          statutorySubstanceId: { in: subs.map((s) => s.id) },
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
    }
    total += data.length;
    console.log(`  ${label.padEnd(34)}${String(data.length).padStart(6)} 件${extra}`);
  };

  // --- 安衛法 -----------------------------------------------------------------
  for (const set of SETS) {
    const subs = await substancesOf(set.law, set.category, set.cls);
    const idOfCas = new Map(subs.map((s) => [normalizeCas(s.officialNumber ?? ""), s.id] as const));

    const seen = new Set<string>();
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    let outside = 0;
    let shape = 0;

    for (const tsv of set.tsv) {
      for (const [key, list] of readPairs(tsv)) {
        /*
          その号にぶら下がる CAS を全部見る。**代表のCASだけでは足りない。**
          LOLI は総称から異性体・塩へ広げており、法令が挙げているのは親のほうなので、
          広げたぶんも同じ法文物質名に結ぶ
        */
        const all = [key, ...list];
        const owner =
          set.match === "single"
            ? (subs[0]?.id ?? null)
            : (all.map((c) => idOfCas.get(normalizeCas(c))).find(Boolean) ?? null);
        if (!owner) {
          outside += 1;
          continue;
        }
        for (const cas of all) {
          if (!CAS_SHAPE.test(cas)) {
            shape += 1;
            continue;
          }
          const casNormalized = normalizeCas(cas);
          const dedup = `${owner}/${casNormalized}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          data.push({ statutorySubstanceId: owner, casNumber: cas, casNormalized });
        }
      }
    }
    await put(
      `${set.law}/${set.category}/${set.cls}`,
      subs,
      data,
      (outside ? ` / この分類に無い号 ${outside}` : "") +
        (shape ? ` / CASの形でない ${shape}` : ""),
    );
  }

  // --- オゾン層保護法 -----------------------------------------------------------
  for (const o of OZONE) {
    const subs = await substancesOf("JP-OZONE", o.category, `P${o.paragraph}`);
    const idOfNumber = new Map(subs.map((s) => [s.officialNumber ?? "", s.id] as const));
    const idOfCas = new Map<string, string>();
    for (const s of subs) {
      const cas = casOfName.get(normName(s.nameJa ?? ""));
      if (cas) idOfCas.set(normalizeCas(cas), s.id);
    }
    /*
      LOLI は親をCASではなく英語名で持つことがある（`Dichlorotetrafluoroethane`）。
      物質マスタの英語名から CAS に直して当てる
    */
    const idOfEnName = new Map<string, string>();
    for (const [k, cas] of casOfEnName) {
      const id = idOfCas.get(normalizeCas(cas));
      if (id) idOfEnName.set(k, id);
    }

    const keys = readPairs(o.tsv);
    const names = readPairs(`${o.tsv}-name`);
    const seen = new Set<string>();
    const data: { statutorySubstanceId: string; casNumber: string; casNormalized: string }[] = [];
    let missed = 0;

    for (const [key, list] of keys) {
      /*
        LOLI は附属書CとFでは**法文の号番号**を名前の欄に持っている（`13` `Item 11`）。
        持っていないものは、法文の物質名を物質マスタの日本語名で CAS に直して当てる
      */
      const label = names.get(key)?.[0] ?? "";
      /*
        `11-1` のように枝番が付くことがある。法文でも号の下が
        `１ 二・二―ジクロロ…` `２ その他のもの` と分かれており、枝番はそこに当たる。
        枝番で当たらなければ、号のほうへ寄せる
      */
      const num = /^(?:Item\s*)?0*(\d+)(?:-0*(\d+))?$/i.exec(label);
      let owner: string | null = null;
      if (num) {
        const base = `令別表第${o.table}の${o.paragraph}の項(${num[1]})`;
        owner =
          (num[2] ? idOfNumber.get(`${base}の${num[2]}`) : null) ?? idOfNumber.get(base) ?? null;
      }
      if (!owner) {
        owner = [key, ...list].map((c) => idOfCas.get(normalizeCas(c))).find(Boolean) ?? null;
      }
      if (!owner) owner = idOfEnName.get(normName(label || key)) ?? null;
      // その項に物質が1つしかないときは号が無い。全部そこへ
      if (!owner && subs.length === 1) owner = subs[0].id;
      if (!owner) {
        missed += 1;
        continue;
      }
      for (const cas of [key, ...list]) {
        if (!CAS_SHAPE.test(cas)) continue;
        const casNormalized = normalizeCas(cas);
        const dedup = `${owner}/${casNormalized}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        data.push({ statutorySubstanceId: owner, casNumber: cas, casNormalized });
      }
    }
    await put(
      `JP-OZONE/${o.category}/第${o.paragraph}項`,
      subs,
      data,
      missed ? ` / 号が当たらない ${missed}` : "",
    );
  }

  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
