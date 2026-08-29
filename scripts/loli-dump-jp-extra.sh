#!/usr/bin/env bash
# 日本の法規制のうち、あとから足したものを LOLI から取り出す。
# 取り込みは scripts/seed-jp-extra-laws.ts と scripts/seed-jp-extra-links.ts。
#
#   bash scripts/loli-dump-jp-extra.sh
#
# 対象
#   安衛法：皮膚等障害化学物質等（4つの一覧）
#   安衛法：がん原性物質（作業記録30年保存）
#   安衛法：鉛等／四アルキル鉛等
#   オゾン層保護法：特定物質（附属書のグループごとに11の一覧）
#
# **鍵の決めかたは一覧によって違う。**上から順に見て、最初に見つかったものを使う。
#
#   1. code         … 法令の番号を持っているとき（がん原性物質・皮膚等障害の特化則ぶん）
#   2. listedunder  … 号の名前でまとめているとき（鉛則の「鉛酸化物」など）
#   3. As 親[CAS]   … 親物質から異性体・塩へ広げているとき（オゾン層保護法）
#   4. 自分のCAS    … どれも無いとき（皮膚刺激性など、1物質で1行）
#
# 出るファイル（scripts/data/）
#   jp-extra-<名前>.tsv        鍵とCAS
#   jp-extra-<名前>-name.tsv   鍵と、その号の名前
#   jp-extra-<名前>-thr.tsv    鍵と、裾切値（`値/単位/種類`）
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
# **取り出し元のデータベースは差し替えられる。**
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-jp-extra.sh
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache scripts/data

run() { # 1=SQL文字列 2=出力ファイル
  python3 - "$1" > .cache/jp-extra.sql <<'PY'
import sys
sys.stdout.write(sys.argv[1].replace("\n", "\r\n"))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i ".cache/jp-extra.sql" -o ".cache/jp-extra.u16"
  iconv -f UTF-16LE -t UTF-8 .cache/jp-extra.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|cas)\t' | sort -u > "$2"
}

# 1行ぶんの土台。行ごとに欄を取り出す
BASE="
  SELECT d.Cas AS cas,
         LTRIM(RTRIM(ISNULL(r.value('(code)[1]','varchar(60)'),''))) AS code,
         LTRIM(RTRIM(ISNULL(r.value('(refno)[1]','varchar(300)'),''))) AS refno,
         LTRIM(RTRIM(ISNULL(r.value('(listedunder)[1]','varchar(300)'),''))) AS under,
         CAST(r.query('remark').value('.','varchar(2000)') AS varchar(2000)) AS remarks,
         LTRIM(RTRIM(ISNULL(r.value('(value)[1]','varchar(60)'),''))) AS val,
         LTRIM(RTRIM(ISNULL(r.value('(unit)[1]','varchar(60)'),''))) AS unit,
         LTRIM(RTRIM(ISNULL(r.value('(type)[1]','varchar(60)'),''))) AS typ
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = @LIST@"

# 但し書き `As <名前> [<CAS>]` の中身。
# **かっこは後ろから探す。**物質名そのものが `benzotriazin-3[4H]-yl` のように
# 角かっこを含むことがあり、前から探すと名前の途中を鍵にしてしまう
LB="(LEN(remarks) - CHARINDEX('[', REVERSE(remarks)) + 1)"
RB="CHARINDEX(']', remarks, $LB)"
AS_CAS="SUBSTRING(remarks, $LB + 1, $RB - $LB - 1)"
AS_NAME="LTRIM(RTRIM(SUBSTRING(remarks,
          CHARINDEX('As ', remarks) + 3,
          $LB - CHARINDEX('As ', remarks) - 3)))"
# 取り出した中身がCASらしい形か、LOLI の内部コードのときだけ親として扱う
HAS_AS="CHARINDEX('As ', remarks) > 0
        AND CHARINDEX('[', REVERSE(remarks)) > 0
        AND $RB > $LB
        AND $LB > CHARINDEX('As ', remarks) + 3
        AND ($AS_CAS LIKE '%[0-9]-[0-9][0-9]-[0-9]' OR $AS_CAS LIKE 'RR-%')"

KEY="CASE WHEN code <> '' THEN code
          WHEN under <> '' THEN under
          WHEN $HAS_AS THEN $AS_CAS
          ELSE cas END"
NAME="CASE WHEN refno <> '' THEN refno
           WHEN under <> '' THEN under
           WHEN $HAS_AS THEN $AS_NAME
           ELSE '' END"

dump() { # 1=出力名 2=ListID
  local base="${BASE//@LIST@/$2}"

  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, cas FROM (SELECT $KEY AS k, cas FROM ($base) y) z
WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "scripts/data/jp-extra-$1.tsv"

  # 号の名前。無い行は、その号の代表名を LOLI の物質名で埋める
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, nm FROM (
  SELECT k, nm, ROW_NUMBER() OVER (PARTITION BY k ORDER BY src, nm) AS rn FROM (
    SELECT $KEY AS k, $NAME AS nm, 1 AS src FROM ($base) y1 WHERE $NAME <> ''
    UNION ALL
    SELECT y2.cas AS k, n.Name AS nm, 2 AS src
    FROM ($base) y2 JOIN CasNames n ON n.Cas = y2.cas
    WHERE y2.code = '' AND y2.under = '' AND NOT ($HAS_AS)
  ) u WHERE k IS NOT NULL AND k <> '' AND nm IS NOT NULL AND nm <> ''
) w WHERE rn = 1 ORDER BY k;" "scripts/data/jp-extra-$1-name.tsv"

  # 裾切値。`値/単位/種類` を1つにつないで出す
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, v FROM (
  SELECT $KEY AS k, val + '/' + unit + '/' + typ AS v FROM ($base) y
) z WHERE k IS NOT NULL AND k <> '' AND v <> '//' ORDER BY k;" "scripts/data/jp-extra-$1-thr.tsv"

  local n j m a
  n=$(grep -c . "scripts/data/jp-extra-$1.tsv" || true)
  j=$(cut -f1 "scripts/data/jp-extra-$1.tsv" | sort -u | grep -c . || true)
  m=$(grep -c . "scripts/data/jp-extra-$1-name.tsv" || true)
  a=$(grep -c . "scripts/data/jp-extra-$1-thr.tsv" || true)
  printf '  %-22s %6s 行 / 号 %5s / 名前 %5s / 裾切値 %5s%s\n' "$1" "$n" "$j" "$m" "$a" \
    "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
}

IDS="9888,9889,9891,9892,9624,2036,2043,1213,1212,1211,1210,1209,1208,1207,2049,1206,7988,7989"

echo "安衛法：皮膚等障害化学物質等"
dump skin-specified   9888
dump skin-eye         9889
dump skin-irritation  9891
dump skin-absorption  9892

echo "安衛法：がん原性物質（作業記録30年保存）"
dump carcinogen30     9624

echo "安衛法：鉛等／四アルキル鉛等"
dump lead             2036
dump tetraalkyl-lead  2043

echo "オゾン層保護法：特定物質"
dump ozone-a1  1213
dump ozone-a2  1212
dump ozone-b1  1211
dump ozone-b2  1210
dump ozone-b3  1209
dump ozone-c1  1208
dump ozone-c2  1207
dump ozone-c3  2049
dump ozone-e1  1206
dump ozone-f1  7988
dump ozone-f2  7989

# 物質名の日本語。**法文が無いときの2番手が CHRIP**（LOLI の英語名は最後に回す）
echo "CHRIP の日本語名"
run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT cas, nm FROM (
  SELECT c.cas AS cas, LTRIM(RTRIM(c.chem_name)) AS nm,
         ROW_NUMBER() OVER (PARTITION BY c.cas ORDER BY LEN(c.chem_name)) AS rn
  FROM CHRIP.dbo.chrip_substances c
  WHERE c.chem_name IS NOT NULL AND LTRIM(RTRIM(c.chem_name)) <> ''
    AND c.cas IN (SELECT DISTINCT Cas FROM ListData WHERE ListID IN ($IDS))
) z WHERE rn = 1 ORDER BY cas;" "scripts/data/jp-extra-chrip-names.tsv"
printf '  %-22s %6s 件\n' "chrip-names" "$(grep -c . scripts/data/jp-extra-chrip-names.tsv || true)"

echo
echo "裾切値の種類:"
cat scripts/data/jp-extra-*-thr.tsv | cut -f2 | sort | uniq -c | sort -rn | head -12
