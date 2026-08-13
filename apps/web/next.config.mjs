import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * monorepo ルートの .env を読み込む（Next.js は apps/web 直下しか自動読込しないため）。
 * 既に設定済みの環境変数は上書きしない。
 */
function loadRootEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {
    // .env が無い環境（CI等）は環境変数側で設定される想定
  }
}
loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // monorepo 内の TypeScript パッケージをそのままビルド対象にする
  // （@chem/domain は判定エンジン実装時=S12 に追加する）
  transpilePackages: ["@chem/shared"],

  // ESLint はリポジトリルートの eslint.config.mjs で `npm run lint` として実行する。
  // next build 内蔵の lint はルート設定を検出できず警告を出すだけなので無効化する。
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
