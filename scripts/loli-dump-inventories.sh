#!/usr/bin/env bash
# 各国のインベントリ（既存化学物質の目録）を取り出して
# scripts/data/loli-inventories.tsv に落とす。取り込みは scripts/seed-inventories.ts。
#
#   bash scripts/loli-dump-inventories.sh
#
# **95万行あるので数分かかる。**どの ListID が何かは
# docs/LOLI取り込み記録_インベントリ.md にある。
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
#
# **取り出し元のデータベースは差し替えられる。**
# 過去のバージョンを取り込むときは、環境変数で上書きする。
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-inventories.sh
#
# `.env.loli` の値より、呼ぶ側で渡した値を優先する。
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
# 呼ぶ側が指定していれば、そちらを使う（過去のバージョンを取り込むため）
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache scripts/data

sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
  -h -1 -W -s $'\t' -u -i "scripts/sql/loli-inventories.sql" -o ".cache/inventories.u16"
# UTF-16LE で出るので UTF-8 に直す。BOM を落とさないと先頭の1行が消える
iconv -f UTF-16LE -t UTF-8 .cache/inventories.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
  | grep -P '^\d+\t[^\t]+\t' > scripts/data/loli-inventories.tsv

n=$(grep -c . scripts/data/loli-inventories.tsv || true)
k=$(cut -f1 scripts/data/loli-inventories.tsv | sort -u | grep -c . || true)
printf '  loli-inventories  %8s 行 / 目録 %2s 種%s\n' "$n" "$k" \
  "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
