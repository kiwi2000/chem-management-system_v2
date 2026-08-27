/**
 * データの整合性チェック（FR-AU-03）を回す管理用スクリプト。
 *
 * 実行:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/check-integrity.ts
 *
 * 判定は足りないデータがあっても止まらない作りにしてあるが、
 * **足りないままでよいわけではない。**放っておくと
 * 「換算したつもりで換算していない」判定が積み上がる。
 * データを入れたあとに必ず回して、欠陥を潰す。
 */
async function main() {
  const { checkIntegrity } = await import("../apps/web/lib/integrity");
  const report = await checkIntegrity();
  if (!report) {
    console.log("現在のバージョンが決まっていません");
    return;
  }

  console.log(`バージョン ${report.versionCode} を調べました`);
  console.log(`  換算係数が無い「CAS × 金属等」: ${report.totals.missingConversionFactor}件`);
  console.log(`  元素マスタに無い金属等        : ${report.totals.unknownConversionTarget}件`);

  const worst = report.issues.slice(0, 15);
  if (worst.length > 0) {
    console.log("\n=== 影響の大きいものから ===");
    for (const i of worst) {
      const label = i.kind === "missingConversionFactor" ? "係数なし" : "金属等が不明";
      console.log(`  [${label}] ${i.key}  （${i.count}件の法文物質名）`);
      for (const w of i.where) console.log(`      ${w.slice(0, 44)}`);
    }
  }
  if (report.issues.length > worst.length) {
    console.log(`\n  ほか ${report.issues.length - worst.length} 件`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
