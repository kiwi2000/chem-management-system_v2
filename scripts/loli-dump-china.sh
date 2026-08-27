#!/usr/bin/env bash
#
# 中国の法規制を LOLI から取り出す。
#
#   bash scripts/loli-dump-china.sh            scripts/data/ に落とす
#
# 接続情報は .env.loli（gitに載せない）。
# 取り出すのは **SDS の第15項（法規情報）で名前が挙がるもの**。
# どの一覧が何にあたるかは docs/LOLI取り込み記録_中国.md に書いてある。
#
# **取り出し元は ListData.XML。**日本と同じ（法規制データの作り方 第4章 4-0）。
# 以前は `Data` の文章を取り込み側で解析していたが、
# **1つのCASに複数の行があると先頭しか読めなかった**（1,604行が落ちていた）。
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

V() { echo "r.value('($1)[1]','varchar(200)')"; }
REFNO=$(V refno)

# 総称の親の鍵。**SQL Server の XQuery に starts-with は無い**ので substring で見る。
# `<remark>As Mercury compounds [RR-00138-7]</remark>` の角括弧の中。
# 無ければ行のCAS自身（＝1項目1CAS）
REM="r.value('(remark[substring(.,1,3)=\"As \"])[1]','varchar(400)')"
# **角括弧は名前の中にも出てくる**（`1-(methylamino)ethyl ...`）ので、
# 一番うしろの `[` から `]` までを鍵とする
# `Q` は末尾から見た `[` の位置。角括弧が無ければ 0 になるので、そのときは行のCAS
Q="CHARINDEX('[', REVERSE($REM))"
PARENT="CASE WHEN $Q > 2 THEN SUBSTRING($REM, LEN($REM)-$Q+2, $Q-2) ELSE d.Cas END"

# 1=出力名 2=ListID 3=鍵を作る式 4=絞り込み（省略可）
dump() {
  python - "$2" "$3" "${4:-}" > scripts/sql/_tmp.sql <<'PY'
import io,sys
t=io.open("scripts/sql/loli-xml-cas.sql",encoding="utf-8").read()
sys.stdout.write(t.replace("{LIST_ID}",sys.argv[1]).replace("{KEYEXPR}",sys.argv[2])
                  .replace("{FILTER}",sys.argv[3]))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -i scripts/sql/_tmp.sql -o "scripts/data/$1.tsv"
  tr -d '\r' < "scripts/data/$1.tsv" | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^k\t' \
    > "scripts/data/$1.clean" || true
  mv "scripts/data/$1.clean" "scripts/data/$1.tsv"
  local n k
  n=$(grep -c . "scripts/data/$1.tsv" || true)
  k=$(cut -f1 "scripts/data/$1.tsv" | sort -u | grep -c . || true)
  printf '  %-24s %6s 行 / 鍵 %5s 種%s\n' "$1" "$n" "$k" "$([ "$n" = "0" ] && echo '   ← 0件。書き方が変わった合図' || true)"
}

echo "中国（番号で結べるもの）"
# refno が目録の序号。**原文の序号と同じもの**なので、そのまま突き合わせられる
dump china-haz        2579 "$REFNO"   # 危险化学品目录
dump china-hypertox   1945 "$REFNO"   # 剧毒化学品目录
dump china-explosive  5380 "$REFNO"   # 易制爆危险化学品名录（`1.1` `2.10` の形）
dump china-priority1  7583 "$REFNO"   # 优先控制化学品名录（第一批。`PC001`）
dump china-priority2  8535 "$REFNO"   # 优先控制化学品名录（第二批。`PC023`）
dump china-newpol     9637 "$REFNO"   # 重点管控新污染物清单
dump china-restricted 3683 "$REFNO"   # 中国严格限制的有毒化学品名录（`1-01`）

echo "中国（LOLI に番号が無いもの）"
# 易制毒（2171）と监控（988）は refno を持たない。総称の親を鍵にする
dump china-precursor  2171 "$PARENT"
dump china-controlled  988 "$PARENT"

# --- 受け皿を作るための素の取り出し -------------------------------------------
# `scripts/seed-china.ts` は法令・区分・分類を作り、**原文をまだ取れていない
# 易製毒と監控の法文物質名**を LOLI から作る。そこで `Cas` と `Data` をそのまま渡す。
# 突合にはこちらを使わない（第4章 4-2c）。
echo "中国（受け皿を作る用。Cas と Data をそのまま）"
for id in 1945 2579 2171 5380 988 7583 8535 9637 3683; do
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB"     -h -1 -W -s $'	' -Q "SET NOCOUNT ON; SELECT CAST(Cas AS varchar(20)), CAST(Data AS varchar(400)) FROM ListData WHERE ListID=$id"     -o "scripts/data/china-$id.tsv"
  tr -d '' < "scripts/data/china-$id.tsv" | grep -P '^[^	]+	' > "scripts/data/china-$id.clean" || true
  mv "scripts/data/china-$id.clean" "scripts/data/china-$id.tsv"
  printf '  %-24s %6s 行
' "china-$id" "$(grep -c . "scripts/data/china-$id.tsv" || true)"
done

rm -f scripts/sql/_tmp.sql
echo
echo "取り出しました。"
echo "  受け皿   scripts/seed-china.ts        （china-<ListID>.tsv を読む）"
echo "  法文物質名 scripts/seed-china-laws.ts   （原文から）"
echo "  CASリンク  scripts/seed-china-links.ts  （上の鍵つきTSVから）"
