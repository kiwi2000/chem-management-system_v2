#!/usr/bin/env bash
#
# 中国の法規制を LOLI から取り出す。
#
#   bash scripts/loli-dump-china.sh <出力先ディレクトリ>
#
# 接続情報は .env.loli（gitに載せない）。
# 取り出すのは **SDS の第15項（法規情報）で名前が挙がるもの**。
# どの一覧が何にあたるかは docs/LOLI取り込み記録_中国.md に書いてある。
#
# 1つの一覧につき1つの TSV（Cas と Data の2列、見出し無し）。
# Data の中身は取り込み側（scripts/seed-china.ts）で読む。
set -euo pipefail

OUT="${1:?出力先ディレクトリを渡してください}"
mkdir -p "$OUT"

# shellcheck disable=SC1091
set -a; . ./.env.loli; set +a

# 取り出す一覧。ここに並べたものだけが対象
LISTS="1945 2579 2171 5380 988 7583 8535 9637 3683"

for id in $LISTS; do
  echo "ListID $id を取り出しています..."
  sqlcmd -S "$LOLI_SERVER" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -d "$LOLI_DB" -C -l 60 \
    -h -1 -W -s $'\t' \
    -Q "SET NOCOUNT ON; SELECT CAST(Cas AS varchar(20)), CAST(Data AS varchar(400)) FROM ListData WHERE ListID=$id" \
    -o "$OUT/china-$id.tsv"
  echo "  $(wc -l < "$OUT/china-$id.tsv") 行"
done

echo "完了。$OUT に置きました"
