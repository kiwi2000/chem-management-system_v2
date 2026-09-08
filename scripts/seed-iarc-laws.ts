/**
 * IARC 発がん性分類の規制区分・法文物質名を入れる。CASリンクは seed-iarc-links.ts（LOLI）と
 * seed-iarc-chrip-links.ts（CHRIP）。
 *
 *   curl -sL -A Mozilla/5.0 https://webapi.iarc.who.int/loc/loc.app.js -o .cache/loc.app.js
 *   python scripts/build-iarc-official.py                              正式な一覧を取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-laws.ts
 *   ... scripts/seed-iarc-laws.ts --write
 *   ... scripts/seed-iarc-laws.ts --write --prune     リンクを入れ直したあと、外部DBの名前の残りを消す
 *
 * **法令そのものは seed-international.ts が既に作っている（INT-IARC）。**ここは触らない。
 *
 * **区分は評価のグループ**（1・2A・2B・3）。IARC は法律ではなく発がん性の評価なので、
 * 閾値は無く「含まれていれば該当」。グループ4は 2019 年に廃止されたので作らない。
 * **判定には使わない設定（judged=false）で入れる。**含有率で該非が決まらない一覧を
 * そのまま判定に出すと、ほとんどの製品に「該当」が並んで本当に効く規制が埋もれる
 * （マニュアル「判定に使わない区分」の決まり。大防法の有害大気汚染物質と同じ扱い）。
 *
 * **法文物質名は IARC の正式な一覧（List of Classifications）の評価対象そのもの**（2026-09-08 決定。
 * それまでは LOLI や CHRIP の書きかたで作っていて、同じ評価対象が綴り違いで分かれた）。
 * 1,060 件を全部作る。CAS の無い評価対象（職業ばく露・放射線など）も名前は持つが、
 * CAS リンクが付かないので判定には出ない。
 *
 * **番号はモノグラフの巻**（いちばん新しい評価のもの。`100F` / `Suppl. 7`）。
 * 同じ巻に多くの評価対象が載るので一意ではない（番号は区分の中で一意でなくてよい・2026-09-07 決定）。
 * 全部の巻と評価年・公表年は備考へ。
 *
 * **日本語名**は、日本語版 Wikipedia の一覧から作った対応表で当て、単体で当たらなければ
 * 物質マスタの代表物質の日本語名で補う。どちらにも無ければ英語のまま。
 *
 * **`--prune`**: 外部データベースの書きかたで作った法文物質名（LOLI 由来・CHRIP 由来）のうち、
 * リンクが1つも残っていないものを消す。リンクの取り込みを先に流し直してから使う。
 */
import { basename } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import {
  CAS_SHAPE,
  CATEGORY_OF_GROUP,
  IARC_LAW,
  latestVolume,
  nameKey,
  officialCode,
  officialNote,
  readNamesJa,
  readOfficial,
} from "./lib/iarc-official";

const prisma = new PrismaClient();

interface GroupDef {
  /** 正式一覧・CHRIP のグループの書きかた */
  group: string;
  code: string;
  nameJa: string;
  nameEn: string;
  note: string;
}

const COMMON_NOTE =
  "IARC の評価であって法律の規制ではないので、判定には使わない（物質の画面で載っているかを見る）。含有率の閾値は無く、含まれていれば該当。法文物質名は IARC の正式な一覧（List of Classifications）の評価対象。番号は IARC モノグラフの巻（いちばん新しい評価のもの）で、同じ巻に多くの評価対象が載るので一意ではない。全部の巻と年は法文物質名の備考";

/*
  区分の日本語名。公的な訳（農林水産省「IARC発がん性分類」の表）は
    グループ1 ヒトに対して発がん性がある / 2A ヒトに対しておそらく発がん性がある /
    2B ヒトに対して発がん性がある可能性がある / 3 ヒトに対する発がん性について分類できない
  だが、区分名としては長すぎて画面で読みにくいので（2026-09-07 指摘）、
  「ヒトに対して」を落とした短い形にし、公的な訳と英語は区分の備考に残す
*/
export const GROUPS: GroupDef[] = [
  {
    group: "1",
    code: "G1",
    nameJa: "グループ1　発がん性がある",
    nameEn: "Group 1 (Carcinogenic to humans)",
    note: `IARC グループ1「ヒトに対して発がん性がある（Carcinogenic to humans）」。${COMMON_NOTE}`,
  },
  {
    group: "2A",
    code: "G2A",
    nameJa: "グループ2A　おそらく発がん性がある",
    nameEn: "Group 2A (Probably carcinogenic to humans)",
    note: `IARC グループ2A「ヒトに対しておそらく発がん性がある（Probably carcinogenic to humans）」。${COMMON_NOTE}`,
  },
  {
    group: "2B",
    code: "G2B",
    nameJa: "グループ2B　発がん性の可能性がある",
    nameEn: "Group 2B (Possibly carcinogenic to humans)",
    note: `IARC グループ2B「ヒトに対して発がん性がある可能性がある（Possibly carcinogenic to humans）」。${COMMON_NOTE}`,
  },
  {
    group: "3",
    code: "G3",
    nameJa: "グループ3　発がん性を分類できない",
    nameEn: "Group 3 (Not classifiable as to its carcinogenicity to humans)",
    note: `IARC グループ3「ヒトに対する発がん性について分類できない（Not classifiable as to its carcinogenicity to humans）」。発がん性が否定されたわけではなく、証拠が足りないもの。${COMMON_NOTE}`,
  },
];

/** 物質マスタに載っている CAS（正規化済み）。これに無い CAS は結ばない */
export async function masterCasSet(): Promise<Set<string>> {
  const rows = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { not: null } },
    select: { casNormalized: true },
  });
  return new Set(rows.map((r) => r.casNormalized ?? "").filter(Boolean));
}

/**
 * 物質マスタの日本語名（CAS → 代表物質の日本語名）。単体の評価対象で Wikipedia に無いときの補い。
 * 名前が CAS 番号のままの仮の行（`100-00-5`）は使わない
 */
export async function masterNamesJa(): Promise<Map<string, string>> {
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

async function main() {
  const write = process.argv.includes("--write");
  const prune = process.argv.includes("--prune");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const law = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(IARC_LAW), deletedAt: null },
    select: { id: true },
  });
  if (!law) throw new Error(`法令 ${IARC_LAW} がありません（先に seed-international.ts）`);

  const official = readOfficial();
  const namesJa = readNamesJa();
  const masterJa = await masterNamesJa();
  console.log(
    `  正式一覧の評価対象: ${official.length} 件 / 日本語名の対応表: ${namesJa.size} 件（Wikipedia）/ 物質マスタの日本語名: ${masterJa.size} 件`,
  );

  for (const [ci, g] of GROUPS.entries()) {
    const agents = official
      .filter((a) => a.group === g.group)
      .sort((a, b) => a.name.localeCompare(b.name, "en"));

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

    let jaWiki = 0;
    let jaMaster = 0;
    let noCas = 0;
    for (const [i, a] of agents.entries()) {
      if (a.cas.length === 0) noCas += 1;
      // 日本語名。Wikipedia の対応表が第一、単体は物質マスタの日本語名で補う
      let nameJa: string | null = namesJa.get(nameKey(a.name)) ?? null;
      if (nameJa) jaWiki += 1;
      else {
        // 物質マスタの名前で補うのは単体の物質だけ。「Arsenic and inorganic arsenic compounds」のような
        // くくりに、その代表 CAS の物質名（「砒素」）を付けてしまわないように
        const looksLikeGroup = /(^|\s)(compounds?|and|salts?|mixtures?)(\s|$)|,/i.test(a.name);
        const single =
          !looksLikeGroup && a.cas.length === 1 && a.cas[0] && CAS_SHAPE.test(a.cas[0])
            ? a.cas[0]
            : null;
        if (single && masterJa.has(normalizeCas(single))) {
          nameJa = masterJa.get(normalizeCas(single)) ?? null;
          jaMaster += 1;
        }
      }
      if (!write || !classId) continue;
      await upsertSubstance(classId, officialCode(g.code, a.name), {
        officialNumber: latestVolume(a.volumes),
        nameOriginal: a.name,
        nameLang: "EN",
        nameJa,
        nameEn: a.name,
        displayOrder: i + 1,
        aggregation: "NONE",
        metalEtc: null,
        thresholdLower: "0",
        lowerBound: "EXCLUSIVE",
        thresholdUpper: "100",
        upperBound: "INCLUSIVE",
        note: officialNote(a),
      });
    }

    // 外部データベースの書きかたで作った名前（正式一覧に当たらなかったもの）の残り。リンクが無ければ消す
    let pruned = 0;
    if (write && prune && classId) {
      const leftovers = await prisma.statutorySubstance.findMany({
        where: { classId, NOT: { codeNormalized: { contains: "-OF-" } }, links: { none: {} } },
        select: { id: true },
      });
      if (leftovers.length > 0) {
        await prisma.statutorySubstance.deleteMany({
          where: { id: { in: leftovers.map((s) => s.id) } },
        });
        pruned = leftovers.length;
      }
    }
    const kept = write
      ? await prisma.statutorySubstance.count({
          where: {
            regulationClass: { category: { lawId: law.id, codeNormalized: normalizeCode(g.code) } },
            NOT: { codeNormalized: { contains: "-OF-" } },
          },
        })
      : null;
    console.log(
      `  ${g.code.padEnd(4)}${g.nameJa.padEnd(28)}評価対象 ${String(agents.length).padStart(4)} 件（CAS 無し ${noCas}）` +
        ` / 日本語名 Wikipedia ${jaWiki}・マスタ ${jaMaster}・無し ${agents.length - jaWiki - jaMaster}` +
        (pruned ? ` / 外部DBの名前の残りを消した ${pruned} 件` : "") +
        (kept !== null ? ` / 外部DBの名前でまだ残るもの ${kept} 件` : ""),
    );
  }
  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

// 取り込みのスクリプトがここの関数を借りるので、直接呼ばれたときだけ動く
if (process.argv[1] && basename(process.argv[1]) === "seed-iarc-laws.ts") {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

export { CATEGORY_OF_GROUP };
