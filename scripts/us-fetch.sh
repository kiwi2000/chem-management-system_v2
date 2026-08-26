#!/usr/bin/env bash
# 米国の連邦規則（CFR）の**原文**を eCFR から落とす。
#
#   bash scripts/us-fetch.sh
#
# 落とし先は .cache/us/。2回目からはそこを読むので、繋がらなくても動く。
# 取り出しは scripts/build-us-data.ts。
#
# eCFR には2つのAPIがあり、**使えるのは renderer のほう**
# （`docs/法規制データの作り方.md` 第2章 2-5）。
#
#   /api/versioner/v1/full/…    503 を返す（部が大きいと通らない）
#   /api/renderer/v1/content/enhanced/…   通る。HTML が返る
set -uo pipefail
cd "$(dirname "$0")/.."

DIR=".cache/us"
mkdir -p "$DIR"

# **日付を固定して取る。**日付を省くと結果が日によって変わり、照合できない
DATE="${1:-2026-08-10}"
BASE="https://www.ecfr.gov/api/renderer/v1/content/enhanced/$DATE/title-40"

get() { # 1=保存名 2=問い合わせ
  if [ -s "$DIR/$1" ]; then
    echo "  $1 は取得済み"
    return 0
  fi
  local code
  code=$(curl -sSL --compressed --max-time 180 -A "Mozilla/5.0" \
    -o "$DIR/$1" -w "%{http_code}" "$BASE?$2") || { echo "  ✗ $1 取れません"; return 1; }
  if [ "$code" != "200" ]; then
    echo "  ✗ $1 HTTP $code"
    rm -f "$DIR/$1"
    return 1
  fi
  echo "  $1  $(wc -c < "$DIR/$1") バイト"
}

echo "=== 40 CFR 372.65  有害化学物質の排出把握（EPCRA 第313条 ＝ SARA 313 / TRI）"
get tri.html "part=372&section=372.65"

echo "=== 40 CFR 751  TSCA 第6条による製造・使用等の規制"
get tsca6.html "part=751"

echo
echo "取得日: $DATE（$DIR/DATE に控える）"
echo "$DATE" > "$DIR/DATE"
