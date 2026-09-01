#!/usr/bin/env bash
# 大気汚染防止法「特定物質」（令第10条）の CAS を LOLI から取り出す。
#
#   bash scripts/loli-dump-jp-env-extra.sh
#
# 一覧 3072 の `code` は条文の号番号（27 = 五塩化燐、10 = 二酸化窒素）で、
# **令第10条の号とそのまま一致する。**展開版から取る（RR番号を開いたもの）。
#
# 水質の「水素イオン濃度等の項目」（令第3条）は LOLI から取らない。
# 一覧 3083 は排水基準の省令の別表で、**号の振り方が政令と違う**ため取り違える。
# こちらは CHRIP が政令の号で持っているので、そちらから結ぶ。
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . <(tr -d '\r' < .env.loli); set +a

cat > scripts/sql/_jp-apa-special.sql <<'SQL'
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT t.r.value('(code)[1]','nvarchar(50)') AS code, d.Cas AS cas
FROM ListData d
CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
CROSS APPLY x.px.nodes('/root/row') t(r)
WHERE d.ListID = 3072 AND t.r.value('(code)[1]','nvarchar(50)') IS NOT NULL
ORDER BY code, cas;
SQL

sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
  -u -h -1 -W -s $'\t' -i scripts/sql/_jp-apa-special.sql -o scripts/data/jp-apa-special.tsv.utf16
python -c "import io,sys;io.open(sys.argv[2],'w',encoding='utf-8',newline='\n').write(io.open(sys.argv[1],encoding='utf-16').read())" \
  scripts/data/jp-apa-special.tsv.utf16 scripts/data/jp-apa-special.tsv
rm -f scripts/data/jp-apa-special.tsv.utf16 scripts/sql/_jp-apa-special.sql
echo "  jp-apa-special.tsv: $(grep -c . scripts/data/jp-apa-special.tsv) 行"
