/**
 * 全製品を判定し直す管理用スクリプト。
 *
 * 実行:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/rejudge.ts
 *
 * 普段は組成を保存したときに自動で判定し直される。これを使うのは、
 *   - はじめて導入するとき
 *   - 法令のバージョン・閾値・CASの紐づけを入れ替えたとき（**判定の前提が変わる**）
 *   - 判定のしかたを直したとき
 *
 * 判定は法規制バージョンごとに持つ。作り直すのは現在の版の行だけで、別の版の行は残る。
 * 人の確認・上書きは、前提（当たる法文物質名とCAS）が同じなら引き継がれ、
 * 変わっていれば外れて要確認になる（apps/web/lib/judge-decision.ts）。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const { loadRules, loadFactors, judgeProduct } = await import("../apps/web/lib/judge-store");

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true, code: true, nameJa: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");
  console.log(`バージョン: ${version.code} ${version.nameJa ?? ""}`);

  const rules = await loadRules(version.id);
  const factors = await loadFactors();
  const { getAppSettings } = await import("../apps/web/lib/settings");
  const { conditionalLinkMode } = await getAppSettings();
  console.log(
    `条件つきCASリンクの扱い: ${conditionalLinkMode === "review" ? "要確認にして警告" : "該非を確定して警告"}`,
  );

  const withCas = rules.filter((r) => r.entries.some((e) => e.cas.length > 0));
  console.log(`区分 ${rules.length}件（うちCASが紐づいているもの ${withCas.length}件）`);
  console.log(`金属換算係数 ${factors.size}件`);

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  let applicable = 0;
  let review = 0;
  for (const p of products) {
    const r = await judgeProduct(p.id, rules, factors, conditionalLinkMode, version.id);
    if (r.applicable > 0) applicable += 1;
    if (r.needsReview > 0) review += 1;
  }
  console.log(
    `\n製品 ${products.length}件を判定しました\n` +
      `  どれかの区分に該当: ${applicable}件\n` +
      `  要確認が残るもの  : ${review}件`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
