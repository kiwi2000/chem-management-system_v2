#!/usr/bin/env bash
# お客さんへ渡す配布物を作る（社内サーバー導入手順書の「こちらからお渡しするファイル」）。
#
#   bash scripts/package-release.sh                 いまのコミットから out/ に作る
#   bash scripts/package-release.sh 1.0.0           版を指定する（省くと package.json の version）
#   bash scripts/package-release.sh 1.0.0 --images  Docker イメージのファイルも作る（docker が要る。時間がかかる）
#   bash scripts/package-release.sh --with sds      差込口のモジュール（apps/web/modules/sds）を入れた版を作る。
#                                                    **既定は入れない。**挙げなかったモジュールのフォルダは配布物に入らず、
#                                                    入っていないことを機械で確かめる。入れた版はファイル名に -sds が付き、
#                                                    apps/web/modules/enabled.json（有効にするモジュールの一覧）が同梱される
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

VERSION=""
WITH_IMAGES=0
WITH_MODULES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --images) WITH_IMAGES=1 ;;
    --with) shift; WITH_MODULES+=("${1:?--with にはモジュール名が要ります}") ;;
    --with=*) WITH_MODULES+=("${1#--with=}") ;;
    -*) echo "知らない引数: $1" >&2; exit 2 ;;
    *) VERSION="$1" ;;
  esac
  shift
done
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('./package.json').version")"
fi

# モジュール（apps/web/modules/<id>/）は --with に挙げたものだけ入れる
ALL_MODULES=()
for d in apps/web/modules/*/; do
  [[ -f "$d/manifest.ts" ]] && ALL_MODULES+=("$(basename "$d")")
done
for w in "${WITH_MODULES[@]+"${WITH_MODULES[@]}"}"; do
  if [[ ! " ${ALL_MODULES[*]} " == *" $w "* ]]; then
    echo "モジュールが見つかりません: $w（apps/web/modules/ に無い）" >&2
    exit 2
  fi
done
EXCLUDED_MODULES=()
EXCLUDE=()
for id in "${ALL_MODULES[@]+"${ALL_MODULES[@]}"}"; do
  if [[ ! " ${WITH_MODULES[*]+"${WITH_MODULES[*]}"} " == *" $id "* ]]; then
    EXCLUDED_MODULES+=("$id")
    EXCLUDE+=(":(exclude)apps/web/modules/$id")
  fi
done
# 入れたモジュールを有効にする印（enabled.json）。git に無いファイルなので archive に足す
ADD=()
SUFFIX=""
if [[ ${#WITH_MODULES[@]} -gt 0 ]]; then
  json="["
  for w in "${WITH_MODULES[@]}"; do json+="\"$w\","; done
  json="${json%,}]"
  ADD+=("--add-virtual-file=apps/web/modules/enabled.json:$json")
  SUFFIX="-$(IFS=-; echo "${WITH_MODULES[*]}")"
fi

OUT_DIR="$REPO_DIR/out"
mkdir -p "$OUT_DIR"

# 配布物に入れるもの。足すときは導入手順書の手順（展開 → 起動 → 管理者作成 → バックアップ）で要るかを考える
INCLUDE=(
  NOTICE
  package.json
  package-lock.json
  tsconfig.base.json
  .dockerignore
  .env.prod.example
  .env.windows.example
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
  scripts/gen-modules.mjs
)

if [[ -n "$(git status --porcelain -- "${INCLUDE[@]}")" ]]; then
  echo "注意: 配布物に入るファイルに、コミットしていない変更があります（入りません）" >&2
  git status --short -- "${INCLUDE[@]}" >&2
fi

TGZ="$OUT_DIR/chem-system-$VERSION$SUFFIX.tar.gz"
ZIP="$OUT_DIR/chem-system-$VERSION$SUFFIX.zip"
git archive --format=tar.gz -o "$TGZ" "${ADD[@]+"${ADD[@]}"}" HEAD -- "${INCLUDE[@]}" "${EXCLUDE[@]+"${EXCLUDE[@]}"}"
git archive --format=zip -o "$ZIP" "${ADD[@]+"${ADD[@]}"}" HEAD -- "${INCLUDE[@]}" "${EXCLUDE[@]+"${EXCLUDE[@]}"}"
echo "作りました: $TGZ ($(du -h "$TGZ" | cut -f1))"
echo "作りました: $ZIP ($(du -h "$ZIP" | cut -f1))"

# 入ってはいけないものが混ざっていないかを機械的に見る。
# 一覧は 1 回だけ取る（pipefail の下で grep -q が途中で読むのをやめると tar が SIGPIPE で落ち、正常なのに失敗扱いになる）
LISTING="$(tar tzf "$TGZ")"
fail() {
  echo "エラー: $1" >&2
  rm -f "$TGZ" "$ZIP"
  exit 1
}
# .env は見本（.env.prod.example / .env.windows.example）だけ入れてよい。それ以外の .env* は秘密なので入れない
FORBIDDEN="$(grep -E '^(docs/|scripts/data/|scripts/seed-|\.env(\.|$)|.*node_modules/|.*\.next/)' <<<"$LISTING" | grep -vE '^\.env\.[a-z]+\.example$' || true)"
if [[ -n "$FORBIDDEN" ]]; then
  echo "$FORBIDDEN" >&2
  fail "入れてはいけないファイルが混ざっています"
fi
# 入れていないモジュールが 1 ファイルでも混ざっていたら作らない。入れたモジュールは、有効にする印と一緒に入っていること
for id in "${EXCLUDED_MODULES[@]+"${EXCLUDED_MODULES[@]}"}"; do
  grep -q "^apps/web/modules/$id/" <<<"$LISTING" && fail "入れていないモジュール $id のファイルが混ざっています"
done
for w in "${WITH_MODULES[@]+"${WITH_MODULES[@]}"}"; do
  grep -q "^apps/web/modules/$w/manifest.ts$" <<<"$LISTING" || fail "入れるはずのモジュール $w が入っていません"
done
if [[ ${#WITH_MODULES[@]} -gt 0 ]]; then
  grep -q "^apps/web/modules/enabled.json$" <<<"$LISTING" || fail "有効にするモジュールの一覧（enabled.json）が入っていません"
  echo "入れたモジュール: ${WITH_MODULES[*]}（enabled.json で有効になります）"
fi
if [[ ${#EXCLUDED_MODULES[@]} -gt 0 ]]; then
  echo "入れていないモジュール: ${EXCLUDED_MODULES[*]}（混ざっていないことを確認）"
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
