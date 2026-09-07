/**
 * IARC 発がん性分類の規制区分・法文物質名を入れる。CASリンクは seed-iarc-links.ts。
 *
 *   bash scripts/loli-dump-iarc.sh                                    版ごとに先に取り出す
 *   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-iarc.sh
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-laws.ts
 *   ... scripts/seed-iarc-laws.ts --write
 *
 * **法令そのものは seed-international.ts が既に作っている（INT-IARC）。**ここは触らない。
 *
 * **区分は評価のグループ**（1・2A・2B・3）。IARC は法律ではなく発がん性の評価なので、
 * 閾値は無く「含まれていれば該当」。グループ4は 2019 年に廃止されたので作らない。
 * **判定には使わない設定（judged=false）で入れる。**含有率で該非が決まらない一覧を
 * そのまま判定に出すと、ほとんどの製品に「該当」が並んで本当に効く規制が埋もれる
 * （マニュアル「判定に使わない区分」の決まり。大防法の有害大気汚染物質と同じ扱い）。
 * 法律の画面と物質の画面では見える。判定に出したければ区分の編集で印を付ければよい。
 *
 * **法文物質名は評価対象ごとに作る。**LOLI は「クロム(VI)化合物」のような評価対象から
 * 個々の化合物へ広げているので、広げたぶんはCASリンク、評価対象を1件として持つ。
 * IARC がくくり（「Aflatoxins」など）として評価したものは、くくりが評価対象で、
 * 中の個々の物質はCASリンク（取り出しの `LU|` の鍵）。
 * 取り出したどの版にも出てくる評価対象を合わせて作る（版によって顔ぶれが違う）。
 *
 * **番号はモノグラフの巻**（いちばん新しい評価のもの。`100F` / `Suppl. 7`）。
 * 評価対象の名前と1対1にはならない（同じ巻に多くの評価対象が載る）が、
 * 番号は区分の中で一意でなくてよい（2026-09-07 決定）。全部の巻と年は備考へ。
 * 取り出したファイルに無くなった法文物質名は消す（作り直しで顔ぶれが変わるため）。
 *
 * **CAS が物質マスタに1つも無い親は作らない。**判定に使えるものに限る指示による
 * （2026-09-07）。作らなかった親の数は下見で出す。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LAW = "INT-IARC";
const DATA_DIR = join(process.cwd(), "scripts/data");
/** `1333-86-4` の形。これ以外（RR-… など）は LOLI の内部コード */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

interface GroupDef {
  /** scripts/data/iarc-<tsv>-<版>*.tsv を読む */
  tsv: string;
  code: string;
  nameJa: string;
  nameEn: string;
  note: string;
}

/*
  区分の日本語名。公的な訳（農林水産省「IARC発がん性分類」の表）は
    グループ1 ヒトに対して発がん性がある / 2A ヒトに対しておそらく発がん性がある /
    2B ヒトに対して発がん性がある可能性がある / 3 ヒトに対する発がん性について分類できない
  だが、区分名としては長すぎて画面で読みにくいので（2026-09-07 指摘）、
  「ヒトに対して」を落とした短い形にし、公的な訳と英語は区分の備考に残す
*/
export const GROUPS: GroupDef[] = [
  {
    tsv: "g1",
    code: "G1",
    nameJa: "グループ1　発がん性がある",
    nameEn: "Group 1 (Carcinogenic to humans)",
    note: "IARC グループ1「ヒトに対して発がん性がある（Carcinogenic to humans）」。IARC の評価であって法律の規制ではないので、判定には使わない（物質の画面で載っているかを見る）。含有率の閾値は無く、含まれていれば該当。番号は IARC モノグラフの巻（いちばん新しい評価のもの）で、同じ巻に多くの評価対象が載るので一意ではない。全部の巻と年は法文物質名の備考",
  },
  {
    tsv: "g2a",
    code: "G2A",
    nameJa: "グループ2A　おそらく発がん性がある",
    nameEn: "Group 2A (Probably carcinogenic to humans)",
    note: "IARC グループ2A「ヒトに対しておそらく発がん性がある（Probably carcinogenic to humans）」。IARC の評価であって法律の規制ではないので、判定には使わない（物質の画面で載っているかを見る）。含有率の閾値は無く、含まれていれば該当。番号は IARC モノグラフの巻（いちばん新しい評価のもの）で、同じ巻に多くの評価対象が載るので一意ではない。全部の巻と年は法文物質名の備考",
  },
  {
    tsv: "g2b",
    code: "G2B",
    nameJa: "グループ2B　発がん性の可能性がある",
    nameEn: "Group 2B (Possibly carcinogenic to humans)",
    note: "IARC グループ2B「ヒトに対して発がん性がある可能性がある（Possibly carcinogenic to humans）」。IARC の評価であって法律の規制ではないので、判定には使わない（物質の画面で載っているかを見る）。含有率の閾値は無く、含まれていれば該当。番号は IARC モノグラフの巻（いちばん新しい評価のもの）で、同じ巻に多くの評価対象が載るので一意ではない。全部の巻と年は法文物質名の備考",
  },
  {
    tsv: "g3",
    code: "G3",
    nameJa: "グループ3　発がん性を分類できない",
    nameEn: "Group 3 (Not classifiable as to its carcinogenicity to humans)",
    note: "IARC グループ3「ヒトに対する発がん性について分類できない（Not classifiable as to its carcinogenicity to humans）」。IARC の評価であって法律の規制ではないので、判定には使わない（物質の画面で載っているかを見る）。発がん性が否定されたわけではなく、証拠が足りないもの。含有率の閾値は無く、含まれていれば該当。番号は IARC モノグラフの巻（いちばん新しい評価のもの）で、同じ巻に多くの評価対象が載るので一意ではない。全部の巻と年は法文物質名の備考",
  },
];

/** 取り出してある版（`iarc-g1-2026Q3.tsv` の 2026Q3 の部分）を全部集める */
export function dumpedVersions(): string[] {
  const set = new Set<string>();
  for (const f of readdirSync(DATA_DIR)) {
    const m = /^iarc-g1-(\d{4}Q\d)\.tsv$/.exec(f);
    if (m?.[1]) set.add(m[1]);
  }
  return [...set].sort();
}

/** 鍵と値の並びに読む。無いファイルは空として扱う */
export function readPairs(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, `${file}.tsv`), "utf-8");
  } catch {
    return map;
  }
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

/**
 * 法文物質名のコード。リンク側もこれで引く（番号は鍵にしない）。
 * くくりの鍵（`LU|Aflatoxins`）は名前が長くコードに収まらないので、名前の指紋で置き換える
 */
export function substanceCode(category: string, key: string): string {
  const short = key.startsWith("LU|")
    ? `LU-${createHash("sha1").update(key.slice(3)).digest("hex").slice(0, 10)}`
    : key;
  return `${LAW}-${category}-${short}`;
}

/**
 * 英語名の突き合わせ用に整える。LOLI は `Chromium(VI) compounds`、Wikipedia は
 * `Chromium[VI] compounds` のように括弧が違うので、角括弧を丸括弧に寄せ、大小と空白をならす
 */
function nameKey(en: string): string {
  return en
    .toLowerCase()
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/[.,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 評価対象の日本語名。日本語版 Wikipedia「IARC発がん性リスク一覧」から作った対応表
 * （scripts/data/iarc-names-ja.tsv、英語名 → 日本語名）。IARC の評価対象の単位で
 * 付いているので、くくり（「ヒ素およびヒ素化合物」など）にも名前が付く
 */
function readNamesJa(): Map<string, string> {
  const map = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, "iarc-names-ja.tsv"), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [en, ja] = row.split("\t");
    if (en && ja && !map.has(nameKey(en))) map.set(nameKey(en), ja);
  }
  return map;
}

/**
 * 物質マスタの日本語名（CAS → 代表物質の日本語名）。単体の評価対象で Wikipedia に無いときの補い。
 * 名前が CAS 番号のままの仮の行（`100-00-5`）は使わない
 */
async function masterNamesJa(): Promise<Map<string, string>> {
  const rows = await prisma.substance.findMany({
    where: { deletedAt: null, isCasRepresentative: true, casNormalized: { not: null } },
    select: { casNormalized: true, nameJa: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.casNormalized && r.nameJa && r.nameJa !== r.casNormalized)
      map.set(r.casNormalized, r.nameJa);
  }
  return map;
}

/** 物質マスタに載っている CAS（正規化済み）。これに無い CAS は結ばない */
export async function masterCasSet(): Promise<Set<string>> {
  const rows = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { not: null } },
    select: { casNormalized: true },
  });
  return new Set(rows.map((r) => r.casNormalized ?? "").filter(Boolean));
}

/** 区分と、その下の名前のない受け皿を作る */
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

/** CASは数の順、LOLI の内部コードは後ろにまとめる */
function orderOf(key: string): string {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(key);
  if (!m) return `z${key}`;
  return `a${m[1].padStart(9, "0")}-${m[2]}-${m[3]}`;
}

const yearOf = (v: string) => Number(/\[(\d{4})\]/.exec(v)?.[1] ?? 0);

/** `Monograph 100C [2012]` → 新しい年が先に並べる */
function sortedMonographs(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => yearOf(b) - yearOf(a) || a.localeCompare(b));
}

/** 備考。全部の巻と年 */
function monographNote(values: string[]): string | null {
  const sorted = sortedMonographs(values);
  return sorted.length === 0 ? null : `IARC モノグラフ: ${sorted.join("; ")}`;
}

/** 番号。いちばん新しい評価の巻だけ（`Monograph 100F [2012]` → `100F`、`Supplement 7 [1987]` → `Suppl. 7`） */
function volumeNumber(values: string[]): string | null {
  const latest = sortedMonographs(values)[0];
  if (!latest) return null;
  const m = /^(Monograph|Supplement)\s+(\S+)/.exec(latest);
  if (!m) return latest.replace(/\s*\[\d{4}\]$/, "");
  return m[1] === "Supplement" ? `Suppl. ${m[2]}` : m[2];
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const versions = dumpedVersions();
  if (versions.length === 0)
    throw new Error("取り出したファイルがありません（先に loli-dump-iarc.sh）");
  console.log(`  取り出してある版: ${versions.join(" / ")}`);

  const law = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(LAW), deletedAt: null },
    select: { id: true },
  });
  if (!law) throw new Error(`法令 ${LAW} がありません（先に seed-international.ts）`);

  const master = await masterCasSet();
  console.log(`  物質マスタの CAS: ${master.size} 件`);
  const namesJa = readNamesJa();
  const masterJa = await masterNamesJa();
  console.log(
    `  日本語名の対応表: ${namesJa.size} 件（Wikipedia）/ 物質マスタの日本語名: ${masterJa.size} 件`,
  );

  for (const [ci, g] of GROUPS.entries()) {
    // 版をまたいで親を集める。名前は新しい版のものを優先する
    const keys = new Map<string, Set<string>>();
    const names = new Map<string, string>();
    const monos = new Map<string, Set<string>>();
    for (const ver of [...versions].reverse()) {
      for (const [k, cases] of readPairs(`iarc-${g.tsv}-${ver}`)) {
        const got = keys.get(k) ?? new Set<string>();
        for (const c of cases) got.add(c);
        keys.set(k, got);
      }
      for (const [k, nm] of readPairs(`iarc-${g.tsv}-${ver}-name`)) {
        if (!names.has(k) && nm[0]) names.set(k, nm[0]);
      }
      for (const [k, vs] of readPairs(`iarc-${g.tsv}-${ver}-mono`)) {
        const got = monos.get(k) ?? new Set<string>();
        for (const v of vs) got.add(v);
        monos.set(k, got);
      }
    }

    // 物質マスタにある CAS を1つでも持つ親だけ
    const inMaster = (k: string) =>
      [...(keys.get(k) ?? [])].some((c) => CAS_SHAPE.test(c) && master.has(normalizeCas(c)));
    const all = [...keys.keys()];
    const mine = all.filter(inMaster).sort((a, b) => orderOf(a).localeCompare(orderOf(b)));
    const dropped = all.length - mine.length;

    let classId: string | null = null;
    if (write) {
      classId = await upsertCategory(law.id, g.code, {
        nameOriginal: g.nameEn,
        // IARC の正文は英語
        nameLang: "EN",
        nameJa: g.nameJa,
        nameEn: g.nameEn,
        displayOrder: (ci + 1) * 10,
        // 区分の閾値は法文物質名を作るときのひな型。含まれていれば該当
        thresholdLower: "0",
        lowerBound: "EXCLUSIVE",
        thresholdUpper: "100",
        upperBound: "INCLUSIVE",
        thresholdBasis: "PRODUCT",
        // 評価であって規制ではないので、判定には使わない（法律・物質の画面では見える）
        judged: false,
        note: g.note,
      });
    }

    const codes = new Set(mine.map((key) => normalizeCode(substanceCode(g.code, key))));
    let casCount = 0;
    let jaWiki = 0;
    let jaMaster = 0;
    for (const [i, key] of mine.entries()) {
      casCount += [...(keys.get(key) ?? [])].filter(
        (c) => CAS_SHAPE.test(c) && master.has(normalizeCas(c)),
      ).length;
      const nameEn = names.get(key) ?? key;
      // 日本語名。Wikipedia の対応表が第一、単体は物質マスタの日本語名で補う
      let nameJa: string | null = namesJa.get(nameKey(nameEn)) ?? null;
      if (nameJa) jaWiki += 1;
      else if (CAS_SHAPE.test(key) && masterJa.has(normalizeCas(key))) {
        nameJa = masterJa.get(normalizeCas(key)) ?? null;
        jaMaster += 1;
      }
      if (!write || !classId) continue;
      await upsertSubstance(classId, substanceCode(g.code, key), {
        officialNumber: volumeNumber([...(monos.get(key) ?? [])]),
        nameOriginal: nameEn,
        nameLang: "EN",
        nameJa,
        nameEn,
        displayOrder: i + 1,
        aggregation: "NONE",
        metalEtc: null,
        thresholdLower: "0",
        lowerBound: "EXCLUSIVE",
        thresholdUpper: "100",
        upperBound: "INCLUSIVE",
        note: monographNote([...(monos.get(key) ?? [])]),
      });
    }
    // 今回作らなかった法文物質名（前の作りかたの残り）は、リンクごと消す
    let removed = 0;
    if (write && classId) {
      const stale = await prisma.statutorySubstance.findMany({
        where: { classId, codeNormalized: { notIn: [...codes] } },
        select: { id: true },
      });
      if (stale.length > 0) {
        const ids = stale.map((s) => s.id);
        await prisma.statutoryCasLink.deleteMany({ where: { statutorySubstanceId: { in: ids } } });
        await prisma.statutorySubstance.deleteMany({ where: { id: { in: ids } } });
        removed = ids.length;
      }
    }
    console.log(
      `  ${g.code.padEnd(4)}${g.nameJa.padEnd(28)}法文物質名 ${String(mine.length).padStart(4)} 件 / マスタにある CAS ${String(casCount).padStart(5)} 件` +
        (dropped ? ` / マスタに CAS が無く作らない評価対象 ${dropped} 件` : "") +
        (removed ? ` / 前の残りを消した ${removed} 件` : "") +
        ` / 日本語名 Wikipedia ${jaWiki} 件・マスタ ${jaMaster} 件・無し ${mine.length - jaWiki - jaMaster} 件`,
    );
  }
  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

// seed-iarc-links.ts がここの関数を借りるので、直接呼ばれたときだけ動く
if (process.argv[1] && basename(process.argv[1]) === "seed-iarc-laws.ts") {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
