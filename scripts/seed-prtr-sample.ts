/**
 * PRTR 届出データ入力（S22）を試すための見本データと、取り込みの見本ファイルを作る管理用スクリプト。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/seed-prtr-sample.ts
 *   ... scripts/seed-prtr-sample.ts --remove   入れた製品を消す（見本ファイルはそのまま）
 *
 * 入れるもの:
 *  - 製品 120 件（コード PRTR-P001〜）。塗料・シンナー・接着剤・洗浄剤など、工場にありそうな品目。
 *    組成は既にある物質（化管法 第一種に当たるトルエン・キシレン・ホルムアルデヒドなど＋当たらないもの）から
 *    1〜4 行。判定を流せば化管法に該当する
 *  - 見本ファイル docs/prtr/samples/ に 5 つ（CSV UTF-8 / CSV Shift_JIS / TSV / Excel の数量、Excel の実測値）。
 *    数量は 120 製品ぶん（＋既にある製品 6 件）。列の順を変えたり余分な列を足したりして、割り当ての練習になる形にしてある
 *
 * 値は乱数で作るが、種を固定してあるので流し直しても同じになる
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import iconv from "iconv-lite";

const prisma = new PrismaClient();
const PREFIX = "PRTR-P";
const OUT = "docs/prtr/samples";

/** 種を固定した乱数（流し直しても同じ見本になる） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = rng(20260921);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)]!;
const between = (lo: number, hi: number, digits = 1) => (lo + rand() * (hi - lo)).toFixed(digits);

/** 品目の型。名前の部品と、入りやすい物質 */
const KINDS = [
  {
    name: "溶剤系塗料",
    codes: ["CH-TOL", "CH-XYL", "CH-EB", "CH-MIBK"],
    filler: ["CH-BAC", "CH-CB", "CH-BASO4"],
    nameNos: ["白", "黒", "グレー", "赤さび", "黄", "青"],
  },
  {
    name: "2液ウレタン塗料 主剤",
    codes: ["CH-XYL", "CH-EB", "CH-TOL"],
    filler: ["CH-BAC", "CH-BUOH", "CH-CB"],
    nameNos: ["白", "黒", "グレー", "緑"],
  },
  {
    name: "2液ウレタン塗料 硬化剤",
    codes: ["CH-HDI", "CH-XYL"],
    filler: ["CH-BAC"],
    nameNos: ["標準", "速乾", "冬型"],
  },
  {
    name: "エポキシプライマー",
    codes: ["CH-XYL", "CH-EB", "CH-TOL"],
    filler: ["CH-BUOH", "CH-CB"],
    nameNos: ["赤さび", "グレー", "白"],
  },
  {
    name: "ラッカーシンナー",
    codes: ["CH-TOL", "CH-XYL", "CH-MIBK"],
    filler: ["CH-BAC", "CH-BUOH"],
    nameNos: ["T-100", "T-200", "T-300", "冬用"],
  },
  {
    name: "ウレタンシンナー",
    codes: ["CH-XYL", "CH-EB"],
    filler: ["CH-BAC", "CH-BUOH"],
    nameNos: ["U-10", "U-20", "U-30"],
  },
  {
    name: "洗浄用シンナー",
    codes: ["CH-TOL", "CH-XYL"],
    filler: ["CH-BAC"],
    nameNos: ["C-90", "C-50", "リサイクル"],
  },
  {
    name: "接着剤（溶剤形）",
    codes: ["CH-TOL", "CH-MIBK"],
    filler: ["CH-BAC"],
    nameNos: ["G-17", "G-103", "速乾"],
  },
  { name: "接着剤（水性）", codes: ["CH-HCHO"], filler: ["CH-BUOH"], nameNos: ["W-1", "W-2"] },
  {
    name: "樹脂ワニス",
    codes: ["CH-XYL", "CH-EB", "CH-HCHO"],
    filler: ["CH-BAC", "CH-BUOH"],
    nameNos: ["V-10", "V-20", "耐熱"],
  },
  { name: "防錆油", codes: ["CH-XYL"], filler: ["CH-BAC"], nameNos: ["R-1", "R-2"] },
  {
    name: "印刷インキ",
    codes: ["CH-TOL", "CH-MIBK", "CH-EB"],
    filler: ["CH-BAC", "CH-CB"],
    nameNos: ["墨", "藍", "紅", "黄"],
  },
  { name: "離型剤", codes: ["CH-XYL"], filler: ["CH-BAC", "CH-BUOH"], nameNos: ["M-1", "M-5"] },
  {
    name: "床用コーティング",
    codes: ["CH-XYL", "CH-EB", "CH-DBTDL"],
    filler: ["CH-BAC", "CH-BASO4"],
    nameNos: ["標準", "重歩行"],
  },
] as const;

interface ProductSeed {
  code: string;
  nameJa: string;
  nameEn: string;
  lines: { substance: string; pct: string }[];
}

function buildProducts(): ProductSeed[] {
  const out: ProductSeed[] = [];
  for (let i = 1; i <= 120; i++) {
    const kind = KINDS[(i - 1) % KINDS.length]!;
    const code = `${PREFIX}${String(i).padStart(3, "0")}`;
    const variant = kind.nameNos[Math.floor((i - 1) / KINDS.length) % kind.nameNos.length]!;
    const nameJa = `${kind.name} ${variant} ${String(100 + i)}`;
    const nameEn = `${kind.name} ${variant} ${String(100 + i)}`;
    // 第一種に当たる物質を 1〜3 行、当たらない物質を 0〜1 行。合計は 100% を超えない
    const n = 1 + Math.floor(rand() * Math.min(3, kind.codes.length));
    const chosen = [...kind.codes].sort(() => rand() - 0.5).slice(0, n);
    const lines: { substance: string; pct: string }[] = [];
    let total = 0;
    for (const c of chosen) {
      const pct = Number(between(2, 35, 1));
      if (total + pct > 90) break;
      lines.push({ substance: c, pct: pct.toFixed(1) });
      total += pct;
    }
    if (rand() < 0.7) {
      const f = pick(kind.filler);
      const pct = Number(between(5, Math.max(6, 95 - total), 1));
      lines.push({ substance: f, pct: pct.toFixed(1) });
    }
    out.push({ code, nameJa, nameEn, lines });
  }
  return out;
}

async function remove() {
  const products = await prisma.product.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  await prisma.prtrQuantity.deleteMany({ where: { productId: { in: ids } } });
  await prisma.compositionLine.deleteMany({ where: { parentProductId: { in: ids } } });
  await prisma.productJudgement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  console.log(`製品 ${ids.length} 件を消しました`);
}

async function seed() {
  const products = buildProducts();
  const codes = [...new Set(products.flatMap((p) => p.lines.map((l) => l.substance)))];
  const substances = await prisma.substance.findMany({
    where: { code: { in: codes }, deletedAt: null },
    select: { id: true, code: true },
  });
  const substanceIds = new Map(substances.map((s) => [s.code, s.id]));
  const missing = codes.filter((c) => !substanceIds.has(c));
  if (missing.length)
    throw new Error(`物質が無い: ${missing.join(", ")}（先に scripts/seed-sample.ts を流す）`);

  const admin = await prisma.user.findFirst({
    where: { email: "admin@example.com" },
    select: { id: true },
  });
  let created = 0;
  for (const p of products) {
    const codeNormalized = normalizeCode(p.code);
    const existing = await prisma.product.findUnique({
      where: { codeNormalized },
      select: { id: true },
    });
    const row = existing
      ? await prisma.product.update({
          where: { id: existing.id },
          data: { nameJa: p.nameJa, nameEn: p.nameEn, deletedAt: null, publishState: "PUBLISHED" },
          select: { id: true },
        })
      : await prisma.product.create({
          data: {
            code: p.code,
            codeNormalized,
            nameJa: p.nameJa,
            nameEn: p.nameEn,
            status: "ACTIVE",
            publishState: "PUBLISHED",
            usableAsMaterial: false,
            createdBy: admin?.id ?? null,
          },
          select: { id: true },
        });
    await prisma.compositionLine.deleteMany({ where: { parentProductId: row.id } });
    await prisma.compositionLine.createMany({
      data: p.lines.map((l, i) => ({
        parentProductId: row.id,
        substanceId: substanceIds.get(l.substance)!,
        contentPct: l.pct,
        displayOrder: i + 1,
      })),
    });
    created += 1;
  }
  console.log(`製品 ${created} 件（${PREFIX}001〜）`);

  // ── 見本ファイル ──
  mkdirSync(OUT, { recursive: true });
  const extra = await prisma.product.findMany({
    where: { deletedAt: null, code: { startsWith: "CP-" } },
    orderBy: { code: "asc" },
    take: 6,
    select: { code: true, nameJa: true },
  });
  /** 数量の行: 購入 120〜25,000 kg、出荷はその 55〜95% */
  const rows = [
    ...products.map((p) => ({ code: p.code, name: p.nameJa })),
    ...extra.map((p) => ({ code: p.code, name: p.nameJa })),
  ].map((p) => {
    const purchased = Number(between(120, 25000, 0));
    const shipped = Math.round(purchased * (0.55 + rand() * 0.4));
    return { ...p, purchased, shipped };
  });

  // 1) CSV（UTF-8、BOM 付き）。テンプレートと同じ並び
  const csv = [
    "製品コード,製品名,購入数量(kg),出荷数量(kg)",
    ...rows.map((r) => `${r.code},"${r.name}",${r.purchased},${r.shipped}`),
  ].join("\r\n");
  writeFileSync(`${OUT}/数量_2025_製造部.csv`, "﻿" + csv, "utf-8");

  // 2) CSV（Shift_JIS）。列の順を変え、余分な列（伝票番号・備考）を足してある。割り当ての練習用
  const sjisRows = rows.map(
    (r, i) =>
      `DN-${String(2025000 + i)},${r.shipped},${r.code},${r.purchased},"${r.name}",${i % 7 === 0 ? "月次まとめ" : ""}`,
  );
  const sjis = ["伝票番号,出荷数量,製品コード,購入数量,製品名,備考", ...sjisRows].join("\r\n");
  writeFileSync(`${OUT}/数量_2025_製造部_ShiftJIS.csv`, iconv.encode(sjis, "Shift_JIS"));

  // 3) TSV。購入数量だけ（実測値の方法で使う）
  const tsv = [
    "製品コード\t製品名\t購入数量(kg)",
    ...rows.map((r) => `${r.code}\t${r.name}\t${r.purchased}`),
  ].join("\n");
  writeFileSync(`${OUT}/数量_2025_購入のみ.tsv`, tsv, "utf-8");

  // 4) Excel（数量）。テンプレートと同じ形
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("製品ごとの数量");
  ws.columns = [
    { header: "製品コード", width: 16 },
    { header: "製品名", width: 40 },
    { header: "購入数量(kg)", width: 14 },
    { header: "出荷数量(kg)", width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow([r.code, r.name, r.purchased, r.shipped]);
  writeFileSync(`${OUT}/数量_2025_製造部.xlsx`, Buffer.from(await wb.xlsx.writeBuffer()));

  // 5) Excel（実測値）。化管法 第一種に当たる物質（自社コード）。年間の kg
  const measuredCodes = [
    "CH-TOL",
    "CH-XYL",
    "CH-EB",
    "CH-MIBK",
    "CH-HCHO",
    "CH-HDI",
    "CH-DBTDL",
    "SB-PB",
    "SB-CD",
    "SB-CR6",
    "SB-DEHP",
    "SB-DBP",
  ];
  const measuredSubs = await prisma.substance.findMany({
    where: { code: { in: measuredCodes }, deletedAt: null },
    select: { code: true, nameJa: true },
    orderBy: { code: "asc" },
  });
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("実測値");
  ws2.columns = [
    { header: "物質コード", width: 16 },
    { header: "物質名", width: 32 },
    { header: "実測値(kg)", width: 14 },
  ];
  ws2.getRow(1).font = { bold: true };
  for (const s of measuredSubs) ws2.addRow([s.code, s.nameJa, Number(between(0.5, 4800, 1))]);
  writeFileSync(`${OUT}/実測値_2025_製造部.xlsx`, Buffer.from(await wb2.xlsx.writeBuffer()));

  console.log(
    `見本ファイル 5 つ → ${OUT}/（数量 ${rows.length} 行、実測値 ${measuredSubs.length} 行）`,
  );
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
