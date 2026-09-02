/**
 * CHRIP から切り出した2つを規制区分として入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-chrip-extra-data.ts --write     先にデータを作る
 *   ... scripts/seed-chrip-extra.ts [--write]
 *
 * ## 1. 安衛法の、まだ施行されていない追加
 *
 * 安衛則別表第2 には、これから加わる物質がある（令和9年4月1日・令和10年4月1日）。
 * e-Gov は現行の条文しか返さないので、こちらの表示・通知対象には入っていない。
 *
 * **施行日で自動的に切り替える作りにはしない。**製品の開発は施行の前から始まるので、
 * 「いつ効くようになるか」を先に知りたいという要りようがある。
 * そこで**施行日ごとに別の規制区分**を作り、名前に施行日を入れる。
 * 施行されたら、その区分の中身を本体（表示対象物質・通知対象物質）へ移してこの区分を消す。
 *
 * ## 2. 大気汚染防止法の揮発性有機化合物（VOC）
 *
 * 法第2条第4項は**物質を名指しせず、定義だけを置く**（「大気中に排出され、又は飛散した
 * 時に気体である有機化合物」）。CHRIP はこの定義に当たる物質を挙げているので、
 * **法文物質名にはその物質自身の名前**を入れ、番号にはCAS番号を入れる。
 * 皮膚等障害化学物質等・がん原性物質と同じやりかた。
 *
 * 令第2条の2が**定義から除く物質**（メタン・HCFC類など8件）は別の区分にする。
 * こちらは政令の号があるので、番号は政令番号を使う。
 *
 * 何度流しても同じ結果になる（足すか書き換えるだけ。消さない）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "CHRIP";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;
/** CAS番号を持たない物質の鍵。物質マスタでは、この文字列が CAS番号の欄に入っている */
const OWN_PREFIX = "CHRIP-";

interface Pending {
  from: string;
  number: string;
  name: string;
  label: string;
  sds: string;
  cas: string[];
}
interface Voc {
  /** 条文の項番号 */
  number: string;
  /** 条文の定義文。これが法文物質名になる */
  name: string;
  cas: string[];
}
interface Excluded {
  number: string;
  name: string;
  cas: string;
}

/** 施行日 → 区分の名前に入れる元号。**画面に出る文字なので、条文と同じ書き方にする** */
const ERA_NAME: Record<string, string> = {
  "2027-04-01": "令和9年4月1日施行",
  "2028-04-01": "令和10年4月1日施行",
};

/** 未施行の区分。施行日ごとに、表示対象と通知対象の2つを作る */
const PENDING_CATS: { code: string; base: string; use: "label" | "sds"; order: number }[] = [
  { code: "LABEL", base: "表示対象物質", use: "label", order: 100 },
  { code: "SDS", base: "通知対象物質", use: "sds", order: 110 },
];

const PENDING_NOTE =
  "安衛則別表第2 に加わることが決まっている物質。**この日までは効力がない。**" +
  "製品の開発は施行の前から始まるため、先に把握できるよう別の区分として持っている。" +
  "施行されたら本体の区分へまとめ、この区分は消す。出どころは CHRIP（NITE）の適用日";

const VOC_CONDITION =
  "大気汚染防止法 第2条第4項の定義（大気中に排出され、又は飛散した時に気体である有機化合物）に" +
  "当たる物質。**法令が物質を名指しした一覧ではない。**排出の規制は施設の種類と排出量で決まるため、" +
  "含有しているだけで規制がかかるわけではない";

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

  const data = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/chrip-extra.json"), "utf-8"),
  ) as { pending: Pending[]; voc: Voc; excluded: Excluded[] };

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");
  const source = await prisma.source.findFirst({
    where: { codeNormalized: normalizeCode(SOURCE_CODE), deletedAt: null },
    select: { id: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);

  // CASリンクは物質マスタにある番号にだけ張れる
  const master = await prisma.substance.findMany({ select: { casNumber: true } });
  const known = new Set(master.map((s) => s.casNumber).filter((c): c is string => !!c));

  async function link(substanceId: string, cas: string[]): Promise<number> {
    const usable = [
      ...new Set(
        cas.filter((c) => (CAS_SHAPE.test(c) || c.startsWith(OWN_PREFIX)) && known.has(c)),
      ),
    ];
    if (!write || !usable.length) return usable.length;
    await prisma.statutoryCasLink.deleteMany({
      where: { versionId: version!.id, sourceId: source!.id, statutorySubstanceId: substanceId },
    });
    const made = await prisma.statutoryCasLink.createMany({
      data: usable.map((c) => ({
        statutorySubstanceId: substanceId,
        casNumber: c,
        casNormalized: normalizeCas(c),
        versionId: version!.id,
        sourceId: source!.id,
      })),
      skipDuplicates: true,
    });
    return made.count;
  }

  // ── 1. 安衛法の未施行 ────────────────────────────────────────
  const isha = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode("JP-ISHA"), deletedAt: null },
    select: { id: true },
  });
  if (!isha) throw new Error("安衛法がありません");

  const eras = [...new Set(data.pending.map((p) => p.from))].sort();
  for (const [ei, from] of eras.entries()) {
    const era = ERA_NAME[from];
    if (!era) throw new Error(`施行日の書き方が分かりません: ${from}`);
    const mine = data.pending.filter((p) => p.from === from);

    for (const cat of PENDING_CATS) {
      const code = `${cat.code}_${from.slice(0, 4)}`;
      const name = `${cat.base}（${era}）`;
      let classId: string | null = null;
      if (write) {
        classId = await upsertCategory(isha.id, code, {
          nameOriginal: name,
          nameLang: "JA",
          nameJa: name,
          nameEn: `${cat.base} (effective ${from})`,
          displayOrder: cat.order + ei,
          thresholdLower: "0.1",
          lowerBound: "INCLUSIVE",
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          thresholdBasis: "PRODUCT",
          note: `${era}。${PENDING_NOTE}`,
        });
      }

      let linked = 0;
      for (const [i, p] of mine.entries()) {
        if (!write || !classId) continue;
        const lower = cat.use === "label" ? p.label : p.sds;
        const id = await upsertSubstance(classId, `JP-ISHA-${code}-${p.number}`, {
          officialNumber: p.number,
          nameOriginal: p.name,
          nameLang: "JA",
          nameJa: p.name,
          displayOrder: i + 1,
          aggregation: "NONE",
          // 裾切値は CHRIP が載せる厚労省の一覧の値。`0` は裾切値なし（0を超えれば該当）
          thresholdLower: lower,
          lowerBound: lower === "0" ? "EXCLUSIVE" : "INCLUSIVE",
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          effectiveFrom: new Date(`${from}T00:00:00Z`),
          note: `${era}。出どころ: CHRIP（NITE）`,
        });
        linked += await link(id, p.cas);
      }
      console.log(
        `  安衛法 ${name}`.padEnd(38) +
          `法文物質名 ${String(mine.length).padStart(3)} 件` +
          (write ? ` / CAS ${linked} 件` : ""),
      );
    }
  }

  // ── 2. 大気汚染防止法の VOC ──────────────────────────────────
  const apa = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode("JP-APA"), deletedAt: null },
    select: { id: true },
  });
  if (!apa) throw new Error("大気汚染防止法がありません");

  let vocClass: string | null = null;
  if (write) {
    vocClass = await upsertCategory(apa.id, "VOC", {
      nameOriginal: "揮発性有機化合物（VOC）",
      nameLang: "JA",
      nameJa: "揮発性有機化合物（VOC）",
      nameEn: "Volatile organic compounds (VOC)",
      displayOrder: 60,
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      thresholdBasis: "PRODUCT",
      note:
        "法第2条第4項の定義に当たる物質。**法令が物質を名指しした一覧ではない。**" +
        "法文物質名には物質自身の名前を、番号にはCAS番号を入れている。出どころは CHRIP（NITE）",
    });
  }
  const vocCode = `JP-APA-VOC-${data.voc.number}`;
  let vocLinked = 0;
  if (write && vocClass) {
    const id = await upsertSubstance(vocClass, vocCode, {
      officialNumber: data.voc.number,
      nameOriginal: data.voc.name,
      nameLang: "JA",
      nameJa: data.voc.name,
      displayOrder: 1,
      aggregation: "NONE",
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      applicableCondition: VOC_CONDITION,
      note: "出どころ: 大気汚染防止法 第2条第4項（e-Gov）。当たる物質は CHRIP（NITE）による",
    });
    vocLinked = await link(id, data.voc.cas);

    /*
      **前に物質1件ずつで作った行を片付ける。**
      はじめは物質の名前を法文物質名にしていたが、条文の定義文1件に改めた（2026-09-02）。
      同じ区分に古い行が残ると、同じ物質が二重に当たる
    */
    const stale = await prisma.statutorySubstance.findMany({
      where: { classId: vocClass, NOT: { codeNormalized: normalizeCode(vocCode) } },
      select: { id: true },
    });
    if (stale.length > 0) {
      const ids = stale.map((r) => r.id);
      await prisma.statutoryCasLink.deleteMany({ where: { statutorySubstanceId: { in: ids } } });
      await prisma.statutorySubstance.deleteMany({ where: { id: { in: ids } } });
      console.log(`  （前の作りの法文物質名 ${stale.length} 件を片付けました）`);
    }
  }
  console.log(
    `  大気 揮発性有機化合物（VOC）`.padEnd(38) +
      `法文物質名   1 件（定義文）` +
      (write ? ` / CAS ${vocLinked} 件` : ` / CAS ${data.voc.cas.length} 件`),
  );

  let excClass: string | null = null;
  if (write) {
    excClass = await upsertCategory(apa.id, "VOC_EXCLUDED", {
      nameOriginal: "揮発性有機化合物から除かれる物質",
      nameLang: "JA",
      nameJa: "揮発性有機化合物から除かれる物質",
      nameEn: "Substances excluded from VOCs",
      displayOrder: 70,
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      thresholdBasis: "PRODUCT",
      note:
        "令第2条の2が、揮発性有機化合物の定義から除いている物質。**規制の対象ではない。**" +
        "VOCに当たるかを見るときの反対側として持っている",
      judged: false,
    });
  }
  let excLinked = 0;
  for (const [i, e] of data.excluded.entries()) {
    if (!write || !excClass) continue;
    const id = await upsertSubstance(excClass, `JP-APA-VOC_EXCLUDED-${e.number}`, {
      officialNumber: e.number,
      nameOriginal: e.name,
      nameLang: "JA",
      nameJa: e.name,
      displayOrder: i + 1,
      aggregation: "NONE",
      thresholdLower: "0",
      lowerBound: "EXCLUSIVE",
      thresholdUpper: "100",
      upperBound: "INCLUSIVE",
      note: "出どころ: CHRIP（NITE）。令第2条の2",
    });
    excLinked += await link(id, [e.cas]);
  }
  console.log(
    `  大気 揮発性有機化合物から除かれる物質`.padEnd(38) +
      `法文物質名 ${String(data.excluded.length).padStart(3)} 件` +
      (write ? ` / CAS ${excLinked} 件` : ""),
  );

  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
