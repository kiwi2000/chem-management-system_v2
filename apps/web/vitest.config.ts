import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * web 層のテスト設定。
 * ここで動かすのは「目視で確認できないもの」に限る（テスト戦略 Tier2）:
 *   - authz 呼び忘れ検出（全 route.ts の静的走査）
 *   - 設定の組み合わせで結果が変わる検証ロジック
 * UI コンポーネントのテストは書かない（都度のブラウザ確認が実質のテスト）。
 */
export default defineConfig({
  resolve: {
    // tsconfig の paths と同じ別名をテストでも使えるようにする
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
