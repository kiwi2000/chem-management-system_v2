#!/usr/bin/env bash
# LOLI から「CAS → 物質名」を取り出して scripts/data/cas-names*.tsv に落とす。
# 取り込みは scripts/seed-substances-from-links.ts。
#
#   bash scripts/loli-dump-names.sh
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コード（Shift-JIS）で
# 書き出し、日本語名が全部化ける。2026-08-27 に実際に7,902件を壊した
# （`docs/LOLIデータの気づき.md`）。`-f 65001` では直らない。
#
# **どの一覧を対象にするかは `scripts/sql/cas-names.sql` の先頭に書いてある。**
# 取り込みに使う一覧を増やしたら、そちらも増やす。忘れると、
# 新しく結んだCASに名前が付かず、画面にCAS番号だけが並ぶ。
# **取り出し元のデータベースは差し替えられる。**
# 過去のバージョンを取り込むときは、環境変数で上書きする。
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/<このスクリプト>
#
# `.env.loli` の値より、呼ぶ側で渡した値を優先する。
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
# 呼ぶ側が指定していれば、そちらを使う（過去のバージョンを取り込むため）
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache

dump() { # 1=SQL 2=出力名
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i "scripts/sql/$1" -o ".cache/$2.u16"
  # UTF-16LE で出るので UTF-8 に直す。
  # **BOM を落とす。**残すと先頭の1行が数字で始まらなくなり、まるごと消える
  iconv -f UTF-16LE -t UTF-8 ".cache/$2.u16" | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[0-9]' > "scripts/data/$2.tsv"
  rm -f ".cache/$2.u16"
  local n bad
  n=$(grep -c . "scripts/data/$2.tsv" || true)
  bad=$(grep -c '�' "scripts/data/$2.tsv" || true)
  printf '  %-22s %6s 行%s\n' "$2" "$n" \
    "$([ "$bad" != "0" ] && echo "   ← 化けが ${bad}行。-u が効いていない" || true)"
}

echo "物質名"
dump cas-names.sql       cas-names
dump cas-names-china.sql cas-names-china
dump korea-cas-names.sql korea-cas-names

echo
echo "取り出しました。取り込みは scripts/seed-substances-from-links.ts"
