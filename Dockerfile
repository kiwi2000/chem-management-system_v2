# 本番用イメージ（Next.jsアプリ＋PDF変換用LibreOffice同梱・Q-DOC4）
# ビルド:   docker compose -f compose.prod.yml --env-file .env.prod build

FROM node:22-slim

# LibreOffice（PDF変換）＋日本語フォント＋Prisma実行に必要なOpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
      libreoffice-writer fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存レイヤ（package.json 群のみ先にコピーしてDockerキャッシュを効かせる）
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

# ソースコピー → Prismaクライアント生成 → 本番ビルド
# 認証は自前実装のため、ビルド時に外部サービスの設定を焼き込む必要はない
COPY . .
RUN npx prisma generate && npm run build -w apps/web

ENV NODE_ENV=production
EXPOSE 3000

# 起動時にマイグレーションを適用（冪等）してからアプリを開始
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start -w apps/web"]
