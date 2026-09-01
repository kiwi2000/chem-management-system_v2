/**
 * 安衛法の製造許可物質に「石綿分析用試料等」を足す。
 *
 * 令第17条は「別表第三第一号に掲げる第一類物質**及び石綿分析用試料等**」と書いている。
 * こちらは別表第三第一号の7件しか取っておらず、条文が直接名指ししている1件が抜けていた。
 *
 * **入れ直しはしない。**ほかの法文物質名には CASリンクと判定がぶら下がっているので、
 * この1件だけを足す。何度流しても増えない。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-anei-asbestos.ts [--write]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CODE = "JP-ISHA-PERMIT-MFG_PERMIT-令第17条";
const NAME = "石綿分析用試料等";
const NUMBER = "令第17条";
const NOTE =
  "出典: 令第17条（別表第3第1号のほかに条文が名指ししている）/ 令第16条第1項第4号イからハまでの石綿を重量の0.1%を超えて含有するもの";

async function main() {
  const write = process.argv.includes("--write");

  const sibling = await prisma.statutorySubstance.findFirst({
    where: { regulationClass: { category: { law: { code: "JP-ISHA" }, code: "MFG_PERMIT" } } },
    orderBy: { displayOrder: "desc" },
    select: {
      classId: true,
      displayOrder: true,
      aggregation: true,
      thresholdLower: true,
      lowerBound: true,
      thresholdUpper: true,
      upperBound: true,
    },
  });
  if (!sibling) throw new Error("製造許可物質が見つかりません。先に seed-anei を流してください");

  const already = await prisma.statutorySubstance.findFirst({
    where: { classId: sibling.classId, nameOriginal: NAME },
    select: { id: true, officialNumber: true },
  });
  if (already) {
    console.log(`すでにあります（${already.officialNumber} ${NAME}）。何もしません`);
    return;
  }

  console.log(`  足す: ${NUMBER}「${NAME}」（閾値はほかの製造許可物質と同じ）`);
  if (!write) {
    console.log("\n下見だけ。足すなら --write");
    return;
  }

  await prisma.statutorySubstance.create({
    data: {
      code: CODE,
      codeNormalized: CODE,
      classId: sibling.classId,
      officialNumber: NUMBER,
      nameOriginal: NAME,
      nameLang: "JA",
      nameEn: "Asbestos samples for analysis",
      displayOrder: sibling.displayOrder + 1,
      note: NOTE,
      aggregation: sibling.aggregation,
      thresholdLower: sibling.thresholdLower,
      lowerBound: sibling.lowerBound,
      thresholdUpper: sibling.thresholdUpper,
      upperBound: sibling.upperBound,
    },
  });
  console.log("\n足しました: 1件");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
