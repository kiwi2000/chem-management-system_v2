#!/usr/bin/env bash
# LOLI の一覧を「くくり付き」で取り出す。条約の取り出し（loli-dump-treaties.sh）と
# 同じ形にそろえてあるが、**くくりを LOLI の value ではなく一覧そのもの**から作る。
# 附属書ごとに一覧が分かれている規制（モントリオール議定書・EU POPs 規則・Prop 65）向け。
#
#   bash scripts/loli-dump-lists.sh
#
# 取り込みは scripts/seed-loli-lists.ts。
#
# **鍵は親物質。**LOLI は規制が挙げる物質から個々の異性体・塩へ広げた形で持ち、
# `As Mercury compounds [RR-00138-7]` のような但し書きを付けている。そのカッコの中が鍵。
# 親そのものの行には但し書きが無いので、自分のCASを鍵にする。
#
# 出るファイル（scripts/data/）
#   list-<名前>.tsv        鍵とCAS
#   list-<名前>-name.tsv   鍵と、その物質の名前（英語）
#   list-<名前>-group.tsv  鍵と、くくり（附属書・区分）
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-lists.sh
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache scripts/data

run() { # 1=SQL文字列 2=出力ファイル
  python3 - "$1" > .cache/list.sql <<'PY'
import sys
sys.stdout.write(sys.argv[1].replace("\n", "\r\n"))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i ".cache/list.sql" -o ".cache/list.u16"
  iconv -f UTF-16LE -t UTF-8 .cache/list.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|cas|grp)\t' | sort -u > "$2"
}

# 但し書き `As <名前> [<鍵>]` を切り出す土台。子には親の鍵、親には自分のCASを入れる
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

dump() { # 1=出力名 2="ListID=くくり|ListID=くくり|…"（くくりに空白が入るので区切りは縦棒）
  local ids="" cases="" rest="$2" pair
  while [ -n "$rest" ]; do
    pair="${rest%%|*}"
    [ "$pair" = "$rest" ] && rest="" || rest="${rest#*|}"
    local id="${pair%%=*}" label="${pair#*=}"
    ids="${ids:+$ids,}$id"
    cases="$cases WHEN $id THEN '$label'"
  done

  local base="
  SELECT d.Cas AS cas,
         CASE d.ListID$cases ELSE '' END AS grp,
         CAST(r.query('remark').value('.','varchar(2000)') AS varchar(2000)) AS remarks
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID IN ($ids)"

  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, cas FROM (
  SELECT $PICK AS k, cas FROM ($base) y
) z WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "scripts/data/list-$1.tsv"

  # 名前。但し書きを持つ行から取る。親そのものの行は LOLI の代表名（英語）で埋める
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
) w WHERE rn = 1 ORDER BY k;" "scripts/data/list-$1-name.tsv"

  # くくり（どの一覧に載っていたか）
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, grp FROM (
  SELECT $PICK AS k, grp FROM ($base) y
) z WHERE k IS NOT NULL AND k <> '' AND grp <> '' ORDER BY k, grp;" "scripts/data/list-$1-group.tsv"

  local n k m a
  n=$(grep -c . "scripts/data/list-$1.tsv" || true)
  k=$(cut -f1 "scripts/data/list-$1.tsv" | sort -u | grep -c . || true)
  m=$(grep -c . "scripts/data/list-$1-name.tsv" || true)
  a=$(cut -f2 "scripts/data/list-$1-group.tsv" | sort -u | grep -c . || true)
  printf '  list-%-8s %6s 行 / 鍵 %4s 種 / 名前 %4s 種 / くくり %2s 種%s\n' \
    "$1" "$n" "$k" "$m" "$a" \
    "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
}

echo "モントリオール議定書（UNEP）"
dump ozone "1075=Annex A Group I|1089=Annex A Group II|1090=Annex B Group I|1091=Annex B Group II|1092=Annex B Group III|1093=Annex C Group I|1094=Annex C Group II|1095=Annex C Group III|1096=Annex E|7185=Annex F Group I|7186=Annex F Group II"

echo "EU POPs 規則 (2019/1021)"
dump eupops "2550=Annex I|2549=Annex III"

echo "米国カリフォルニア Proposition 65"
dump prop65 "409=Carcinogens|410=Developmental toxicity|411=Reproductive toxicity male|412=Reproductive toxicity female"

echo
echo "くくりの一覧:"
for f in ozone eupops prop65; do
  printf '  %-7s %s\n' "$f" "$(cut -f2 "scripts/data/list-$f-group.tsv" | sort -u | paste -sd' / ' -)"
done
