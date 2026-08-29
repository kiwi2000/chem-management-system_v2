/**
 * 「※」と「△」が1つのセルに並ぶことを確かめるための製品を1つ作る。
 *
 * 実行:
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-mark-sample.ts            下見
 *   ... scripts/seed-mark-sample.ts --write   書き込み
 *
 * **足すだけ。**すでに同じコードの製品があれば何もしない。
 *
 * なぜこの中身なのか
 *   ２，２'-ジクロロ-ar,ar'-メチレンジアニリン（CAS 27342-75-2）は、国内で
 *     化管法 特定第一種指定化学物質 … 閾値 0.1%、条件つきの指定なので**要確認**
 *     化管法 第一種指定化学物質     … 閾値 1%
 *   の2つに載っている。0.5% で入れると、前者は該当（※）、後者は含有率不足（△）になる。
 *   同じCAS・同じ地域なので、**1つのセルに ※ と △ が並ぶ**。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CODE = "MARK-001";
const NAME = "印の確認用サンプル";
/** 0.5% 入れる物質。国内で閾値0.1%と1%の両方に載っている */
const TARGET_CODE = "CAS-27342-75-2";
/** 残りを埋める物質。CASを持たないので、どの法規制にも当たらない */
const FILLER_CODE = "CH-ACPOL";

async function main() {
  const write = process.argv.includes("--write");

  const exists = await prisma.product.findFirst({
    where: { codeNormalized: CODE, deletedAt: null },
  });
  if (exists) {
    console.log(`${CODE} はすでにある。何もしない`);
    return;
  }

  const [target, filler] = await Promise.all([
    prisma.substance.findFirst({ where: { codeNormalized: TARGET_CODE, deletedAt: null } }),
    prisma.substance.findFirst({ where: { codeNormalized: FILLER_CODE, deletedAt: null } }),
  ]);
  if (!target) throw new Error(`${TARGET_CODE} が物質マスタに無い`);
  if (!filler) throw new Error(`${FILLER_CODE} が物質マスタに無い`);
  console.log(`0.5%: ${target.code} ${target.nameJa}`);
  console.log(`99.5%: ${filler.code} ${filler.nameJa}`);

  if (!write) {
    console.log("下見だけ。書き込むなら --write を付ける");
    return;
  }

  const product = await prisma.product.create({
    data: {
      code: CODE,
      codeNormalized: CODE,
      nameJa: NAME,
      publishState: "PUBLISHED",
      note: "CAS合算の表で「※（要確認）」と「△（含有率不足）」が同じセルに並ぶことを確かめるための製品",
      compositionLines: {
        create: [
          { substanceId: target.id, contentPct: "0.5", displayOrder: 0 },
          { substanceId: filler.id, contentPct: "99.5", displayOrder: 1 },
        ],
      },
    },
  });
  console.log(`作った: ${product.code} (${product.id})`);

  /*
    判定は**展開した結果**を見る。作ったばかりの製品には展開が無いので、
    先に作らないと「中身が何も分からない」ものとして扱われ、1件も当たらない
  */
  const { expandProduct, saveExpansion } = await import("../apps/web/lib/expansion-store");
  const { getAppSettings } = await import("../apps/web/lib/settings");
  const { getMessages } = await import("@chem/shared");
  const settings = await getAppSettings();
  const expanded = await expandProduct(product.id, settings, getMessages("ja"));
  await saveExpansion(product.id, expanded);

  const { loadRules, loadFactors, judgeProduct } = await import("../apps/web/lib/judge-store");
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");
  const rules = await loadRules(version.id);
  const factors = await loadFactors();
  await judgeProduct(product.id, rules, factors);
  const n = await prisma.productJudgement.count({
    where: { productId: product.id, verdict: "APPLICABLE" },
  });
  console.log(`判定した: 該当 ${n} 件`);
}

main().finally(() => prisma.$disconnect());
