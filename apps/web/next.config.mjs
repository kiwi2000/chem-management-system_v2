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

  // 開発時に画面の左下へ出る Next.js のボタンを消す。
  // 画面の見た目を確認するときに邪魔になるため（本番には元から出ない）。
  devIndicators: false,

  // 使っている技術を外に知らせない（X-Powered-By: Next.js を出さない）
  poweredByHeader: false,

  /*
    どの応答にも付ける守りのヘッダ。
    中身の実行を縛る Content-Security-Policy だけは、要求ごとに違う印（nonce）を
    埋める必要があるので middleware.ts の側で付ける。
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // 一度 HTTPS で来た相手には、以後 HTTP を使わせない
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          // 中身の種類を勝手に推測して別物として実行させない
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 別のサイトに埋め込ませない（クリックのすり替えを防ぐ）
          { key: "X-Frame-Options", value: "DENY" },
          // 外部へ移るとき、どの画面から来たかを渡さない
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 使わない端末機能は閉じておく
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
