#!/usr/bin/env bash
# IARC の発がん性分類（グループ1・2A・2B・3）を LOLI から取り出す。
# 取り込みは scripts/seed-iarc-laws.ts と scripts/seed-iarc-links.ts。
#
#   bash scripts/loli-dump-iarc.sh
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-iarc.sh     過去の版
#
# **鍵は IARC が評価した対象。**条約と同じで、LOLI は評価対象（「クロム(VI)化合物」など）
# から個々の化合物へ広げ、`As Chromium(VI) compounds [RR-00026-0]` という但し書きを付けている。
# そのカッコの中を鍵にする。但し書きの無い行は次の2通り。
#   - `listedunder` がある … IARC がくくり（「Aflatoxins」など）として評価したものの一員。
#     くくりの名前を鍵にする（`LU|Aflatoxins`）。個々の物質を法文物質名にはしない
#   - どちらも無い … その物質そのものが評価対象。自分の CAS を鍵にする
#
# **`value` はモノグラフの巻と年**（`Monograph 100C [2012]`）。いちばん新しい巻を
# 法文物質名の番号に、全部を備考に置く（2026-09-07 決定）。
#
# 出るファイル（scripts/data/）。版ごとに別名で置き、両方の版を取り込めるようにする
#   iarc-<グループ>-<版>.tsv         鍵とCAS
#   iarc-<グループ>-<版>-name.tsv    鍵と、評価対象の名前（英語）
#   iarc-<グループ>-<版>-mono.tsv    鍵と、モノグラフの巻 [年]
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
# 版の名前はデータベース名の末尾（LOLI4_Datafeed_2026Q3 → 2026Q3）
VER="${LOLI_DB##*_}"
echo "  取り出し元: $LOLI_DB（版 $VER）"
mkdir -p .cache scripts/data

run() { # 1=SQL文字列 2=出力ファイル
  python3 - "$1" > .cache/iarc.sql <<'PY'
import sys
sys.stdout.write(sys.argv[1].replace("\n", "\r\n"))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i ".cache/iarc.sql" -o ".cache/iarc.u16"
  iconv -f UTF-16LE -t UTF-8 .cache/iarc.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|cas)\t' | sort -u > "$2"
}

# 1行（row）ごとに、但し書きを1本ずつ分けて見る。
# 但し書きが `As <名前> [<鍵>]` の形なら子、その行の CAS はその鍵の親に付く。
# **鍵は最後のカッコ。**名前に `Benzo[a]pyrene` のように角括弧が入るので、最初のカッコを取ると壊れる（2026-09-08 に直した）。
# 行のどの但し書きもその形でなければ親そのもので、鍵は自分の CAS
BASE="
  SELECT d.Cas AS cas,
         r.value('(value)[1]','varchar(200)') AS val,
         r.query('remark').value('.','varchar(4000)') AS rems,
         LTRIM(RTRIM(r.value('(listedunder)[1]','varchar(300)'))) AS lu,
         r.query('.') AS rowxml
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = @LIST@"

CHILD="
  SELECT b.cas, b.val,
         SUBSTRING(m.value('.','varchar(500)'),
                   LEN(m.value('.','varchar(500)')) - CHARINDEX('[', REVERSE(m.value('.','varchar(500)'))) + 2,
                   CHARINDEX('[', REVERSE(m.value('.','varchar(500)'))) - CHARINDEX(']', REVERSE(m.value('.','varchar(500)'))) - 1) AS k,
         LTRIM(RTRIM(SUBSTRING(m.value('.','varchar(500)'), 4,
                   LEN(m.value('.','varchar(500)')) - CHARINDEX('[', REVERSE(m.value('.','varchar(500)'))) - 3))) AS nm
  FROM ($BASE) b
  CROSS APPLY b.rowxml.nodes('/row/remark') u(m)
  WHERE m.value('.','varchar(500)') LIKE 'As %[[]%]'"

PARENT="
  SELECT b.cas, b.val,
         CASE WHEN b.lu IS NOT NULL AND b.lu <> '' THEN 'LU|' + b.lu ELSE b.cas END AS k,
         CASE WHEN b.lu IS NOT NULL AND b.lu <> '' THEN b.lu ELSE NULL END AS lunm
  FROM ($BASE) b
  WHERE b.rems NOT LIKE '%As %[[]%]%'"

dump() { # 1=グループ名 2=ListID
  local child="${CHILD//@LIST@/$2}" parent="${PARENT//@LIST@/$2}"
  local out="scripts/data/iarc-$1-$VER"

  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, cas FROM (
  SELECT k, cas FROM ($child) c
  UNION ALL
  SELECT k, cas FROM ($parent) p
) z WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "$out.tsv"

  # 名前。子の但し書きから取り、くくりはその名前、親そのものは LOLI の代表名（CasNames）
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, nm FROM (
  SELECT k, nm, ROW_NUMBER() OVER (PARTITION BY k ORDER BY src, nm) AS rn FROM (
    SELECT k, nm, 1 AS src FROM ($child) c WHERE nm <> ''
    UNION ALL
    SELECT p.k, p.lunm AS nm, 1 AS src FROM ($parent) p WHERE p.lunm IS NOT NULL
    UNION ALL
    SELECT p.k, n.Name AS nm, 2 AS src FROM ($parent) p JOIN CasNames n ON n.Cas = p.cas WHERE p.lunm IS NULL
  ) u WHERE k IS NOT NULL AND k <> '' AND nm IS NOT NULL AND nm <> ''
) w WHERE rn = 1 ORDER BY k;" "$out-name.tsv"

  # モノグラフの巻 [年]
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, val FROM (
  SELECT k, val FROM ($child) c
  UNION ALL
  SELECT k, val FROM ($parent) p
) z WHERE k IS NOT NULL AND k <> '' AND val IS NOT NULL AND val <> '' ORDER BY k, val;" "$out-mono.tsv"

  local n k m
  n=$(grep -c . "$out.tsv" || true)
  k=$(cut -f1 "$out.tsv" | sort -u | grep -c . || true)
  m=$(grep -c . "$out-name.tsv" || true)
  printf '  iarc-%-4s %6s 行 / 鍵 %4s 種 / 名前 %4s 種%s\n' "$1" "$n" "$k" "$m" \
    "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
}

echo "IARC"
dump g1  111
dump g2a 112
dump g2b 114
dump g3  507
