/**
 * 韓国（化評法／化管法）の規制区分・法文物質名・CASリンクを、CHRIP から入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-chrip-korea-data.ts                      先に取り出す
 *   ... scripts/seed-chrip-korea.ts                          下見
 *   ... scripts/seed-chrip-korea.ts --write                  書き込み
 *
 * ## CHRIP だけで成り立たせる
 *
 * **LOLI を見ない。**CHRIP しか契約していないお客様の環境でも、これだけで
 * 韓国の7区分が揃うようにしてある（`docs/法規制データの作り方.md` 第0章 0-2）。
 * 法令・規制区分が無ければここで作る。
 *
 * ## すでにあるものは書き換えない
 *
 * LOLI からも同じ7区分を作れる（`scripts/seed-korea-laws.ts`）。両方を入れている
 * お客様では、**先に入れたほうの名前と閾値を残す。**あとから来たソースが
 * 上書きすると、どちらの読みかたが効いているのか分からなくなるため。
 * CHRIP は**足りないものを作り、自分のCASリンクを足すだけ。**
 *
 * ## 号の書き方の違い
 *
 * 同じ号を CHRIP は `1`・`97-1-119(1)`、LOLI は `001`・`97-1-119 (1)` と書く。
 * 桁と空白をそろえて見比べ、同じ号なら既にある法文物質名を使う（`numberKey`）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "CHRIP";
/** `1333-86-4` の形だけを通す */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

interface Item {
  law: string;
  category: string;
  number: string;
  nameEn: string;
  lower: string | null;
  cas: string[];
}

/** 法令が無ければ作る */
const LAWS: Record<string, { nameJa: string; nameEn: string; order: number }> = {
  "KR-KREACH": {
    nameJa: "化学物質の登録及び評価等に関する法律（K-REACH）",
    nameEn: "Act on Registration and Evaluation of Chemical Substances (K-REACH)",
    order: 10,
  },
  "KR-CCA": {
    nameJa: "化学物質管理法",
    nameEn: "Chemicals Control Act",
    order: 30,
  },
};

/**
 * 規制区分。CHRIP の「カテゴリ」がそのまま区分になる。
 * 有害化学物質だけは、有害性の種類ごとに閾値が違うので3つに分ける。
 *
 * **名前は英語のまま原語欄にも入れている。**CHRIP は韓国の区分名を
 * 英語でしか持たず、韓国語を当てると造語になるため。
 */
const CATEGORIES: Record<string, { nameJa: string; nameEn: string; order: number; note: string }> =
  {
    PROHIBITED: {
      nameJa: "禁止物質",
      nameEn: "Prohibited substances",
      order: 10,
      note: "製造・輸入・販売・保管・運搬・使用が禁じられる",
    },
    RESTRICTED: {
      nameJa: "制限物質",
      nameEn: "Restricted substances",
      order: 20,
      note: "特定の用途での製造・輸入・使用が制限される。用途は条文で決まるため、判定では見ていない",
    },
    TOXIC_ACUTE: {
      nameJa: "急性毒性物質（人の健康）",
      nameEn: "Acute toxic substances for human health",
      order: 30,
      note: "有害化学物質のうち、人の健康への急性の有害性で指定されたもの",
    },
    TOXIC_CHRONIC: {
      nameJa: "慢性毒性物質（人の健康）",
      nameEn: "Chronic toxic substances for human health",
      order: 40,
      note: "有害化学物質のうち、人の健康への慢性の有害性で指定されたもの",
    },
    TOXIC_ECO: {
      nameJa: "生態毒性物質",
      nameEn: "Ecological toxic substances",
      order: 50,
      note: "有害化学物質のうち、生態への有害性で指定されたもの",
    },
    PRIORITY: {
      nameJa: "重点管理物質",
      nameEn: "Substances of concern",
      order: 60,
      note: "有害性が高いものとして指定され、含有量の報告が要る。濃度の下限は決まっていない",
    },
    ACCIDENT: {
      nameJa: "事故備え物質",
      nameEn: "Accident precaution chemicals",
      order: 10,
      note: "事故が起きたときの被害が大きいものとして指定され、取扱基準と自主管理計画が要る",
    },
  };

/**
 * 号の書き方の違いを吸収する鍵。同じ号を指す次の書き方を1つにまとめる。
 *
 *   `001` と `1`                 … 桁の揃えかたが違う（重点管理・事故備え）
 *   `97-1-119 (1)` と `97-1-119(1)` … 括弧の前の空白（有害化学物質）
 */
const numberKey = (n: string) =>
  n
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\d+/g, (d) => String(Number(d)));

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const data = JSON.parse(
    readFileSync(join(process.cwd(), "scripts/data/chrip-korea.json"), "utf-8"),
  ) as { items: Item[] };

  const [version, source, country] = await Promise.all([
    prisma.linkSetVersion.findFirst({ where: { isCurrent: true, deletedAt: null } }),
    prisma.source.findFirst({
      where: { codeNormalized: normalizeCode(SOURCE_CODE), deletedAt: null },
      select: { id: true },
    }),
    prisma.country.findFirst({
      where: { codeNormalized: normalizeCode("KOR"), deletedAt: null },
      select: { id: true },
    }),
  ]);
  if (!version) throw new Error("現在のバージョンが決まっていません");
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  if (!country) throw new Error("国「KOR」がありません");
  console.log(`  入れ先: ${version.code} × ${SOURCE_CODE}`);

  /** 物質マスタにあるCASだけを結ぶ。無いものは chrip-import.ts が先に入れる */
  const known = new Set(
    (
      await prisma.substance.findMany({
        where: { deletedAt: null },
        select: { casNormalized: true },
      })
    )
      .map((s) => s.casNormalized)
      .filter((c): c is string => !!c),
  );

  const tally = { cats: 0, newSubs: 0, keptSubs: 0, links: 0, noMaster: 0 };
  const perCategory = new Map<string, { n: number; made: number; links: number }>();

  for (const lawCode of [...new Set(data.items.map((i) => i.law))].sort()) {
    const def = LAWS[lawCode];
    if (!def) throw new Error(`法令 ${lawCode} の名前を決めていません`);
    let law = await prisma.law.findFirst({
      where: { codeNormalized: normalizeCode(lawCode), deletedAt: null },
      select: { id: true },
    });
    if (!law) {
      if (!write) {
        console.log(`  法令 ${lawCode} を作ります`);
        continue;
      }
      law = await prisma.law.create({
        data: {
          code: lawCode,
          codeNormalized: normalizeCode(lawCode),
          countryId: country.id,
          nameOriginal: def.nameJa,
          nameLang: "JA",
          nameJa: def.nameJa,
          nameEn: def.nameEn,
          displayOrder: def.order,
        },
        select: { id: true },
      });
      console.log(`  法令 ${lawCode} を作りました`);
    }

    const cats = [...new Set(data.items.filter((i) => i.law === lawCode).map((i) => i.category))];
    cats.sort((a, b) => (CATEGORIES[a]?.order ?? 0) - (CATEGORIES[b]?.order ?? 0));
    for (const code of cats) {
      const cdef = CATEGORIES[code];
      if (!cdef) throw new Error(`規制区分 ${code} の名前を決めていません`);
      const items = data.items.filter((i) => i.law === lawCode && i.category === code);

      let classId: string | null = null;
      if (write) {
        const found = await prisma.regulationCategory.findFirst({
          where: { lawId: law.id, codeNormalized: normalizeCode(code) },
          select: { id: true },
        });
        // すでにあれば触らない。作るときだけ名前と閾値のひな型を入れる
        const cat =
          found ??
          (await prisma.regulationCategory.create({
            data: {
              code,
              codeNormalized: normalizeCode(code),
              lawId: law.id,
              nameOriginal: cdef.nameEn,
              nameLang: "EN",
              nameJa: cdef.nameJa,
              nameEn: cdef.nameEn,
              displayOrder: cdef.order,
              thresholdLower: "0",
              lowerBound: "EXCLUSIVE",
              thresholdUpper: "100",
              upperBound: "INCLUSIVE",
              thresholdBasis: "PRODUCT",
              note: cdef.note,
            },
            select: { id: true },
          }));
        if (!found) tally.cats += 1;
        const cls = await prisma.regulationClass.findFirst({
          where: { categoryId: cat.id, deletedAt: null },
          select: { id: true },
        });
        classId =
          cls?.id ??
          (
            await prisma.regulationClass.create({
              data: {
                code: "DEFAULT",
                codeNormalized: "DEFAULT",
                categoryId: cat.id,
                displayOrder: 0,
              },
              select: { id: true },
            })
          ).id;
      }

      /** すでにある法文物質名を、号の書き方をそろえて引けるようにする */
      const byNumber = new Map<string, string>();
      if (classId) {
        for (const s of await prisma.statutorySubstance.findMany({
          where: { classId, deletedAt: null },
          select: { id: true, officialNumber: true },
        })) {
          if (s.officialNumber) byNumber.set(numberKey(s.officialNumber), s.id);
        }
      }

      let made = 0;
      let links = 0;
      for (const [i, item] of items.entries()) {
        const usable = [...new Set(item.cas.filter((c) => CAS_SHAPE.test(c)))];
        const linkable = usable.filter((c) => known.has(normalizeCas(c)));
        tally.noMaster += usable.length - linkable.length;
        if (!write || !classId) {
          links += linkable.length;
          continue;
        }

        let id = byNumber.get(numberKey(item.number));
        if (id) {
          tally.keptSubs += 1;
        } else {
          const subCode = `${lawCode}-${code}-${item.number}`;
          const row = await prisma.statutorySubstance.create({
            data: {
              code: subCode,
              codeNormalized: normalizeCode(subCode),
              classId,
              officialNumber: item.number,
              nameOriginal: item.nameEn || item.number,
              nameLang: "EN",
              nameEn: item.nameEn || null,
              displayOrder: i + 1,
              aggregation: "NONE",
              // 「対象となる範囲（％）」は含有率の下限。その値以上が対象
              thresholdLower: item.lower ?? "0",
              lowerBound: item.lower ? "INCLUSIVE" : "EXCLUSIVE",
              thresholdUpper: "100",
              upperBound: "INCLUSIVE",
              note: "出どころ: CHRIP（NITE）。名前は告示の英訳",
            },
            select: { id: true },
          });
          id = row.id;
          byNumber.set(numberKey(item.number), id);
          made += 1;
          tally.newSubs += 1;
        }

        if (linkable.length === 0) continue;
        const done = await prisma.statutoryCasLink.createMany({
          data: linkable.map((c) => ({
            statutorySubstanceId: id,
            casNumber: c,
            casNormalized: normalizeCas(c),
            versionId: version.id,
            sourceId: source.id,
          })),
          skipDuplicates: true,
        });
        links += done.count;
      }
      tally.links += links;
      perCategory.set(`${lawCode}/${code}`, { n: items.length, made, links });
    }
  }

  console.log();
  for (const [k, v] of [...perCategory].sort())
    console.log(
      `  ${k.padEnd(24)} 号 ${String(v.n).padStart(5)} 件（新しく作った ${String(v.made).padStart(4)}）/ CASリンク ${v.links}`,
    );
  console.log(
    `\n規制区分を作った: ${tally.cats} / 法文物質名 新規 ${tally.newSubs}・既存を使った ${tally.keptSubs}`,
  );
  console.log(`CASリンク: ${tally.links.toLocaleString()} 件`);
  if (tally.noMaster)
    console.log(
      `  物質マスタに無くて結べなかったCAS: ${tally.noMaster} 件（chrip-import.ts が先）`,
    );
  if (!write) console.log("\n下見だけ。書き込むなら --write");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
