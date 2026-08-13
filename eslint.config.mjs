import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config。
 * 目的は「型で拾えない事故（未使用変数・await忘れ・Hooks違反）を早期に出すこと」。
 * スタイル面は Prettier に任せる（eslint-config-prettier で衝突ルールを無効化）。
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "**/next-env.d.ts", // Next.js の自動生成ファイル
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 引数の未使用は _ 始まりで許可（Next.js の handler で頻出）
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 意図しない Promise の放置を防ぐ（fetch/DB 呼び出しの await 忘れ対策）
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      // Pages Router 専用のルール。App Router のみの構成では pages/ が無く誤検知する
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // 運用スクリプトは console 出力が本体
    files: ["scripts/**/*.ts", "prisma/**/*.ts"],
    rules: { "no-console": "off" },
  },
  prettierConfig,
);
