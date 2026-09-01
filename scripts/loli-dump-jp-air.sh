#!/usr/bin/env bash
# 大気汚染防止法「有害大気汚染物質に該当する可能性がある物質」を LOLI から取り出す。
#
#   bash scripts/loli-dump-jp-air.sh
#
# **2つのデータベースを使い分ける。**
#   法文物質名（日本語つき） … コンパクト版。RR番号を展開していないが、**日本語訳が入っている**
#   CASリンク               … 展開版。RR番号を対応するCASに開いてある
#
# 一覧 3074 の XML は次の形。
#   <row><value>Present</value><remark>Priority chemical</remark>
#        <code>2-16</code><refno>Nickel compounds</refno></row>
#   code = 別表番号-項番（別表1は `1-`、別表2＝優先取組物質は `2-`）
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . <(tr -d '\r' < .env.loli); set +a
COMPACT="${LOLI_DB}_Compact"

run() { # 1=DB 2=SQLファイル 3=出力
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$1" \
    -u -h -1 -W -s $'\t' -i "$2" -o "$3.utf16" || return 1
  python -c "import io,sys;io.open(sys.argv[2],'w',encoding='utf-8',newline='\n').write(io.open(sys.argv[1],encoding='utf-16').read())" "$3.utf16" "$3"
  rm -f "$3.utf16"
  echo "  $(basename "$3"): $(grep -c . "$3") 行"
}

mkdir -p scripts/data

# 法文物質名。code ごとに1行。日本語は訳の XML から同じ code で引く
cat > scripts/sql/_jp-air-items.sql <<'SQL'
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT
  s.code, s.priority, s.en, j.ja
FROM (
  SELECT t.r.value('(code)[1]','nvarchar(50)') AS code,
         t.r.value('(refno)[1]','nvarchar(300)') AS en,
         CASE WHEN t.r.value('(remark)[1]','nvarchar(100)') = 'Priority chemical' THEN 1 ELSE 0 END AS priority,
         d.Cas AS cas
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = 3074
) s
LEFT JOIN (
  SELECT tj.rj.value('(code)[1]','nvarchar(50)') AS code,
         tj.rj.value('(refno)[1]','nvarchar(300)') AS ja
  FROM ListData_Translation v
  CROSS APPLY (SELECT CAST(v.XML AS xml)) xj(pj)
  CROSS APPLY xj.pj.nodes('/root/row') tj(rj)
  WHERE v.ListID = 3074 AND v.LangID = 21
) j ON j.code = s.code
WHERE s.code IS NOT NULL AND s.code <> ''
ORDER BY s.code;
SQL

# CASリンク。展開版から取る
cat > scripts/sql/_jp-air-cas.sql <<'SQL'
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT t.r.value('(code)[1]','nvarchar(50)') AS code, d.Cas AS cas
FROM ListData d
CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
CROSS APPLY x.px.nodes('/root/row') t(r)
WHERE d.ListID = 3074
  AND t.r.value('(code)[1]','nvarchar(50)') IS NOT NULL
ORDER BY code, cas;
SQL

echo "取り出し元（法文物質名・日本語）: $COMPACT"
run "$COMPACT" scripts/sql/_jp-air-items.sql scripts/data/jp-air-items.tsv
echo "取り出し元（CASリンク）: $LOLI_DB"
run "$LOLI_DB" scripts/sql/_jp-air-cas.sql scripts/data/jp-air-cas.tsv
rm -f scripts/sql/_jp-air-items.sql scripts/sql/_jp-air-cas.sql
