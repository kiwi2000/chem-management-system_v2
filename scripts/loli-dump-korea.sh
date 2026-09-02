#!/usr/bin/env bash
# 韓国の法規制を LOLI から取り出して scripts/data/korea-*.tsv に落とす。
# 取り込みは scripts/seed-korea-laws.ts（法令の中身）と
# scripts/seed-korea-links.ts（CASリンク）。
#
#   bash scripts/loli-dump-korea.sh
#
# **鍵はListごとに違う。**下の表のとおり。
#
#   1887 K-REACH 禁止物質      code   （`06-4-14` の形）
#   1888 K-REACH 制限物質      code
#  10266 K-REACH 急性毒性物質  refno   （`97-1-442` の形）
#  10267 K-REACH 慢性毒性物質  refno
#  10268 K-REACH 生態毒性物質  refno
#   7914 K-REACH 重点管理物質  refno
#   1581 ISHA 製造等禁止物質   refno
#   1580 ISHA 許可対象物質     refno
#   3564 CCA 事故備え物質      refno
#   2480 PRTR 第1類            code
#   2479 PRTR 第2類            code
#   9020 POPs 残留性汚染物質   refno
#   6285 RoHS 制限物質         親CAS（remark の `As … [CAS]`）
#
# **`1887` と `1888` は `code` を使う。**`refno` は 2026Q3 で足された欄で、
# 2026Q2 には無い。同じ番号を書き直したものなので、両版にある `code` で結ぶ。
#
# **有害化学物質（10266〜10268）は `refno` を使う。**`code` は `1997-1-0442`、
# `refno` は `97-1-442` で、告示の番号は後者の書き方。この3つは 2026Q3 で
# 足された一覧なので、`refno` が無い版を気にしなくてよい。
#
# 出すのは2種類。
#
#   korea-<名前>.tsv       鍵とCAS（1行 = 1鍵 × 1CAS）
#   korea-<名前>-name.tsv  鍵と、その号の名前（listedunder があるものだけ）
#   korea-<名前>-thr.tsv   鍵と、その号の閾値（`値/単位/種類`）
#
# **閾値は号ごとに違う。**一律ではない。実際に入っている値は次のとおり。
#
#   1580 許可対象      1%（一部 0.5%）      cut-off value allowed in mixture
#   1581 製造等禁止    1%（一部 2%・5%）    同上
#   1887 K-REACH禁止   0.005% 〜 50%        種類の記載なし
#   1888 K-REACH制限   0.009% / 0.1% / 1%   同上
#  10266 急性毒性      0.1% 〜 25%          mixture cut-off
#  10267 慢性毒性      同上                 同上
#  10268 生態毒性      同上                 同上
#   2479 PRTR第2類     >=0.1 / >=1.0 % w/w  cut-off value
#   2480 PRTR第1類     同上
#   3564 CCA事故備え   0.1% 〜 98%          種類の記載なし
#   6285 RoHS          0.1%（カドミは0.01%）maximum concentration value
#   7914 重点管理      CMR・PBT など        ← 閾値ではなく「選ばれた理由」
#   9020 POPs          Present（種類 A/B/C）← 閾値ではなく「条約の附属書」
#
# 後ろの2つは数値ではないので、閾値にはせず備考に回す。
#
# **`-u` を外さない。**付けないと sqlcmd がコンソールの文字コードで書き出す。
#
# **取り出し元のデータベースは差し替えられる。**
# 過去のバージョンを取り込むときは、環境変数で上書きする。
#
#   LOLI_DB=LOLI4_Datafeed_2026Q2 bash scripts/loli-dump-korea.sh
#
# `.env.loli` の値より、呼ぶ側で渡した値を優先する。
set -uo pipefail
cd "$(dirname "$0")/.."
_LOLI_DB_ARG="${LOLI_DB:-}"
set -a; . <(tr -d '\r' < .env.loli); set +a
[ -n "$_LOLI_DB_ARG" ] && LOLI_DB="$_LOLI_DB_ARG"
echo "  取り出し元: $LOLI_DB"
mkdir -p .cache scripts/data

run() { # 1=SQL文字列 2=出力ファイル
  python - "$1" > .cache/korea.sql <<'PY'
import sys
sys.stdout.write(sys.argv[1].replace("\n", "\r\n"))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -u -i ".cache/korea.sql" -o ".cache/korea.u16"
  iconv -f UTF-16LE -t UTF-8 .cache/korea.u16 | sed '1s/^\xEF\xBB\xBF//' | tr -d '\r' \
    | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|cas)\t' | sort -u > "$2"
}

# 1=出力名 2=ListID 3=鍵の欄（code / refno）
dump() {
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, cas FROM (
  SELECT LTRIM(RTRIM(r.value('($3)[1]','varchar(60)'))) AS k, d.Cas AS cas
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = $2
) z WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "scripts/data/korea-$1.tsv"

  # その号の名前。listedunder を持つ一覧だけ出る（無ければ空のファイル）
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, nm FROM (
  SELECT LTRIM(RTRIM(r.value('($3)[1]','varchar(60)'))) AS k,
         LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(
           r.value('(listedunder)[1]','varchar(300)'),
           CHAR(9),' '), CHAR(13),' '), CHAR(10),' '))) AS nm
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = $2
) z WHERE k IS NOT NULL AND k <> '' AND nm IS NOT NULL AND nm <> '' ORDER BY k;" \
    "scripts/data/korea-$1-name.tsv"

  # その号の閾値。`値/単位/種類` を1つにつないで出す
  run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, v FROM (
  SELECT LTRIM(RTRIM(r.value('($3)[1]','varchar(60)'))) AS k,
         LTRIM(RTRIM(ISNULL(r.value('(value)[1]','varchar(60)'),''))) + '/' +
         LTRIM(RTRIM(ISNULL(r.value('(unit)[1]','varchar(60)'),''))) + '/' +
         LTRIM(RTRIM(ISNULL(r.value('(type)[1]','varchar(60)'),''))) AS v
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = $2
) z WHERE k IS NOT NULL AND k <> '' AND v <> '//' ORDER BY k;"     "scripts/data/korea-$1-thr.tsv"

  local n k m
  n=$(grep -c . "scripts/data/korea-$1.tsv" || true)
  k=$(cut -f1 "scripts/data/korea-$1.tsv" | sort -u | grep -c . || true)
  m=$(grep -c . "scripts/data/korea-$1-name.tsv" || true)
  printf '  korea-%-14s %7s 行 / 鍵 %5s 種 / 名前 %5s 種%s\n' "$1" "$n" "$k" "$m" \
    "$([ "$n" = "0" ] && echo '   ← 0件。一覧の書き方が変わった合図' || true)"
}

echo "K-REACH（化学物質登録評価法）"
dump kreach-prohibited 1887 code
dump kreach-restricted 1888 code
dump kreach-priority   7914 refno
dump kreach-toxic-acute   10266 refno
dump kreach-toxic-chronic 10267 refno
dump kreach-toxic-eco     10268 refno

echo "ISHA（産業安全保健法）"
dump isha-ban          1581 refno
dump isha-permit       1580 refno

echo "CCA（化学物質管理法）"
dump cca-accident      3564 refno

echo "PRTR（排出移動量届出）"
dump prtr-c1           2480 code
dump prtr-c2           2479 code

echo "POPs（残留性有機汚染物質管理法）"
dump pops              9020 refno

# RoHS だけは番号を持たず、親物質のCASで結ぶ（EU RoHS と同じ形）
echo "RoHS（資源循環法）"
run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, cas FROM (
  SELECT CASE
           WHEN CHARINDEX('As ', remarks) > 0 AND CHARINDEX('[', remarks) > 0
           THEN SUBSTRING(remarks,
                  CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) + 1,
                  CHARINDEX(']', remarks, CHARINDEX('As ', remarks))
                    - CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) - 1)
           ELSE cas END AS k, cas
  FROM (
    SELECT d.Cas AS cas,
           CAST(r.query('remark').value('.','varchar(1000)') AS varchar(1000)) AS remarks
    FROM ListData d
    CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
    CROSS APPLY x.px.nodes('/root/row') t(r)
    WHERE d.ListID = 6285
  ) y
) z WHERE k IS NOT NULL AND k <> '' ORDER BY k, cas;" "scripts/data/korea-rohs.tsv"
: > scripts/data/korea-rohs-name.tsv
run "SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT DISTINCT k, v FROM (
  SELECT CASE
           WHEN CHARINDEX('As ', remarks) > 0 AND CHARINDEX('[', remarks) > 0
           THEN SUBSTRING(remarks,
                  CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) + 1,
                  CHARINDEX(']', remarks, CHARINDEX('As ', remarks))
                    - CHARINDEX('[', remarks, CHARINDEX('As ', remarks)) - 1)
           ELSE cas END AS k, v
  FROM (
    SELECT d.Cas AS cas,
           CAST(r.query('remark').value('.','varchar(1000)') AS varchar(1000)) AS remarks,
           LTRIM(RTRIM(ISNULL(r.value('(value)[1]','varchar(60)'),''))) + '/' +
           LTRIM(RTRIM(ISNULL(r.value('(unit)[1]','varchar(60)'),''))) + '/' +
           LTRIM(RTRIM(ISNULL(r.value('(type)[1]','varchar(60)'),''))) AS v
    FROM ListData d
    CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
    CROSS APPLY x.px.nodes('/root/row') t(r)
    WHERE d.ListID = 6285
  ) y
) z WHERE k IS NOT NULL AND k <> '' AND v <> '//' ORDER BY k;"   "scripts/data/korea-rohs-thr.tsv"
printf '  korea-%-14s %7s 行 / 鍵 %5s 種\n' "rohs" \
  "$(grep -c . scripts/data/korea-rohs.tsv || true)" \
  "$(cut -f1 scripts/data/korea-rohs.tsv | sort -u | grep -c . || true)"

echo
echo "取り出しました。取り込みは scripts/seed-korea-laws.ts → scripts/seed-korea-links.ts"
