/**
 * 動作を見るためのサンプルデータを入れる管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-sample.ts            入れる（同じコードがあれば作り直す）
 *   npx tsx scripts/seed-sample.ts --remove   入れたものを消す
 *
 * 電子機器を1台ぶん、部品から物質まで下ろした形で作る。組成の展開が5段たどれるので、
 * 「原材料の中の原材料」の見えかたをそのまま試せる。
 *
 * わざと入れてある特徴:
 *  - 同じCAS番号（銅 7440-50-8）を、仕入先違いの別IDで2件。合算の話をするときの材料
 *  - 残部（balance）の行を1つ（基板の積層板）
 *  - 同じ原材料を2か所で使う（難燃剤マスターバッチ、基板、筐体）
 *
 * 入れるものには SAMPLE_PREFIXES のコードを付ける。--remove はこれを目印に消すので、
 * 手で作ったデータは巻き込まない。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** このスクリプトが作るものの目印。消すときもこれで絞る */
const SAMPLE_PREFIXES = ["SB-", "MT-", "PR-"];

interface SubstanceSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  cas: string | null;
  aliases?: string[];
  note?: string;
}

/** 物質。コードは SB-（Substance） */
const SUBSTANCES: SubstanceSeed[] = [
  { code: "SB-SN", nameJa: "すず", nameEn: "Tin", cas: "7440-31-5", aliases: ["錫"] },
  { code: "SB-AG", nameJa: "銀", nameEn: "Silver", cas: "7440-22-4" },
  {
    code: "SB-CU-A",
    nameJa: "銅（電解銅・A社）",
    nameEn: "Copper (electrolytic, supplier A)",
    cas: "7440-50-8",
    aliases: ["電解銅"],
    note: "仕入先ごとに分けて管理している。SB-CU-B と同じCAS番号",
  },
  {
    code: "SB-CU-B",
    nameJa: "銅（電気銅・B社）",
    nameEn: "Copper (tough pitch, supplier B)",
    cas: "7440-50-8",
    aliases: ["タフピッチ銅"],
    note: "仕入先ごとに分けて管理している。SB-CU-A と同じCAS番号",
  },
  { code: "SB-PB", nameJa: "鉛", nameEn: "Lead", cas: "7439-92-1" },
  { code: "SB-CD", nameJa: "カドミウム", nameEn: "Cadmium", cas: "7440-43-9" },
  { code: "SB-HG", nameJa: "水銀", nameEn: "Mercury", cas: "7439-97-6" },
  { code: "SB-CR6", nameJa: "三酸化クロム", nameEn: "Chromium trioxide", cas: "1333-82-0" },
  { code: "SB-ABS", nameJa: "ABS樹脂", nameEn: "ABS resin", cas: "9003-56-9" },
  { code: "SB-EP", nameJa: "エポキシ樹脂", nameEn: "Epoxy resin", cas: "25068-38-6" },
  { code: "SB-GF", nameJa: "ガラス繊維", nameEn: "Glass fibre", cas: "65997-17-3" },
  {
    code: "SB-DBDPE",
    nameJa: "デカブロモジフェニルエタン",
    nameEn: "Decabromodiphenyl ethane",
    cas: "84852-53-9",
    aliases: ["臭素系難燃剤", "DBDPE"],
  },
  {
    code: "SB-ATH",
    nameJa: "水酸化アルミニウム",
    nameEn: "Aluminium hydroxide",
    cas: "21645-51-2",
  },
  { code: "SB-PE", nameJa: "ポリエチレン", nameEn: "Polyethylene", cas: "9002-88-4" },
  { code: "SB-CB", nameJa: "カーボンブラック", nameEn: "Carbon black", cas: "1333-86-4" },
  { code: "SB-TIO2", nameJa: "二酸化チタン", nameEn: "Titanium dioxide", cas: "13463-67-7" },
  {
    code: "SB-DEHP",
    nameJa: "フタル酸ビス（2-エチルヘキシル）",
    nameEn: "Bis(2-ethylhexyl) phthalate",
    cas: "117-81-7",
    aliases: ["DEHP", "フタル酸ジオクチル"],
  },
  { code: "SB-DBP", nameJa: "フタル酸ジブチル", nameEn: "Dibutyl phthalate", cas: "84-74-2" },
  {
    code: "SB-POLY",
    nameJa: "変性シリコーンポリマー",
    nameEn: "Modified silicone polymer",
    cas: null,
    note: "ポリマーのためCAS番号を持たない",
  },
];

/** 組成の1行。物質はコード、原材料もコードで書く */
type LineSeed =
  | { substance: string; pct: string; note?: string }
  | { material: string; pct: string; note?: string }
  | { substance: string; balance: true; note?: string }
  | { material: string; balance: true; note?: string };

interface ProductSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  /** 他の製品の組成に入れられるか */
  material: boolean;
  note?: string;
  lines: LineSeed[];
}

/**
 * 製品と原材料。コードは MT-（Material）と PR-（Product）。
 * 参照される側を先に並べる（作る順がそのまま依存の順になる）。
 */
const PRODUCTS: ProductSeed[] = [
  {
    code: "MT-SOLDER",
    nameJa: "はんだ（Sn-Ag-Cu）",
    nameEn: "Solder (Sn-Ag-Cu)",
    material: true,
    lines: [
      { substance: "SB-SN", pct: "96.5" },
      { substance: "SB-AG", pct: "3" },
      { substance: "SB-CU-A", pct: "0.5", note: "A社から仕入れているもの" },
    ],
  },
  {
    code: "MT-FOIL",
    nameJa: "銅箔",
    nameEn: "Copper foil",
    material: true,
    lines: [
      { substance: "SB-CU-B", pct: "99.95", note: "B社から仕入れているもの" },
      { substance: "SB-PB", pct: "0.05" },
    ],
  },
  {
    code: "MT-MB-FR",
    nameJa: "難燃剤マスターバッチ",
    nameEn: "Flame retardant masterbatch",
    material: true,
    note: "基板と筐体の両方で使っている",
    lines: [
      { substance: "SB-ATH", pct: "60" },
      { substance: "SB-PE", pct: "39.5" },
      { substance: "SB-CB", pct: "0.5" },
    ],
  },
  {
    code: "MT-LAM",
    nameJa: "ガラスエポキシ積層板",
    nameEn: "Glass epoxy laminate",
    material: true,
    lines: [
      { substance: "SB-EP", pct: "38" },
      { substance: "SB-DBDPE", pct: "5" },
      { material: "MT-MB-FR", pct: "2" },
      { substance: "SB-GF", balance: true, note: "残りを繊維で埋める" },
    ],
  },
  {
    code: "MT-PIG-BK",
    nameJa: "黒色顔料ペースト",
    nameEn: "Black pigment paste",
    material: true,
    lines: [
      { substance: "SB-CB", pct: "25" },
      { substance: "SB-PE", pct: "75" },
    ],
  },
  {
    code: "MT-PCB",
    nameJa: "プリント基板アセンブリ",
    nameEn: "Printed circuit board assembly",
    material: true,
    lines: [
      { material: "MT-SOLDER", pct: "8" },
      { material: "MT-FOIL", pct: "25" },
      { material: "MT-LAM", pct: "67" },
    ],
  },
  {
    code: "MT-CASE",
    nameJa: "筐体（ABS成形品）",
    nameEn: "Housing (ABS moulding)",
    material: true,
    lines: [
      { material: "MT-MB-FR", pct: "12" },
      { substance: "SB-ABS", pct: "87.5" },
      { substance: "SB-TIO2", pct: "0.5" },
    ],
  },
  {
    code: "PR-CU100",
    nameJa: "コントロールユニット CU-100",
    nameEn: "Control unit CU-100",
    material: false,
    note: "組成をたどると5段まで下りる（本体→基板→積層板→難燃剤→物質）",
    lines: [
      { material: "MT-PCB", pct: "40" },
      { material: "MT-CASE", pct: "55" },
      { substance: "SB-EP", pct: "5", note: "組み立て用の接着剤" },
    ],
  },
  {
    code: "PR-SW200",
    nameJa: "表示スイッチユニット SW-200",
    nameEn: "Display switch unit SW-200",
    material: false,
    note: "CU-100 と同じ基板・筐体を使っている",
    lines: [
      { material: "MT-PCB", pct: "30" },
      { material: "MT-CASE", pct: "60" },
      { material: "MT-PIG-BK", pct: "10" },
    ],
  },
];

const normalize = (code: string) => code.trim().toUpperCase();

/** このスクリプトが作ったものだけを消す */
async function remove() {
  const where = { OR: SAMPLE_PREFIXES.map((p) => ({ codeNormalized: { startsWith: p } })) };
  const lines = await prisma.compositionLine.deleteMany({ where: { parentProduct: where } });
  const products = await prisma.product.deleteMany({ where });
  const substances = await prisma.substance.deleteMany({ where });
  console.warn(
    `消しました — 組成行 ${lines.count} / 製品・原材料 ${products.count} / 物質 ${substances.count}`,
  );
}

async function seed() {
  // 作り直せるよう、同じコードのものは先に消す
  await remove();

  const admin = await prisma.user.findFirst({
    where: { deletedAt: null, permissions: { some: { permission: "ADMIN" } } },
    select: { id: true },
  });
  const createdBy = admin?.id ?? null;

  const substanceIds = new Map<string, string>();
  for (const s of SUBSTANCES) {
    const row = await prisma.substance.create({
      data: {
        code: s.code,
        codeNormalized: normalize(s.code),
        nameJa: s.nameJa,
        nameEn: s.nameEn,
        casNumber: s.cas,
        casNormalized: s.cas ? normalize(s.cas) : null,
        note: s.note ?? null,
        status: "ACTIVE",
        publishState: "PUBLISHED",
        createdBy,
        aliases: {
          create: (s.aliases ?? []).map((nameJa, i) => ({ nameJa, displayOrder: i + 1 })),
        },
      },
      select: { id: true },
    });
    substanceIds.set(s.code, row.id);
  }

  const productIds = new Map<string, string>();
  for (const p of PRODUCTS) {
    const row = await prisma.product.create({
      data: {
        code: p.code,
        codeNormalized: normalize(p.code),
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        note: p.note ?? null,
        status: "ACTIVE",
        publishState: "PUBLISHED",
        usableAsMaterial: p.material,
        createdBy,
      },
      select: { id: true },
    });
    productIds.set(p.code, row.id);

    await prisma.compositionLine.createMany({
      data: p.lines.map((line, i) => {
        const balance = "balance" in line;
        return {
          parentProductId: row.id,
          substanceId: "substance" in line ? (substanceIds.get(line.substance) ?? null) : null,
          childProductId: "material" in line ? (productIds.get(line.material) ?? null) : null,
          contentPct: balance ? null : line.pct,
          isBalance: balance,
          note: line.note ?? null,
          displayOrder: i + 1,
        };
      }),
    });
  }

  console.warn(
    `入れました — 物質 ${SUBSTANCES.length} / 製品・原材料 ${PRODUCTS.length} / ` +
      `組成行 ${PRODUCTS.reduce((n, p) => n + p.lines.length, 0)}`,
  );
  console.warn("組成を見るなら PR-CU100（コントロールユニット CU-100）から。5段たどれます。");
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  return seed();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
