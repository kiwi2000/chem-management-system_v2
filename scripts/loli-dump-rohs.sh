#!/usr/bin/env bash
# EU RoHS（LOLI ListID 1608）を取り出して scripts/data/loli-eu-rohs.tsv に落とす。
#
#   bash scripts/loli-dump-rohs.sh
#
# **鍵は親物質のCAS。**LOLI は附属書IIの10物質から個々の異性体へ広げた形で持ち、
# `As Lead [7439-92-1]` のような但し書きを付けている。そのカッコの中を鍵にする。
# 親そのものの行には但し書きが無いので、自分のCASを鍵にする。
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
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
mkdir -p .cache scripts/data

python - > .cache/rohs.sql <<'PY'
import sys
sql = """SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, cas FROM (
  SELECT CASE
           WHEN CHARINDEX('As ', remarks) > 0 AND CHARINDEX('[', remarks) > 0
           THEN SUBSTRING(remarks,
                  CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) + 1,
                  CHARINDEX(']', remarks, CHARINDEX('As ', remarks))
                    - CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) - 1)
           ELSE cas
         END AS k,
         cas
  FROM (
    SELECT d.Cas AS cas,
           CAST(r.query('remark').value('.','varchar(1000)') AS varchar(1000)) AS remarks
    FROM ListData d
    CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
    CROSS APPLY x.px.nodes('/root/row') t(r)
    WHERE d.ListID = 1608
  ) y
) z
WHERE k IS NOT NULL AND k <> ''
ORDER BY k, cas;
"""
sys.stdout.write(sql.replace("\n", "\r\n"))
PY

sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
  -h -1 -W -s $'\t' -u -i ".cache/rohs.sql" -o ".cache/rohs.u16"
# UTF-16LE で出るので UTF-8 に直す。BOM を落とさないと先頭の1行が消える
iconv -f UTF-16LE -t UTF-8 .cache/rohs.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
  | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^k\t' | sort -u > scripts/data/loli-eu-rohs.tsv

n=$(grep -c . scripts/data/loli-eu-rohs.tsv || true)
k=$(cut -f1 scripts/data/loli-eu-rohs.tsv | sort -u | grep -c . || true)
printf '  loli-eu-rohs  %6s 行 / 親 %2s 種%s\n' "$n" "$k" \
  "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
