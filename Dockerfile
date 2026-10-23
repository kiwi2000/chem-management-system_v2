# 本番用イメージ（Next.jsアプリ＋帳票の PDF 化に使う Chromium 同梱）
# ビルド:   docker compose -f compose.prod.yml --env-file .env.prod build

# 土台は版まで書く（2026-10-22。「24 系の最新」の指定だと、ビルドする側が古い写しを使い回したときに
# どの版で組まれたか外から分からない）。Node.js のセキュリティ更新が出たら、ここと
# scripts/build-install-set.ps1 の MSI を一緒に上げる
FROM node:24.22.1-slim

# 日本語フォント＋Prisma実行に必要なOpenSSL。
# OS の部品も、組むたびにセキュリティ更新を当てる（土台の写しが出たあとの修正を取り込む）
RUN apt-get update && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
      fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存レイヤ（package.json 群のみ先にコピーしてDockerキャッシュを効かせる）
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

# 帳票の PDF 化に使う Chromium（Playwright）。イメージに焼き込み、実行時に外へは出ない。
# 共有ライブラリも一緒に入れる（--with-deps）。置き場所は PLAYWRIGHT_BROWSERS_PATH（実行時も同じ値を使う）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

# ソースコピー → Prismaクライアント生成 → 本番ビルド
# 認証は自前実装のため、ビルド時に外部サービスの設定を焼き込む必要はない
COPY . .
# 差込口で足すモジュール（例: sds）。Railway ではサービスの変数、手元では --build-arg で渡す。
# 空なら本体だけを組む（モジュールのコードはビルドに入らない）。scripts/gen-modules.mjs が読む
ARG CHEM_MODULES=""
ENV CHEM_MODULES=$CHEM_MODULES
RUN npx prisma generate && npm run build -w apps/web

# 組んだ版をビルドの記録に出す（反映を確かめるため。Railway のビルドの記録で読める）
RUN echo "versions: node $(node -v) / npm $(npm -v) / next $(node -p "require('next/package.json').version") / react $(node -p "require('react/package.json').version") / prisma $(node -p "require('prisma/package.json').version") / playwright $(node -p "require('playwright/package.json').version") / openssl $(openssl version | cut -d' ' -f2)"

ENV NODE_ENV=production
# apps/web/package.json の start が 3001 で待つ（Caddyfile の reverse_proxy と合わせる）
EXPOSE 3001

# 起動時にマイグレーションを適用（冪等）してからアプリを開始
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start -w apps/web"]
