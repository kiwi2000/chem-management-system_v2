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
      "out/**", // 配布物の組み立て場所（out/install-set にアプリの写しができる）
      "**/coverage/**",
      "**/*.tsbuildinfo",
      "**/next-env.d.ts", // Next.js の自動生成ファイル
      "docs/**",
      ".cache/**", // 作業用スクリプトの置き場（git 管理外）
      ".claude/worktrees/**", // 作業用の別ツリー（本体と同じソースの写し）
      "apps/web/modules/*.generated.ts", // scripts/gen-modules.mjs が作る差込口の一覧
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
    /*
      本体からモジュール（apps/web/modules/<id>/）を直接 import しない。
      結び目は gen-modules.mjs が作る一覧だけ。直接読むと、モジュールを外した配布物でビルドが落ちるか、
      外したはずのコードが本体に残る
    */
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/modules/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/modules/*",
                "@/modules/*/**",
                "**/modules/*/**",
                "!@/modules/types",
                "!@/modules/registry.generated",
                "!@/modules/registry.server.generated",
              ],
              message:
                "モジュールは差込口（@/modules/registry.generated / registry.server.generated）を通して使う。直接 import しない",
            },
          ],
        },
      ],
    },
  },
  {
    // 運用スクリプトは console 出力が本体
    files: ["scripts/**/*.ts", "scripts/**/*.mjs", "prisma/**/*.ts"],
    rules: { "no-console": "off" },
  },
  prettierConfig,
);
