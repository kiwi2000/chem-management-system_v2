/**
 * 化審法の法文物質名を、法令の原文に合わせて直す。
 *
 *   npx tsx scripts/fix-cscl-names.ts          下見
 *   npx tsx scripts/fix-cscl-names.ts --write  書き込む
 *
 * **原文が最も正しい。**直してよいのは漢数字を算用数字にすることだけで、
 * 語そのものは書き換えない（`docs/法規制データの作り方.md` 第3章）。
 *
 * ここで直すのは、**J-CHECK から写したときに原文と食い違ったもの**。
 * J-CHECK は NITE が読みやすく書き直した二次資料で、
 * ギリシャ文字や `tert` はそこで入った書き換えだった。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Fix {
  /** 政令番号 */
  number: string;
  /** 直す前（登録されている名前の一部） */
  from: string;
  /** 直したあと（原文の書き方） */
  to: string;
  /** なぜ直すか。記録として残す */
  why: string;
}

const FIXES: Fix[] = [
  {
    number: "16",
    from: "ジ－ｔｅｒｔ－ブチルフェノール",
    to: "ジ－ターシャリ－ブチルフェノール",
    why: "原文は「ターシャリ」。同じ政令の11号・38号も「ターシャリ」で、16号だけ J-CHECK の書き方（ｔｅｒｔ）が入っていた",
  },
  {
    number: "20",
    from: "（別名α－ヘキサクロロシクロヘキサン）",
    to: "（別名アルファ－ヘキサクロロシクロヘキサン）",
    why: "原文はカタカナ。厚労省もカタカナ（アルファ-メチルスチレン）。ギリシャ文字は J-CHECK だけ",
  },
  {
    number: "21",
    from: "（別名β－ヘキサクロロシクロヘキサン）",
    to: "（別名ベータ－ヘキサクロロシクロヘキサン）",
    why: "20号と同じ",
  },
  {
    number: "22",
    from: "（別名γ－ヘキサクロロシクロヘキサン又はリンデン）",
    to: "（別名ガンマ－ヘキサクロロシクロヘキサン）",
    why: "原文はカタカナ。**「又はリンデン」は原文に無い**（施行令の全文に「リンデン」は0件）。J-CHECK が足したもの",
  },
];

async function main() {
  const write = process.argv.includes("--write");
  const tally = { done: 0, skipped: 0, missing: 0 };

  for (const fix of FIXES) {
    const rows = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        officialNumber: fix.number,
        regulationClass: { category: { code: "C1", law: { code: "JP-CSCL" } } },
      },
      select: { id: true, nameJa: true, nameOriginal: true },
    });
    if (rows.length === 0) {
      console.log(`  ✗ ${fix.number}号 が見つかりません`);
      tally.missing += 1;
      continue;
    }
    for (const row of rows) {
      // 名前は name_original に入っている。name_ja は空のことが多い
      const before = row.nameOriginal;
      if (!before.includes(fix.from)) {
        console.log(`  － ${fix.number}号 は直す必要がありません`);
        tally.skipped += 1;
        continue;
      }
      const after = before.replace(fix.from, fix.to);
      console.log(`  ${fix.number}号`);
      console.log(`    前: ${before}`);
      console.log(`    後: ${after}`);
      console.log(`    理由: ${fix.why}`);
      tally.done += 1;
      if (write) {
        await prisma.statutorySubstance.update({
          where: { id: row.id },
          data: {
            nameOriginal: after,
            // name_ja が入っているときは、そちらも同じように直す
            ...(row.nameJa ? { nameJa: row.nameJa.replace(fix.from, fix.to) } : {}),
          },
        });
      }
    }
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  直す        : ${tally.done}件`);
  console.log(`  直す必要なし: ${tally.skipped}件`);
  console.log(`  見つからない: ${tally.missing}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
