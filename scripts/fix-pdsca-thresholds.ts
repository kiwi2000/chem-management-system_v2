/**
 * 毒劇法の「ただし〇％以下を含有するものを除く」を、閾値の下限にする。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/fix-pdsca-thresholds.ts [--write]
 *
 * ## なぜ閾値に入れるのか（2026-09-02 利用者の判断）
 *
 * 毒物及び劇物指定令は「〇・一％以下を含有するものを除く」と**明確に除いている**。
 * これまでは備考に文章として置くだけで、判定は「0を超えれば該当」のままだった。
 * つまり**法令より厳しく該当**していた。
 *
 * 過剰な該当は安全側に見えるが、そうとは限らない。
 * **0.1%以下のときに別の規制区分へ当たることがあり**、そこでこちらにも当ててしまうと、
 * どの規制がかかっているのかが読めなくなる。
 *
 * ## 読み取りの決まり
 *
 * 対象は「ただし … 〇％以下 … 除く」の形だけ。**1つの備考に％が1つだけ**のものに限る。
 * 数字は位取りの漢数字（`一〇` は 10、`〇・〇〇五` は 0.005）。
 * **`十` `百` が出てきたら読まない。**位取りと混ざると桁を取り違えるため。
 * 読めなかったものは触らずに一覧へ出す。
 *
 * 下限は「その値を**超えたら**該当」（`0.1 < x`）。「以下は除く」の裏返し。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 位取りの漢数字。`十` `百` は入れない（出てきたら読まないため） */
const DIGIT: Record<string, string> = {
  "〇": "0",
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

/** 漢数字の割合を数にする。読めなければ null */
function toNumber(src: string): string | null {
  let out = "";
  for (const ch of src) {
    if (DIGIT[ch]) out += DIGIT[ch];
    else if (ch === "・" || ch === "．" || ch === ".") out += ".";
    else if (ch >= "0" && ch <= "9") out += ch;
    else if (ch >= "０" && ch <= "９") out += String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    else return null;
  }
  return /^\d+(\.\d{1,6})?$/.test(out) ? out : null;
}

/** 備考から除外の割合を切り出す。**1つだけ**書かれているときに限る */
function excludedPct(note: string): { value: string; raw: string } | null {
  if (!note.includes("除く")) return null;
  const hits = [...note.matchAll(/([〇一二三四五六七八九十百・．\d０-９]+)\s*(?:％|%)\s*以下/g)];
  if (hits.length !== 1) return null;
  const raw = hits[0]![1]!;
  const value = toNumber(raw);
  return value === null ? null : { value, raw };
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const rows = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: { category: { law: { code: "JP-PDSCA" } } },
      note: { contains: "除く" },
    },
    select: {
      id: true,
      officialNumber: true,
      nameOriginal: true,
      note: true,
      thresholdLower: true,
      lowerBound: true,
    },
    orderBy: { displayOrder: "asc" },
  });

  const skipped: string[] = [];
  let changed = 0;
  let already = 0;

  for (const r of rows) {
    const found = excludedPct(r.note ?? "");
    if (!found) {
      skipped.push(`${r.officialNumber}  ${(r.note ?? "").slice(0, 60)}`);
      continue;
    }
    if (r.thresholdLower.equals(found.value) && r.lowerBound === "EXCLUSIVE") {
      already += 1;
      continue;
    }
    console.log(
      `  ${r.officialNumber?.padEnd(18)} ${found.raw}％以下を除く → ${found.value} < x   ${(r.nameOriginal ?? "").slice(0, 22)}`,
    );
    if (write) {
      await prisma.statutorySubstance.update({
        where: { id: r.id },
        data: { thresholdLower: found.value, lowerBound: "EXCLUSIVE" },
      });
    }
    changed += 1;
  }

  console.log(
    write
      ? `\n直しました: ${changed}件（すでに直っている ${already}件）`
      : `\n下見だけ。直すなら --write（対象 ${changed}件 / すでに直っている ${already}件）`,
  );
  if (skipped.length > 0) {
    console.log(`\n**読めなかったので触っていないもの: ${skipped.length}件**`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
