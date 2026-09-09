#!/usr/bin/env bash
# お客さんへ渡す配布物を作る（社内サーバー導入手順書の「こちらからお渡しするファイル」）。
#
#   bash scripts/package-release.sh                 いまのコミットから out/ に作る
#   bash scripts/package-release.sh 1.0.0           版を指定する（省くと package.json の version）
#   bash scripts/package-release.sh 1.0.0 --images  Docker イメージのファイルも作る（docker が要る。時間がかかる）
#
# できるもの（out/ は git に入らない）:
#   chem-system-<版>.tar.gz   Linux 用。アプリ本体と起動用の設定。/opt/chem に展開する
#   chem-system-<版>.zip      Windows Server 用。中身は同じ。C:\chem に展開する
#   chem-images-<版>.tar      --images のとき。app / caddy / postgres のイメージ（オフラインのサーバー向け）
#
# **コミット済みのものだけが入る**（git archive）。作業ツリーの直しかけは入らない。
# **入れないもの**: docs/（社内の記録）、scripts/data/ と投入スクリプト（LOLI・CHRIP 由来のデータ。
# 契約上お客さんへは渡せない。法規制データは別の手順で投入する）、.env（秘密）、node_modules と .next（作り直す）。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

VERSION="${1:-}"
if [[ "$VERSION" == "--images" || -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi
WITH_IMAGES=0
for a in "$@"; do [[ "$a" == "--images" ]] && WITH_IMAGES=1; done

OUT_DIR="$REPO_DIR/out"
mkdir -p "$OUT_DIR"

# 配布物に入れるもの。足すときは導入手順書の手順（展開 → 起動 → 管理者作成 → バックアップ）で要るかを考える
INCLUDE=(
  package.json
  package-lock.json
  tsconfig.base.json
  .dockerignore
  .env.prod.example
  Dockerfile
  compose.prod.yml
  deploy
  apps
  packages
  prisma
  scripts/backup-db.sh
  scripts/backup-db.ps1
  scripts/set-password.ts
  scripts/grant-permission.ts
)

if [[ -n "$(git status --porcelain -- "${INCLUDE[@]}")" ]]; then
  echo "注意: 配布物に入るファイルに、コミットしていない変更があります（入りません）" >&2
  git status --short -- "${INCLUDE[@]}" >&2
fi

TGZ="$OUT_DIR/chem-system-$VERSION.tar.gz"
ZIP="$OUT_DIR/chem-system-$VERSION.zip"
git archive --format=tar.gz -o "$TGZ" HEAD -- "${INCLUDE[@]}"
git archive --format=zip -o "$ZIP" HEAD -- "${INCLUDE[@]}"
echo "作りました: $TGZ ($(du -h "$TGZ" | cut -f1))"
echo "作りました: $ZIP ($(du -h "$ZIP" | cut -f1))"

# 入ってはいけないものが混ざっていないかを機械的に見る
if tar tzf "$TGZ" | grep -qE '^(docs/|scripts/data/|scripts/seed-|\.env$|\.env\.[^p]|.*node_modules/|.*\.next/)'; then
  echo "エラー: 入れてはいけないファイルが混ざっています" >&2
  tar tzf "$TGZ" | grep -E '^(docs/|scripts/data/|scripts/seed-|\.env$|\.env\.[^p]|.*node_modules/|.*\.next/)' >&2
  exit 1
fi

if [[ "$WITH_IMAGES" == 1 ]]; then
  # compose.prod.yml の app は image: chem-app:latest（build 付き）。同じ名前で保存しておけば、
  # オフラインのサーバーで docker load したあと、--build 無しの up -d でそのまま動く
  echo "app のイメージを組み立てます: chem-app:latest（chem-app:$VERSION も付ける）"
  docker build -t chem-app:latest -t "chem-app:$VERSION" .
  docker pull caddy:2-alpine
  docker pull postgres:16-alpine
  IMAGES_TAR="$OUT_DIR/chem-images-$VERSION.tar"
  docker save -o "$IMAGES_TAR" chem-app:latest "chem-app:$VERSION" caddy:2-alpine postgres:16-alpine
  echo "作りました: $IMAGES_TAR ($(du -h "$IMAGES_TAR" | cut -f1))"
fi
