#!/usr/bin/env bash
# LOLI の GHS 複合一覧（EU 4204・日本 4171）から、CAS と原典の項目の識別子の結び付きを取り出し、
# scripts/data/loli-ghs-links-<データベース名>.tsv に落とす（S23 §9-4）。
#
#   bash scripts/loli-dump-ghs-links.sh                                  .env.loli の LOLI_DB
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-ghs-links.sh    過去のバージョン
#
# 取り込みは SDS あり版の /sds/ghs で、出典「LOLI（結び付き）」を選んでこの TSV を渡す。
# 見出し行は付けない。列: target_source, cas, key, remark
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"

SQLCMD="${SQLCMD:-sqlcmd}"
command -v "$SQLCMD" >/dev/null 2>&1 || SQLCMD="/c/Program Files/Microsoft SQL Server/Client SDK/ODBC/180/Tools/Binn/sqlcmd"

mkdir -p scripts/data
OUT="scripts/data/loli-ghs-links-${LOLI_DB}.tsv"
TMP="scripts/data/_loli-ghs-links.u16"
# sqlcmd は CRLF の入力を好む。-u で UTF-16 に出し、UTF-8 に直す（remark に非 ASCII があり得る）
python - > scripts/sql/_ghs-links.sql <<'PY'
import io
t = io.open("scripts/sql/loli-ghs-links.sql", encoding="utf-8").read()
import sys; sys.stdout.write(t.replace("\r\n", "\n").replace("\n", "\r\n"))
PY
"$SQLCMD" -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" -y 0 -s $'\t' -u -i "$(cygpath -w scripts/sql/_ghs-links.sql)" -o "$(cygpath -w "$TMP")"
iconv -f UTF-16LE -t UTF-8 "$TMP" | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' | grep -v '^$' > "$OUT"
rm -f "$TMP" scripts/sql/_ghs-links.sql
echo "  出力: $OUT ($(wc -l < "$OUT") 行)"
