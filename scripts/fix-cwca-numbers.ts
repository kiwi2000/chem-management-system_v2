/**
 * 化学兵器禁止法の法文物質名の番号に「項」を入れる。
 *
 * 別表は 一の項＝特定物質・二の項＝第1種指定物質・三の項＝第2種指定物質で、
 * **どの項にも第三欄(1)・第四欄(1)がある。**項を書かないと番号が一意にならず、
 * CHRIP の `政令別表2項第4欄の(1)` とも当てられなかった。
 *
 *   令別表第3欄(1)  → 令別表第1項第3欄(1)   （特定物質）
 *   令別表第4欄(1)  → 令別表第2項第4欄(1)   （第1種指定物質）
 *
 * **入れ直しはしない。**法文物質名には CASリンクと判定がぶら下がっているので、
 * 番号と業務キーだけを書き換える。何度流しても同じ結果になる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/fix-cwca-numbers.ts [--write]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 区分コード → 別表の項。**条文の並び順そのもの** */
const PARAGRAPH: Record<string, string> = {
  SPECIFIED: "1",
  DESIG1: "2",
  DESIG2: "3",
};

async function main() {
  const write = process.argv.includes("--write");

  const rows = await prisma.statutorySubstance.findMany({
    where: { regulationClass: { category: { law: { code: "JP-CWCA" } } } },
    select: {
      id: true,
      code: true,
      officialNumber: true,
      nameOriginal: true,
      regulationClass: { select: { category: { select: { code: true } } } },
    },
    orderBy: { displayOrder: "asc" },
  });

  let done = 0;
  let already = 0;
  for (const r of rows) {
    const cat = r.regulationClass.category.code;
    const para = PARAGRAPH[cat];
    if (!para) throw new Error(`項が分からない区分: ${cat}`);

    const m = /^令別表第(\d+)欄\((\d+)\)$/.exec(r.officialNumber ?? "");
    if (!m) {
      already += 1;
      continue;
    }
    const [, col, num] = m;
    const officialNumber = `令別表第${para}項第${col}欄(${num})`;
    // 業務キーも投入スクリプトと同じ形に合わせる（`JP-CWCA-SPECIFIED-3-一` → `…-一-3-一`）
    const code = r.code.replace(
      new RegExp(`^(JP-CWCA-${cat}-)(${col}-)`),
      `$1${"一二三"[Number(para) - 1]}-$2`,
    );

    console.log(
      `  ${r.officialNumber} → ${officialNumber}  ${(r.nameOriginal ?? "").slice(0, 20)}`,
    );
    if (write) {
      await prisma.statutorySubstance.update({
        where: { id: r.id },
        data: { officialNumber, code, codeNormalized: code },
      });
    }
    done += 1;
  }

  console.log(
    write
      ? `\n直しました: ${done}件（すでに項がある ${already}件）`
      : `\n下見だけ。直すなら --write（対象 ${done}件 / すでに項がある ${already}件）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
