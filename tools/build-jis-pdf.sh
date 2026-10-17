#!/usr/bin/env bash
# JIS の組み直し（章ごとの out-*.md）を 1 冊につなぎ、HTML と PDF にして docs/GHS分類の原典/JIS/ に置く（2026-10-17）
# 使い方: bash tools/build-jis-pdf.sh <out-*.md のあるフォルダ> [7253|7252|all]
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$1"; WHICH="${2:-all}"
DEST="docs/GHS分類の原典/JIS"

build() {
  local code="$1" title="$2" sub="$3"; shift 3
  local md="$SRC/book-$code.md"
  : > "$md"
  for part in "$@"; do
    if [ ! -f "$SRC/out-$part.md" ]; then echo "無い: out-$part.md" >&2; return 1; fi
    cat "$SRC/out-$part.md" >> "$md"; printf '\n\n' >> "$md"
  done
  PYTHONIOENCODING=utf-8 python tools/md-to-html.py "$md" "$SRC/book-$code.html" "$title" "$sub"
  node tools/html-to-pdf.mjs "$SRC/book-$code.html" "$DEST/JIS_Z${code}_2025_読みやすい版.pdf" "JIS Z $code：2025　$title"
  cp "$md" "$DEST/JIS_Z${code}_2025_読みやすい版.md"
}

if [ "$WHICH" = all ] || [ "$WHICH" = 7253 ]; then
  build 7253 "GHSに基づく化学品の危険有害性の情報伝達方法－ラベル，作業場内の表示及び安全データシート（SDS）" \
    "JIS Z 7253：2025 の読みやすい版（本文は原文のまま。表と図を組み直し、図解を補足）" \
    7253-A 7253-C 7253-D 7253-E 7253-F 7253-G
fi
if [ "$WHICH" = all ] || [ "$WHICH" = 7252 ]; then
  build 7252 "GHSに基づく化学品の分類方法" \
    "JIS Z 7252：2025 の読みやすい版（本文は原文のまま。表と図を組み直し、図解を補足）" \
    7252-A 7252-B1 7252-B2 7252-C1 7252-C2 7252-C3 7252-D
fi
ls -la "$DEST"/*読みやすい版* 2>/dev/null
