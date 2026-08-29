/**
 * 日本の法規制のうち、あとから足したものの規制区分・分類・法文物質名を入れる。
 * CASリンクは seed-jp-extra-links.ts。
 *
 *   node ... scripts/build-jp-extra-data.ts --write     法令の原文から作る
 *   node ... scripts/build-mhlw-data.ts --write         厚生労働省の一覧から作る
 *   node ... scripts/seed-jp-extra-laws.ts              下見
 *   node ... scripts/seed-jp-extra-laws.ts --write
 *
 * 対象
 *   安衛法：皮膚等障害化学物質等（3つの分類）
 *   安衛法：がん原性物質（作業記録30年保存）
 *   安衛法：鉛等・四アルキル鉛等（2つの分類）
 *   オゾン層保護法：特定物質・特定物質代替物質  ←  法令ごと新しく作る
 *
 * **名前は法令の言葉を使う。**外部データベース（LOLI・CHRIP）の物質名は使わない。
 *
 *   オゾン層保護法    e-Gov 施行令 別表第一・別表第二
 *   鉛則・四アルキル鉛則  e-Gov 第1条の定義
 *   皮膚等障害・がん原性物質  厚生労働省の一覧の「法令上の名称」の欄
 *
 * **分類（RegulationClass）を使う。**どれも法令としては1つの指定で、
 * その中が有害性の道筋や附属書のグループで分かれている。区分を分けてしまうと
 * 「皮膚等障害化学物質等に該当」という1つの事実が3つに割れて読みにくい。
 *
 * **鉛則・四アルキル鉛則は業務で決まる。**含んでいれば必ず義務がかかるわけではないので、
 * 区分の備考にその条件を書く。判定は「該当しうる」ことを伝えるためのもので、
 * どう動くかは中身を分かっている人が決める。
 *
 * **法令そのものはバージョンを持たない。**バージョンで分かれるのはCASリンクだけなので、
 * ここは1回入れれば足りる。入れ直すと同じ内容で上書きする。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DATA = join(process.cwd(), "scripts", "data");
const read = <T>(name: string): T => JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;

interface LawText {
  ozone: {
    specified: { number: string; group: string; items: OzoneItem[] }[];
    alternative: { number: string; group: string; items: OzoneItem[] }[];
  };
  lead: { number: string; term: string; meaning: string };
  tetraalkyl: { number: string; term: string; meaning: string };
}
interface OzoneItem {
  number: string;
  name: string;
  factor: string;
}
interface Mhlw {
  skin: {
    cas: string;
    name: string;
    irritation: boolean;
    absorption: boolean;
    special: boolean;
    cutoff: string;
    applied: string;
    note: string;
  }[];
  carcinogen: { cas: string; name: string; category: string; applied: string; note: string }[];
}

/** 入れる1件。分類の下にぶら下がる */
interface Entry {
  /** 法令上の番号。突き合わせにも使う */
  number: string;
  name: string;
  /** 裾切値（重量パーセント）。省くと0%超 */
  lower?: string;
  note?: string;
}

async function upsertLaw(
  code: string,
  create: { nameJa: string; nameEn: string; nameOriginal: string; displayOrder: number } | null,
  write: boolean,
) {
  const found = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  if (found) return found;
  if (!create) throw new Error(`法令 ${code} がありません`);
  if (!write) return null;
  const country = await prisma.country.findFirst({
    where: { codeNormalized: normalizeCode("JPN"), deletedAt: null },
    select: { id: true },
  });
  if (!country) throw new Error("国「JPN」がありません");
  return prisma.law.create({
    data: {
      code,
      codeNormalized: normalizeCode(code),
      countryId: country.id,
      nameOriginal: create.nameOriginal,
      nameLang: "JA",
      nameJa: create.nameJa,
      nameEn: create.nameEn,
      displayOrder: create.displayOrder,
    },
    select: { id: true },
  });
}

async function upsertCategory(
  lawId: string,
  code: string,
  payload: Record<string, unknown>,
): Promise<string> {
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
  return saved.id;
}

async function upsertClass(
  categoryId: string,
  code: string,
  nameJa: string,
  nameEn: string | null,
  order: number,
) {
  const payload = {
    // 名前が空なら画面に出さない（分けない区分の受け皿）
    nameOriginal: nameJa || null,
    nameLang: nameJa ? "JA" : null,
    nameJa: nameJa || null,
    nameEn,
    displayOrder: order,
  };
  const found = await prisma.regulationClass.findFirst({
    where: { categoryId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  if (found) {
    await prisma.regulationClass.update({ where: { id: found.id }, data: payload });
    return found.id;
  }
  const made = await prisma.regulationClass.create({
    data: { ...payload, code, codeNormalized: normalizeCode(code), categoryId },
    select: { id: true },
  });
  return made.id;
}

/** その分類の中身を入れ替える。番号が消えた行は残さない */
async function putEntries(classId: string, prefix: string, entries: Entry[]) {
  const keep = new Set(entries.map((e) => normalizeCode(`${prefix}-${e.number}`)));
  const old = await prisma.statutorySubstance.findMany({
    where: { classId },
    select: { id: true, codeNormalized: true },
  });
  const stale = old.filter((o) => !keep.has(o.codeNormalized)).map((o) => o.id);
  if (stale.length > 0) {
    const links = await prisma.statutoryCasLink.count({
      where: { statutorySubstanceId: { in: stale } },
    });
    if (links > 0) {
      throw new Error(`${prefix}: 消したい法文物質名に CASリンクが ${links} 件あります`);
    }
    await prisma.statutorySubstance.deleteMany({ where: { id: { in: stale } } });
  }

  for (const [i, e] of entries.entries()) {
    const code = `${prefix}-${e.number}`;
    const payload = {
      officialNumber: e.number,
      nameOriginal: e.name,
      nameLang: "JA",
      nameJa: e.name,
      nameEn: null,
      displayOrder: i + 1,
      aggregation: "NONE",
      metalEtc: null,
      thresholdLower: e.lower ?? "0",
      // 裾切値は「その値以上で対象」。0%（裾切値なし）のときだけ「超」
      lowerBound: e.lower ? "INCLUSIVE" : "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      note: e.note ?? null,
    };
    const found = await prisma.statutorySubstance.findFirst({
      where: { classId, codeNormalized: normalizeCode(code) },
      select: { id: true },
    });
    if (found) {
      await prisma.statutorySubstance.update({ where: { id: found.id }, data: payload as never });
    } else {
      await prisma.statutorySubstance.create({
        data: { ...payload, code, codeNormalized: normalizeCode(code), classId } as never,
      });
    }
  }
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const text = read<LawText>("jp-extra-lawtext.json");
  const mhlw = read<Mhlw>("jp-extra-mhlw.json");

  // --- 安衛法 -----------------------------------------------------------------
  const isha = await upsertLaw("JP-ISHA", null, write);

  /*
    皮膚等障害化学物質等。厚生労働省の一覧の印で3つに分かれる。
    **同じ物質が2つの分類に出る**（皮膚刺激性と皮膚吸収性の両方など）ので、印ごとに入れる
  */
  const skinClasses = [
    {
      code: "IRRITATION",
      nameJa: "皮膚刺激性有害物質",
      nameEn: "Skin irritants",
      pick: (r: Mhlw["skin"][number]) => r.irritation,
    },
    {
      code: "ABSORPTION",
      nameJa: "皮膚吸収性有害物質",
      nameEn: "Skin absorbable substances",
      pick: (r: Mhlw["skin"][number]) => r.absorption,
    },
    {
      code: "SPECIAL",
      nameJa: "特別規則に基づく使用義務物質",
      nameEn: "Substances under special ordinances",
      pick: (r: Mhlw["skin"][number]) => r.special,
    },
  ];

  let skinCategoryId: string | null = null;
  if (write && isha) {
    skinCategoryId = await upsertCategory(isha.id, "SKIN", {
      nameOriginal: "皮膚等障害化学物質等",
      nameLang: "JA",
      nameJa: "皮膚等障害化学物質等",
      nameEn: "Chemical substances causing skin damage",
      displayOrder: 100,
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      thresholdBasis: "PRODUCT",
      note: "安衛則第594条の2。取り扱う作業で不浸透性の保護具の使用が義務。義務がかかるのは業務であって、含有だけで直ちに義務が生じるわけではない。名前と裾切値は厚生労働省の一覧による",
    });
  }
  console.log("\n■ JP-ISHA 皮膚等障害化学物質等");
  for (const [i, c] of skinClasses.entries()) {
    const rows = mhlw.skin.filter(c.pick);
    const entries: Entry[] = rows.map((r) => ({
      number: r.cas,
      name: r.name,
      lower: r.cutoff || undefined,
      note:
        [r.applied ? `適用日: ${r.applied}` : null, r.note || null].filter(Boolean).join("／") ||
        undefined,
    }));
    if (write && skinCategoryId) {
      const classId = await upsertClass(skinCategoryId, c.code, c.nameJa, c.nameEn, (i + 1) * 10);
      await putEntries(classId, `JP-ISHA-SKIN-${c.code}`, entries);
    }
    console.log(`  ${c.nameJa.padEnd(18)}${String(entries.length).padStart(5)} 件`);
  }

  // がん原性物質
  let carcCategoryId: string | null = null;
  if (write && isha) {
    carcCategoryId = await upsertCategory(isha.id, "CARC30", {
      nameOriginal: "がん原性物質",
      nameLang: "JA",
      nameJa: "がん原性物質（作業記録30年保存）",
      nameEn: "Carcinogens subject to 30-year record keeping",
      displayOrder: 110,
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      thresholdBasis: "PRODUCT",
      note: "安衛則第577条の2。取り扱う作業の記録を30年間保存する義務。名前は厚生労働省の一覧による",
    });
  }
  const carcEntries: Entry[] = mhlw.carcinogen.map((r) => ({
    number: r.cas,
    name: r.name,
    note:
      [r.category || null, r.applied ? `適用: ${r.applied}` : null, r.note || null]
        .filter(Boolean)
        .join("／") || undefined,
  }));
  if (write && carcCategoryId) {
    const classId = await upsertClass(carcCategoryId, "DEFAULT", "", null, 10);
    await putEntries(classId, "JP-ISHA-CARC30", carcEntries);
  }
  console.log(`\n■ JP-ISHA がん原性物質（30年保存）  ${carcEntries.length} 件`);

  // 鉛等・四アルキル鉛等。法文が定義する用語をそのまま1件ずつ入れる
  let leadCategoryId: string | null = null;
  if (write && isha) {
    leadCategoryId = await upsertCategory(isha.id, "LEAD", {
      nameOriginal: "鉛等・四アルキル鉛等",
      nameLang: "JA",
      nameJa: "鉛等・四アルキル鉛等",
      nameEn: "Lead and tetraalkyl lead",
      displayOrder: 120,
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      thresholdBasis: "PRODUCT",
      note: "鉛中毒予防規則・四アルキル鉛中毒予防規則。義務がかかるのは鉛業務・四アルキル鉛等業務にあたるときで、含有だけで直ちに義務が生じるわけではない",
    });
  }
  console.log("\n■ JP-ISHA 鉛等・四アルキル鉛等");
  for (const [i, d] of [text.lead, text.tetraalkyl].entries()) {
    const code = i === 0 ? "LEAD" : "TETRAALKYL";
    if (write && leadCategoryId) {
      const classId = await upsertClass(leadCategoryId, code, d.term, null, (i + 1) * 10);
      await putEntries(classId, `JP-ISHA-LEAD-${code}`, [
        { number: d.number, name: d.term, note: d.meaning },
      ]);
    }
    console.log(`  ${d.number}  ${d.term}`);
  }

  // --- オゾン層保護法 -----------------------------------------------------------
  const ozone = await upsertLaw(
    "JP-OZONE",
    {
      nameJa: "オゾン層保護法",
      nameEn:
        "Act on the Protection of the Ozone Layer through the Control of Specified Substances",
      nameOriginal: "特定物質等の規制等によるオゾン層の保護に関する法律",
      // 化学兵器禁止法（80）の次
      displayOrder: 90,
    },
    write,
  );
  console.log("\n■ JP-OZONE オゾン層保護法");

  const tables = [
    {
      code: "SPECIFIED",
      nameJa: "特定物質",
      nameEn: "Specified substances",
      table: "1",
      note: "オゾン層保護法施行令 別表第一。規制の本体は製造・輸入の数量規制で、含有率の裾切値は置かれていない。SDSの第15項に書く対象",
      paragraphs: text.ozone.specified,
      factorLabel: "オゾン破壊係数",
    },
    {
      code: "ALTERNATIVE",
      nameJa: "特定物質代替物質",
      nameEn: "Alternative substances",
      table: "2",
      note: "オゾン層保護法施行令 別表第二。議定書附属書Fの物質で、法令では特定物質とは別に扱う",
      paragraphs: text.ozone.alternative,
      factorLabel: "地球温暖化係数",
    },
  ];

  for (const [ti, t] of tables.entries()) {
    let categoryId: string | null = null;
    if (write && ozone) {
      categoryId = await upsertCategory(ozone.id, t.code, {
        nameOriginal: t.nameJa,
        nameLang: "JA",
        nameJa: t.nameJa,
        nameEn: t.nameEn,
        displayOrder: (ti + 1) * 10,
        thresholdLower: "0",
        lowerBound: "EXCLUSIVE",
        thresholdUpper: "100",
        upperBound: "INCLUSIVE",
        thresholdBasis: "PRODUCT",
        note: t.note,
      });
    }
    console.log(`  ${t.nameJa}`);
    for (const [pi, p] of t.paragraphs.entries()) {
      const entries: Entry[] = p.items.map((it) => ({
        /*
          番号は法文の書き方に合わせる。`令別表第1の1の項(1)`。
          その項に物質が1つしかないときは号が無いので、項までで止める
        */
        number: it.number
          ? `令別表第${t.table}の${p.number}の項(${it.number})`
          : `令別表第${t.table}の${p.number}の項`,
        name: it.name,
        note: it.factor ? `${t.factorLabel}：${it.factor}` : undefined,
      }));
      if (write && categoryId) {
        const classId = await upsertClass(categoryId, `P${p.number}`, p.group, null, (pi + 1) * 10);
        await putEntries(classId, `JP-OZONE-${t.code}-P${p.number}`, entries);
      }
      console.log(`    ${p.number} ${p.group.padEnd(24)}${String(entries.length).padStart(4)} 件`);
    }
  }

  // 使わないが、CAS の形をここで確かめておく（番号にCASを使う分類があるため）
  for (const r of [...mhlw.skin, ...mhlw.carcinogen]) {
    if (normalizeCas(r.cas) === "") throw new Error(`CASの形が読めません: ${r.cas}`);
  }

  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
