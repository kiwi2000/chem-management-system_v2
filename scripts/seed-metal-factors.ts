/**
 * 金属換算係数を、LOLI の分子式から計算して入れる管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-metal-factors.ts <分子式のTSV>          下見
 *   npx tsx scripts/seed-metal-factors.ts <分子式のTSV> --write  書き込む
 *
 * TSV は LOLI からこう取り出す（Cas と Formula の2列、見出し無し）:
 *   sqlcmd ... -Q "SELECT CAST(Cas AS varchar(20)), Formula FROM CasNames
 *                  WHERE Formula IS NOT NULL AND LTRIM(RTRIM(Formula)) <> ''"
 *
 * なぜ要るのか。
 * 「鉛及びその化合物」の閾値は**鉛として**何％か、で決まる。
 * 酸化鉛（PbO）10％は、鉛としては 9.283％。係数が無いとこの換算ができず、
 * そのままの値で数えることになる（多めに出るので見落としはしないが、正しくない）。
 *
 * **人が手で入れた係数は上書きしない。**
 * 分子式から出せない値（実測や、法令が定める換算率）を上書きすると、
 * 直した意味が無くなる。
 *
 * **こちらは穴埋め。本命は `scripts/seed-metal-factors-list.ts`。**
 * LOLI には換算係数そのものの一覧（ListID 9533）があり、そちらを先に流す。
 * このスクリプトは、その一覧に載っていない CAS を分子式から埋めるために使う。
 * 順番を逆にすると、分子式から出した値が一覧の値を上書きしてしまう。
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { atomicWeightMap } from "./lib/atomic-weights";
import { elementFraction, parseFormula } from "./lib/formula";

const prisma = new PrismaClient();

/** この印が付いた係数は、このスクリプトが作ったもの。次回は作り直してよい */
const MARK = "LOLIの分子式から計算";
/** 上の印に続けて付ける。**正確な値ではない**ことを、後から探せるようにする */
const MARK_APPROX = "（概算）";

/**
 * 水和物の水を落とす。`Cl2Zn.xH2O` → `Cl2Zn`
 *
 * LOLI は水和水の数を `x` と書く（数が決まっていない、という意味）。
 * そのままでは計算できないので、**無水として計算する**。
 * 水のぶんだけ分母が小さくなるので、金属の割合は**実際より大きく**出る。
 *
 * **多めに出るのは、拾いすぎる向きの誤り。**0 として数えて見落とすよりはよい。
 * ただし正確ではないので、概算の印を付けて後から直せるようにする。
 */
function dropUnknownHydrate(formula: string): string | null {
  const parts = formula.split(".");
  const kept = parts.filter((p) => !/^x[A-Z]/.test(p.trim()));
  if (kept.length === parts.length || kept.length === 0) return null;
  return kept.join(".");
}

async function main() {
  const path = process.argv[2];
  const write = process.argv.includes("--write");
  if (!path || path.startsWith("--")) {
    throw new Error("分子式のTSVのパスを渡してください");
  }

  /*
    原子量はコードの側に持つ。元素マスタは「元素記号を手で入れるときの選択肢」を
    出すための一覧で、人が編集するもの。物理定数を混ぜない。
    1つでも欠けている元素が混ざったら計算しない（静かに間違えないため）。
  */
  const weights = atomicWeightMap();
  console.log(`原子量: ${weights.size}件`);

  // CAS → 分子式
  const formulaOf = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const [cas, formula] = line.split("\t");
    if (!cas || !formula) continue;
    const key = cas.trim().toUpperCase();
    if (key && !formulaOf.has(key)) formulaOf.set(key, formula.trim());
  }
  console.log(`分子式: ${formulaOf.size}件`);

  // どの CAS について、どの金属等の係数が要るか
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");

  const entries = await prisma.statutorySubstance.findMany({
    where: { aggregation: "ELEMENT", metalEtc: { not: null }, deletedAt: null },
    select: { id: true, metalEtc: true },
  });
  const links = await prisma.statutoryCasLink.findMany({
    where: {
      versionId: version.id,
      excluded: false,
      statutorySubstanceId: { in: entries.map((e) => e.id) },
    },
    select: { statutorySubstanceId: true, casNormalized: true },
  });
  const elementOf = new Map(entries.map((e) => [e.id, e.metalEtc as string]));

  /** 「CAS|金属等」で重複を除く */
  const wanted = new Map<string, { cas: string; element: string }>();
  for (const l of links) {
    const el = elementOf.get(l.statutorySubstanceId);
    if (!el) continue;
    wanted.set(`${l.casNormalized}|${el}`, { cas: l.casNormalized, element: el });
  }
  console.log(`要る「CAS × 金属等」: ${wanted.size}件`);

  // 人が入れたものは触らない
  const existing = await prisma.metalConversionFactor.findMany({
    where: { deletedAt: null },
    select: { id: true, casNormalized: true, metalElement: true, note: true },
  });
  const byKey = new Map(existing.map((f) => [`${f.casNormalized}|${f.metalElement}`, f]));

  const tally = {
    made: 0,
    updated: 0,
    kept: 0,
    noFormula: 0,
    unreadable: 0,
    notContained: 0,
    approx: 0,
  };
  const samples: string[] = [];

  for (const [key, w] of wanted) {
    const found = byKey.get(key);
    if (found && !(found.note ?? "").startsWith(MARK)) {
      // 人が入れたもの。触らない
      tally.kept += 1;
      continue;
    }

    const formula = formulaOf.get(w.cas.toUpperCase());
    if (!formula) {
      tally.noFormula += 1;
      continue;
    }
    /*
      そのままでは読めないものでも、水和水の数が分からないだけなら
      無水として計算できる（多めに出るが、0 にして見落とすよりよい）。
    */
    let used = formula;
    let approx = false;
    if (!parseFormula(used)) {
      const dry = dropUnknownHydrate(used);
      if (!dry || !parseFormula(dry)) {
        tally.unreadable += 1;
        continue;
      }
      used = dry;
      approx = true;
      tally.approx += 1;
    }
    const fraction = elementFraction(used, w.element, weights);
    if (fraction === null) {
      // 分子式にその元素が入っていない（紐づけ自体を疑う手がかりになる）
      tally.notContained += 1;
      continue;
    }

    const ratioPct = (fraction * 100).toFixed(6);
    if (samples.length < 8) {
      samples.push(`${w.cas} ${w.element} ${used}${approx ? "（無水として）" : ""} → ${ratioPct}%`);
    }

    if (write) {
      const data = {
        casNumber: w.cas,
        casNormalized: w.cas,
        metalElement: w.element,
        ratioPct,
        note: `${MARK}${approx ? MARK_APPROX : ""}（${formula}）`,
      };
      if (found) await prisma.metalConversionFactor.update({ where: { id: found.id }, data });
      else await prisma.metalConversionFactor.create({ data });
    }
    if (found) tally.updated += 1;
    else tally.made += 1;
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  新しく作る          : ${tally.made}件`);
  console.log(`  作り直す            : ${tally.updated}件`);
  console.log(`  人が入れたので触らない: ${tally.kept}件`);
  console.log(`  分子式がLOLIに無い  : ${tally.noFormula}件`);
  console.log(`  分子式が読めない    : ${tally.unreadable}件`);
  console.log(`  うち概算で入れた    : ${tally.approx}件（水和水の数が不明。無水として計算）`);
  console.log(`  分子式に金属等が無い : ${tally.notContained}件`);
  console.log("\n  例:");
  for (const s of samples) console.log(`    ${s}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
