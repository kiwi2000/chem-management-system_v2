/**
 * 毒劇法の但し書きから閾値を取り出して、判定に使う欄へ入れる管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-dokugeki-thresholds.ts --dry   何をするかだけ出す（既定）
 *   npx tsx scripts/seed-dokugeki-thresholds.ts --write  実際に書き込む
 *
 * なぜ要るのか。
 * 毒劇法の法文物質名は588件あり、そのうち167件に
 * 「ただし、〜％以下を含有するものを除く。」という但し書きが付いている。
 * ところが**その数字は備考の文章の中にしか無く、判定に使う閾値の欄は初期値のまま**。
 * このままだと、判定を作ったときに
 * 「本当は該当しない濃度のものを、該当すると答える」ことになる。
 * しかも備考には正しいことが書いてあるので、画面を見ても気づけない。
 *
 * 埋めかた。
 *   「〇・一％以下を除く」→ 下限 0.1（超える）〜 上限 100（含む）
 * 「以下を除く」なので、境目そのものは**該当しない**。だから下限は EXCLUSIVE。
 *
 * 埋めないもの。
 *   - 但し書きが名指ししている物質が、その法文物質名と違うもの
 *   - 「次に掲げるものを除く」で別の物質が並ぶもの
 * どちらも1つの閾値では表せない。**間違った数字を入れるより、入れないほうがよい。**
 * 入れなければ「全部該当」の側に倒れるので、見落としにはならない。
 */
import { PrismaClient } from "@prisma/client";
import { parseExclusion, sameSubstance } from "./lib/law-threshold";

const prisma = new PrismaClient();

/** 条件つきで埋めたものに付ける目印。あとから探せるようにする */
/**
 * 濃度のほかの条件は、**備考ではなく「適用条件」の欄へ書く。**
 * この欄に何か入っていれば、判定は当たったときに必ず要確認を出す。
 * 以前は備考にこの目印を書いていたが、備考には取り込み元の付随情報も入るため分けた
 */
const CONDITION_PREFIX = "除外には条件が付く: ";
/** 埋めなかったものに付ける目印 */
const MARK_UNFILLED = "【閾値未設定】";

async function main() {
  const write = process.argv.includes("--write");

  const law = await prisma.law.findFirst({ where: { code: "JP-PDSCA" }, select: { id: true } });
  if (!law) throw new Error("毒劇法が見つかりません");
  const cats = await prisma.regulationCategory.findMany({
    where: { lawId: law.id },
    select: { id: true },
  });
  const classes = await prisma.regulationClass.findMany({
    where: { categoryId: { in: cats.map((c) => c.id) } },
    select: { id: true },
  });
  const subs = await prisma.statutorySubstance.findMany({
    where: { classId: { in: classes.map((c) => c.id) } },
    select: {
      id: true,
      nameJa: true,
      nameOriginal: true,
      note: true,
      applicableCondition: true,
      thresholdLower: true,
      thresholdUpper: true,
    },
  });

  const tally = { simple: 0, conditional: 0, unfilledOther: 0, unfilledList: 0, skipped: 0 };

  for (const s of subs) {
    if (!s.note || !/[%％]/.test(s.note)) continue;
    const name = s.nameJa ?? s.nameOriginal;
    const e = parseExclusion(s.note);

    // 既に人が手で入れたものは触らない。上書きすると、直した意味が無くなる
    if (Number(s.thresholdLower) !== 0 || Number(s.thresholdUpper) !== 100) {
      tally.skipped += 1;
      continue;
    }

    const notes: string[] = [];
    let fill: number | null = null;
    /** 適用条件。書き込むのは条件が見つかったときだけ（無いものは触らない） */
    let condition: string | null = null;

    if (e.kind === "list") {
      tally.unfilledList += 1;
      notes.push(`${MARK_UNFILLED} 別の物質が列挙して除外されており、1つの閾値では表せない`);
    } else if (e.pct === null || !sameSubstance(name, e.subject)) {
      tally.unfilledOther += 1;
      notes.push(
        `${MARK_UNFILLED} 但し書きが除外しているのは「${e.subject ?? "?"}」で、この法文物質名とは別のもの`,
      );
    } else {
      fill = e.pct;
      if (e.condition) {
        tally.conditional += 1;
        // 濃度だけでは決まらない。判定に使う前に、必ず条件を見る
        condition = `${CONDITION_PREFIX}${e.condition}`;
        if (e.microPct !== null) {
          // 緩いほう（マイクロカプセル）を採ると、該当を見落とす。厳しいほうを入れる
          notes.push(
            `マイクロカプセル製剤は ${e.microPct}％以下が除外。閾値は厳しいほうを入れてある`,
          );
        }
      } else {
        tally.simple += 1;
      }
    }

    const note = appendNotes(s.note, notes);
    const changed = note !== s.note || fill !== null || condition !== s.applicableCondition;
    if (!changed) continue;

    if (write) {
      await prisma.statutorySubstance.update({
        where: { id: s.id },
        data: {
          ...(fill !== null
            ? {
                thresholdLower: fill,
                // 「〜％以下を除く」なので、境目そのものは該当しない
                lowerBound: "EXCLUSIVE",
                thresholdUpper: 100,
                upperBound: "INCLUSIVE",
              }
            : {}),
          note,
          ...(condition === null ? {} : { applicableCondition: condition }),
        },
      });
    }
  }

  console.log(write ? "=== 書き込みました ===" : "=== 下見（--write で実行） ===");
  console.log(`  閾値を入れた（条件なし）: ${tally.simple}件`);
  console.log(`  閾値を入れた（条件つき）: ${tally.conditional}件`);
  console.log(`  入れなかった（別物質）  : ${tally.unfilledOther}件`);
  console.log(`  入れなかった（列挙）    : ${tally.unfilledList}件`);
  console.log(`  既に値があるので触らず  : ${tally.skipped}件`);
  await prisma.$disconnect();
}

/** 備考に書き足す。同じ目印の行が既にあれば入れ直す（何度実行しても増えない） */
function appendNotes(note: string, lines: string[]): string {
  const kept = note
    .split("\n")
    .filter((l) => !l.startsWith(MARK_UNFILLED))
    .join("\n")
    .trimEnd();
  return lines.length === 0 ? kept : `${kept}\n${lines.join("\n")}`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
