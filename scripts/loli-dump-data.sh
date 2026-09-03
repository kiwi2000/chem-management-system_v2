#!/usr/bin/env bash
# LOLI の ListData.Data（一覧ごとの、CAS についての文章）を取り出して
# scripts/data/loli-data-<データベース名>.tsv に落とす。
#
#   bash scripts/loli-dump-data.sh                                  2026Q3（.env.loli の LOLI_DB）
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-data.sh    過去のバージョン
#
# 取り込みは scripts/seed-link-data.ts。**どの一覧を取るかはそちらの対応表で決める**
# （`tsx scripts/seed-link-data.ts ids` が一覧IDを吐く）。ここに一覧IDを書かない。
#
# 日本語訳はコンパクト版（<データベース名>_Compact）の ListData_Translation にある。
# **コンパクト版が無ければ英語だけ**を取る（2026Q2 はまだ無い）。
# 出力の列: ListID, Cas, Data（英語）, 日本語訳（無ければ NULL）
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
COMPACT="${LOLI_DB}_Compact"
echo "  取り出し元: $LOLI_DB"

Q() { sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$1" -h -1 -W -Q "SET NOCOUNT ON; $2" | tr -d '\r'; }

# 一覧IDは投入側の対応表から
IDS=$(node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json scripts/seed-link-data.ts ids | tr -d '\r')
[ -n "$IDS" ] || { echo "一覧IDが取れませんでした"; exit 1; }
echo "  一覧: $(echo "$IDS" | tr ',' '\n' | grep -c .) 本"

# コンパクト版があるか。無ければ英語だけ（SQL を差し替える）
if [ "$(Q master "SELECT CASE WHEN DB_ID('$COMPACT') IS NULL THEN 0 ELSE 1 END")" = "1" ]; then
  echo "  日本語訳: $COMPACT から"
  SQL=scripts/sql/loli-data.sql
else
  echo "  日本語訳: 無し（$COMPACT が無い）"
  SQL=scripts/sql/loli-data-noja.sql
fi
python - "$SQL" "$IDS" "$COMPACT" > scripts/sql/_data.sql <<'PY'
import io,sys
t=io.open(sys.argv[1],encoding="utf-8").read()
sys.stdout.write(t.replace("{LIST_IDS}",sys.argv[2]).replace("{COMPACT}",sys.argv[3]))
PY

OUT="scripts/data/loli-data-$LOLI_DB.tsv"
mkdir -p scripts/data
# 日本語が混じるので UTF-16 で受けて UTF-8 に直す（長さは SQL 側で nvarchar(4000) に揃えてある）
sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
  -u -h -1 -W -s $'\t' -i scripts/sql/_data.sql -o "$OUT.utf16"
python -c "import io,sys;io.open(sys.argv[2],'w',encoding='utf-8',newline='\n').write(io.open(sys.argv[1],encoding='utf-16').read().replace('\r',''))" "$OUT.utf16" "$OUT"
rm -f "$OUT.utf16" scripts/sql/_data.sql

n=$(grep -c . "$OUT" || true)
j=$(awk -F'\t' '$4 != "NULL" && $4 != ""' "$OUT" | grep -c . || true)
echo "  $(basename "$OUT"): $n 行 / 日本語訳あり $j 行"
