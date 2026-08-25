/**
 * 法文物質名の「まとめかた」を設定する管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-aggregation.ts          下見（書き込まない）
 *   npx tsx scripts/seed-aggregation.ts --write  書き込む
 *
 * なぜ要るのか。
 * 法令の閾値は「**その法文物質名として**何％含まれているか」に対して定められている。
 * 1つの法文物質名に複数の CAS が紐づくことは普通にあり（6,026件中3,484件）、
 * それらを合計しないと**該当を見落とす**。
 *
 *   例）鉛 0.06％ ＋ 酸化鉛 0.06％
 *       CASごとに見れば、どちらも 0.1％ に届かず「非該当」
 *       合計すれば 0.12％ で「該当」
 *
 * 金属などの「〇〇及びその化合物」は、**その元素として**何％かが基準になる。
 * だから単純に足すのではなく、金属換算係数を掛けてから足す（ELEMENT）。
 *
 *   例）酸化鉛 0.06％ は、鉛としては 0.056％（酸化鉛の鉛含有率 92.83％）
 *
 * 元素名は法文物質名の頭から拾う。**元素の欄に書き込むのはここだけ**で、
 * 判定はその欄だけを見る（名前を毎回読み直すと、判定のたびに結果が変わりうる）。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 元素として数えない「〇〇化合物」。
 *
 * 元素名で始まっていても、**その元素の量が基準ではない**ものを除く。
 * 有機化合物の総称は、元素の含有率で測るものではない。
 */
const NOT_ELEMENT = [/^炭素/, /^水素/, /^酸素/, /^窒素/, /^硫黄/];

/**
 * 法令の書きかたと、元素マスタの名前の食い違いを埋める表。
 *
 * 法文は「砒素」「弗素」「すず」のように、元素マスタとは別の字で書かれている。
 * **ここで拾えないと、元素として数えるべきものが単純合算になる**（多めに出るが正しくない）。
 * 実際に法文へ出てきたものだけを並べる（当て推量で広げると、別物を拾う）。
 */
const ALIAS: { pattern: RegExp; symbol: string }[] = [
  { pattern: /^砒素/, symbol: "As" },
  { pattern: /^ひ素/, symbol: "As" },
  { pattern: /^弗素/, symbol: "F" },
  { pattern: /^ふっ素/, symbol: "F" },
  { pattern: /^すず/, symbol: "Sn" },
  { pattern: /^ほう素/, symbol: "B" },
  { pattern: /^硼素/, symbol: "B" },
  // 「六価クロム化合物」「無機マンガン化合物」のように、頭に語が付くもの
  { pattern: /^(六価|三価)?クロム/, symbol: "Cr" },
  { pattern: /^(無機|有機)?マンガン/, symbol: "Mn" },
  { pattern: /^(可溶性)?ウラン/, symbol: "U" },
  { pattern: /^ニツケル/, symbol: "Ni" },
];

async function main() {
  const write = process.argv.includes("--write");

  const elements = await prisma.element.findMany({
    where: { deletedAt: null },
    select: { symbol: true, nameJa: true },
  });
  // 長い名前から先に照合する（「アンチモン」が「アン…」で切れないように）
  const byLength = [...elements].sort((a, b) => b.nameJa.length - a.nameJa.length);

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");

  const subs = await prisma.statutorySubstance.findMany({
    where: { deletedAt: null },
    select: { id: true, nameJa: true, nameOriginal: true, aggregation: true },
  });

  const links = await prisma.statutoryCasLink.findMany({
    where: { versionId: version.id, excluded: false },
    select: { statutorySubstanceId: true, casNormalized: true },
  });
  const casOf = new Map<string, Set<string>>();
  for (const l of links) {
    const set = casOf.get(l.statutorySubstanceId) ?? new Set<string>();
    set.add(l.casNormalized);
    casOf.set(l.statutorySubstanceId, set);
  }

  /** 元素として数えるものと、その元素記号 */
  const asElement: { id: string; name: string; symbol: string }[] = [];
  const asSum: string[] = [];

  for (const s of subs) {
    const name = s.nameJa ?? s.nameOriginal;
    const looksElement = /化合物/.test(name) && !NOT_ELEMENT.some((re) => re.test(name));
    // 元素マスタの名前で拾えないものは、法文の書きかたの表で補う
    const symbol = !looksElement
      ? undefined
      : (byLength.find((e) => name.startsWith(e.nameJa))?.symbol ??
        ALIAS.find((a) => a.pattern.test(name))?.symbol);
    if (symbol) asElement.push({ id: s.id, name, symbol });
    else asSum.push(s.id);
  }

  console.log(`法文物質名 ${subs.length}件`);
  console.log(`  元素として合算（ELEMENT）: ${asElement.length}件`);
  console.log(`  そのまま合算（SUM）      : ${asSum.length}件`);

  console.log("\n=== 元素として合算するもの（全件） ===");
  for (const e of asElement) {
    const n = casOf.get(e.id)?.size ?? 0;
    console.log(`  ${e.symbol.padEnd(3)} CAS${String(n).padStart(4)}件  ${e.name.slice(0, 40)}`);
  }

  // 換算係数が足りない組み合わせを洗い出す（後で埋める作業リストになる）
  const factors = await prisma.metalConversionFactor.findMany({
    where: { deletedAt: null },
    select: { casNormalized: true, metalElement: true },
  });
  const have = new Set(factors.map((f) => `${f.casNormalized}|${f.metalElement}`));
  const missing = new Set<string>();
  for (const e of asElement) {
    for (const cas of casOf.get(e.id) ?? []) {
      const key = `${cas}|${e.symbol}`;
      if (!have.has(key)) missing.add(key);
    }
  }
  console.log(`\n換算係数が足りない「CAS × 元素」: ${missing.size}件（登録済み ${have.size}件）`);
  console.log("  ※ 係数が無いものは、そのままの値で数える（多めに見積もる＝見落とさない側）");

  /*
    「化合物」と書いてあるのに元素として拾えなかったもの。
    シアン化合物のように元素が基準でないものと、
    アルキル水銀化合物のように**元素が基準かもしれない**ものが混ざる。
    後者は条文を読まないと決められないので、単純合算のままにして一覧に出す
    （単純合算は多めに出るので、見落としにはならない）。
  */
  const undecided = subs
    .map((s) => s.nameJa ?? s.nameOriginal)
    .filter((n) => /化合物/.test(n) && !NOT_ELEMENT.some((re) => re.test(n)))
    .filter(
      (n) => !byLength.find((e) => n.startsWith(e.nameJa)) && !ALIAS.find((a) => a.pattern.test(n)),
    );
  const uniqUndecided = [...new Set(undecided.map((n) => n.slice(0, 60)))];
  console.log(`
=== 元素として数えるか、人の判断が要るもの: ${uniqUndecided.length}種類 ===`);
  console.log("  （いまは単純合算。多めに出るので見落としにはならない）");
  for (const n of uniqUndecided) console.log(`  ${n}`);

  if (!write) {
    console.log("\n=== 下見でした（--write で書き込みます） ===");
    await prisma.$disconnect();
    return;
  }

  for (const e of asElement) {
    await prisma.statutorySubstance.update({
      where: { id: e.id },
      data: { aggregation: "ELEMENT", aggregationElement: e.symbol },
    });
  }
  await prisma.statutorySubstance.updateMany({
    where: { id: { in: asSum } },
    data: { aggregation: "SUM", aggregationElement: null },
  });
  console.log("\n=== 書き込みました ===");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
