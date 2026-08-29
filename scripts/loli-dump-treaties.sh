#!/usr/bin/env bash
# 3つの条約（ストックホルム・ロッテルダム・水俣）を LOLI から取り出す。
# 取り込みは scripts/seed-treaty-laws.ts と scripts/seed-treaty-links.ts。
#
#   bash scripts/loli-dump-treaties.sh
#
# **鍵は親物質。**EU RoHS と同じで、LOLI は条約が挙げる物質から個々の異性体・塩へ
# 広げた形で持ち、`As Mercury compounds [RR-00138-7]` のような但し書きを付けている。
# そのカッコの中を鍵にする。親そのものの行には但し書きが無いので、自分のCASを鍵にする。
#
# 出るファイル（scripts/data/）
#   treaty-<名前>.tsv        鍵とCAS
#   treaty-<名前>-name.tsv   鍵と、その物質の名前（英語）
#   treaty-<名前>-annex.tsv  鍵と、条約上のくくり（Annex A / Article 3 / Adopted 1992）
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
# **取り出し元のデータベースは差し替えられる。**
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-treaties.sh
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache scripts/data

run() { # 1=SQL文字列 2=出力ファイル
  python3 - "$1" > .cache/treaty.sql <<'PY'
import sys
sys.stdout.write(sys.argv[1].replace("\n", "\r\n"))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i ".cache/treaty.sql" -o ".cache/treaty.u16"
  iconv -f UTF-16LE -t UTF-8 .cache/treaty.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|cas)\t' | sort -u > "$2"
}

# 但し書き `As <名前> [<鍵>]` を切り出す土台。子には親の鍵、親には自分のCASを入れる
KEY_SQL="
  SELECT d.Cas AS cas,
         CAST(r.query('remark').value('.','varchar(2000)') AS varchar(2000)) AS remarks,
         LTRIM(RTRIM(ISNULL(r.value('(value)[1]','varchar(200)'),''))) AS val
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = @LIST@"

# `As ` から `[` までが名前、`[` から `]` までが鍵
PICK="CASE WHEN CHARINDEX('As ', remarks) > 0 AND CHARINDEX('[', remarks) > 0
           THEN SUBSTRING(remarks,
                  CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) + 1,
                  CHARINDEX(']', remarks, CHARINDEX('As ', remarks))
                    - CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) - 1)
           ELSE cas END"
PICK_NAME="CASE WHEN CHARINDEX('As ', remarks) > 0 AND CHARINDEX('[', remarks) > 0
           THEN LTRIM(RTRIM(SUBSTRING(remarks,
                  CHARINDEX('As ', remarks) + 3,
                  CHARINDEX('[', remarks, CHARINDEX('As ', remarks))
                    - CHARINDEX('As ', remarks) - 3)))
           ELSE '' END"

dump() { # 1=出力名 2=ListID
  local base="${KEY_SQL//@LIST@/$2}"

  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, cas FROM (
  SELECT $PICK AS k, cas FROM ($base) y
) z WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "scripts/data/treaty-$1.tsv"

  # 名前。但し書きを持つ行から取る。親そのものの行は LOLI の代表名（英語）で埋める
  # **親の行は但し書きが無い行。**鍵の式で見分けようとすると CasNames の Cas と
  # 列名がぶつかって「あいまいです」で落ちるので、但し書きの有無で見る
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, nm FROM (
  SELECT k, nm, ROW_NUMBER() OVER (PARTITION BY k ORDER BY src, nm) AS rn FROM (
    SELECT $PICK AS k, $PICK_NAME AS nm, 1 AS src FROM ($base) y1
    WHERE $PICK_NAME <> ''
    UNION ALL
    SELECT y2.cas AS k, n.Name AS nm, 2 AS src
    FROM ($base) y2
    JOIN CasNames n ON n.Cas = y2.cas
    WHERE CHARINDEX('As ', y2.remarks) = 0 OR CHARINDEX('[', y2.remarks) = 0
  ) u WHERE k IS NOT NULL AND k <> '' AND nm IS NOT NULL AND nm <> ''
) w WHERE rn = 1 ORDER BY k;" "scripts/data/treaty-$1-name.tsv"

  # 条約上のくくり
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, val FROM (
  SELECT $PICK AS k, val FROM ($base) y
) z WHERE k IS NOT NULL AND k <> '' AND val <> '' ORDER BY k, val;" "scripts/data/treaty-$1-annex.tsv"

  local n k m a
  n=$(grep -c . "scripts/data/treaty-$1.tsv" || true)
  k=$(cut -f1 "scripts/data/treaty-$1.tsv" | sort -u | grep -c . || true)
  m=$(grep -c . "scripts/data/treaty-$1-name.tsv" || true)
  a=$(cut -f2 "scripts/data/treaty-$1-annex.tsv" | sort -u | grep -c . || true)
  printf '  treaty-%-10s %6s 行 / 鍵 %4s 種 / 名前 %4s 種 / くくり %2s 種%s\n' \
    "$1" "$n" "$k" "$m" "$a" \
    "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
}

echo "条約"
dump pops     798
dump pic      664
dump minamata 7711

echo
echo "くくりの一覧:"
for f in pops pic minamata; do
  printf '  %-9s %s\n' "$f" "$(cut -f2 "scripts/data/treaty-$f-annex.tsv" | sort -u | paste -sd' / ' -)"
done
