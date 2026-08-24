/**
 * 地域「国際」と、その配下の国・法令名を登録する。
 *
 * 国連や各条約は国ではないが、法令の発行元という点では国と同じ位置に来る。
 * 地域「国際」は、国にも地理のまとまりにも属さない発行元の置き場という約束事。
 *
 * ここで入れるのは**法令の名前まで**。区分・法文物質名・CASリンクは入れない。
 * 既にあるものは書き換えず、無いものだけ足す（他の地域・国には触らない）。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-international.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const REGION = { code: "INT", nameJa: "国際", nameEn: "International", displayOrder: 10 };

interface LawDef {
  code: string;
  /** 条約・勧告の正文は英語。原文は英語名を入れ、日本語は訳として持つ */
  nameOriginal: string;
  nameJa: string;
  note: string;
}
interface CountryDef {
  code: string;
  nameJa: string;
  nameEn: string;
  laws: LawDef[];
}

const COUNTRIES: CountryDef[] = [
  {
    code: "UN",
    nameJa: "国連",
    nameEn: "United Nations",
    laws: [
      {
        code: "INT-GHS",
        nameOriginal: "Globally Harmonized System of Classification and Labelling of Chemicals",
        nameJa: "GHS（化学品の分類および表示に関する世界調和システム）",
        note: "各国のGHS適用の元になるもの。SDSの第2項・第3項",
      },
      {
        code: "INT-UNTDG",
        nameOriginal: "Recommendations on the Transport of Dangerous Goods, Model Regulations",
        nameJa: "危険物輸送に関する勧告（国連モデル規則）",
        note: "UN番号と輸送分類の元。SDSの第14項",
      },
    ],
  },
  {
    code: "POPS",
    nameJa: "ストックホルム条約",
    nameEn: "Stockholm Convention",
    laws: [
      {
        code: "INT-POPS",
        nameOriginal: "Stockholm Convention on Persistent Organic Pollutants",
        nameJa: "残留性有機汚染物質に関するストックホルム条約",
        note: "POPs。SDSの第15項",
      },
    ],
  },
  {
    code: "PIC",
    nameJa: "ロッテルダム条約",
    nameEn: "Rotterdam Convention",
    laws: [
      {
        code: "INT-PIC",
        nameOriginal:
          "Rotterdam Convention on the Prior Informed Consent Procedure for Certain Hazardous Chemicals and Pesticides in International Trade",
        nameJa: "ロッテルダム条約（PIC条約）",
        note: "輸出入の事前同意。SDSの第15項",
      },
    ],
  },
  {
    code: "OZONE",
    nameJa: "モントリオール議定書",
    nameEn: "Montreal Protocol",
    laws: [
      {
        code: "INT-OZONE",
        nameOriginal: "Montreal Protocol on Substances that Deplete the Ozone Layer",
        nameJa: "オゾン層を破壊する物質に関するモントリオール議定書",
        note: "オゾン層破壊物質。SDSの第15項",
      },
    ],
  },
  {
    code: "HG",
    nameJa: "水俣条約",
    nameEn: "Minamata Convention",
    laws: [
      {
        code: "INT-MINAMATA",
        nameOriginal: "Minamata Convention on Mercury",
        nameJa: "水銀に関する水俣条約",
        note: "水銀とその化合物。SDSの第15項",
      },
    ],
  },
  {
    code: "IARC",
    nameJa: "国際がん研究機関",
    nameEn: "International Agency for Research on Cancer",
    laws: [
      {
        code: "INT-IARC",
        nameOriginal: "IARC Monographs on the Identification of Carcinogenic Hazards to Humans",
        nameJa: "IARC発がん性分類",
        note: "法令ではないが、発がん性の区分としてSDSの第11項で広く引かれる",
      },
    ],
  },
];

async function main() {
  let region = await prisma.region.findFirst({ where: { codeNormalized: REGION.code } });
  if (!region) {
    region = await prisma.region.create({
      data: { ...REGION, codeNormalized: REGION.code },
    });
    console.log(`地域「${REGION.nameJa}」を作りました`);
  } else {
    console.log(`地域「${REGION.nameJa}」は既にあります`);
  }

  let addedCountries = 0;
  let addedLaws = 0;
  for (const [i, c] of COUNTRIES.entries()) {
    let country = await prisma.country.findFirst({ where: { codeNormalized: c.code } });
    if (!country) {
      country = await prisma.country.create({
        data: {
          code: c.code,
          codeNormalized: c.code,
          regionId: region.id,
          nameJa: c.nameJa,
          nameEn: c.nameEn,
          displayOrder: i,
        },
      });
      addedCountries += 1;
    }
    for (const [j, l] of c.laws.entries()) {
      const exists = await prisma.law.findFirst({ where: { codeNormalized: l.code } });
      if (exists) continue;
      await prisma.law.create({
        data: {
          code: l.code,
          codeNormalized: l.code,
          countryId: country.id,
          nameOriginal: l.nameOriginal,
          nameLang: "EN",
          nameJa: l.nameJa,
          nameEn: l.nameOriginal,
          displayOrder: 100 + i * 10 + j,
          note: l.note,
        },
      });
      addedLaws += 1;
    }
  }
  console.log(`国 ${addedCountries} 件、法令 ${addedLaws} 件を足しました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
