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
 *
 * **条文が「どの号を元素で数えるか」を決めている法律は、名前で推し量らず条文の表で決める**
 * （`LAW_RULES`）。化管法は令第4条第1項第1号が 25 の号を挙げている（第8章 8-4）。
 * その法律では、表にある号だけを ELEMENT、それ以外の法文物質名は SUM にする。
 *
 *   npx tsx scripts/seed-aggregation.ts --law JP-PRTR --write   1つの法律だけ書き込む
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

/**
 * 条文で「元素の質量で数える」と決まっている号。法律コード → 号 → 元素記号。
 *
 * 化管法（JP-PRTR）: 令第4条第1項第1号 イ(1)〜(19) と ロ(1)〜(6)。ロの 6 号は特定第一種にも入る。
 * 番号は「令別表第1の353」の末尾の数。表に無い法文物質名は、その法文物質名としての合計（SUM）
 */
const LAW_RULES: Record<string, Map<number, string>> = {
  "JP-PRTR": new Map<number, string>([
    // イ
    [1, "Zn"],
    [48, "Sb"],
    [62, "In"],
    [105, "Ag"],
    [111, "Cr"],
    [156, "Co"],
    [164, "CN"],
    [272, "Hg"],
    [274, "Sn"],
    [276, "Ce"],
    [277, "Se"],
    [279, "Tl"],
    [311, "Te"],
    [314, "Cu"],
    [363, "V"],
    [414, "F"],
    [458, "B"],
    [465, "Mn"],
    [505, "Mo"],
    // ロ（すべて特定第一種でもある）
    [99, "Cd"],
    [112, "Cr"],
    [353, "Pb"],
    [355, "Ni"],
    [378, "As"],
    [444, "Be"],
  ]),
};

/** 「令別表第1の353」→ 353。**別表第一だけ**（第二種の「令別表第2の99」を 99 と読まない）。読めなければ null */
function itemNumber(officialNumber: string | null): number | null {
  const m = /別表第1の(\d+)\s*$/.exec(officialNumber ?? "");
  return m ? Number(m[1]) : null;
}

async function main() {
  const write = process.argv.includes("--write");
  const lawArg = process.argv.indexOf("--law");
  const lawCode = lawArg >= 0 ? (process.argv[lawArg + 1] ?? "").trim().toUpperCase() : null;
  if (lawArg >= 0 && !lawCode) throw new Error("--law の後に法律コードを書く（例 JP-PRTR）");

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
    where: {
      deletedAt: null,
      ...(lawCode ? { regulationClass: { category: { law: { codeNormalized: lawCode } } } } : {}),
    },
    select: {
      id: true,
      nameJa: true,
      nameOriginal: true,
      officialNumber: true,
      aggregation: true,
      regulationClass: {
        select: { category: { select: { law: { select: { codeNormalized: true } } } } },
      },
    },
  });
  if (lawCode) console.log(`対象の法律: ${lawCode}`);

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
    // 条文の表がある法律は、表だけで決める（名前では推し量らない）
    const rule = LAW_RULES[s.regulationClass.category.law.codeNormalized];
    if (rule) {
      const no = itemNumber(s.officialNumber);
      const symbol = no === null ? undefined : rule.get(no);
      if (symbol) asElement.push({ id: s.id, name, symbol });
      else asSum.push(s.id);
      continue;
    }
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
  console.log(
    "  ※ 係数が無い CAS は 0 として数え、その判定には要確認の印が付く（lib/judge-calc.ts）",
  );

  /*
    「化合物」と書いてあるのに元素として拾えなかったもの。
    シアン化合物のように元素が基準でないものと、
    アルキル水銀化合物のように**元素が基準かもしれない**ものが混ざる。
    後者は条文を読まないと決められないので、単純合算のままにして一覧に出す
    （単純合算は多めに出るので、見落としにはならない）。
  */
  const undecided = subs
    .filter((s) => !LAW_RULES[s.regulationClass.category.law.codeNormalized])
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
      data: { aggregation: "ELEMENT", metalEtc: e.symbol },
    });
  }
  await prisma.statutorySubstance.updateMany({
    where: { id: { in: asSum } },
    data: { aggregation: "SUM", metalEtc: null },
  });
  console.log("\n=== 書き込みました ===");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
