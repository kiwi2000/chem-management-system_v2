#!/usr/bin/env bash
# LOLI（社内SQL Server）から鍵とCASを取り出して scripts/data/*.tsv に落とす。
# 接続情報は .env.loli（gitに載せない）。
#
#   bash scripts/loli-dump.sh            全部
#   bash scripts/loli-dump.sh cscl       法律を絞る（cscl / prtr / pdsca / isha / env / cwca / us / eu）
#
# **取り出し元は ListData.XML。**
# `Data` 欄は表示用に文章化したもので、番号が落ちている一覧がある（土対法・有機溶剤・
# 特別管理物質・化兵法）。欄別の元データは XML 欄にあり、そちらには番号が入っている。
# Datafeed 説明書 4.13 ListData を参照。欄の意味は ListNames_Control.XML_Admin で定義。
#
# **どの一覧をどの欄で取るかは `docs/法規制データの作り方.md` 第4章 4-2。**
# ここを増やしたら、そちらの表にも足す。
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

ONLY="${1:-all}"
want() { [ "$ONLY" = "all" ] || [ "$ONLY" = "$1" ]; }

# XML の欄を読む式。row を r として渡す
V() { echo "r.value('($1)[1]','varchar(200)')"; }
CODE=$(V code); REFNO=$(V refno); VALUE=$(V value); NOTE=$(V note); ADD=$(V addinfo)
TYPE=$(V type); CAT=$(V category); GRP=$(V group)
# 1つの row に remark が何本も入るので、まとめて1つの文字列にして見る
REMARKS="CAST(r.query('remark').value('.','varchar(1000)') AS varchar(1000))"

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
  # 2列でない行と見出し行を落とす。**0件でも止めない**（一覧の書き方が変わった合図として残す）
  tr -d '\r' < "scripts/data/$1.tsv" | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^(k|num|gazette)\t' \
    > "scripts/data/$1.clean" || true
  mv "scripts/data/$1.clean" "scripts/data/$1.tsv"
  local n k
  n=$(grep -c . "scripts/data/$1.tsv" || true)
  k=$(cut -f1 "scripts/data/$1.tsv" | sort -u | grep -c . || true)
  printf '  %-24s %6s 行 / 鍵 %4s 種%s\n' "$1" "$n" "$k" "$([ "$n" = "0" ] && echo '   ← 0件。書き方が変わった合図' || true)"
}

# CasKeys（物質側の別名の番号）から取る。1=出力名 2=DataKeyType
dump_key() {
  python - "$2" > scripts/sql/_tmp.sql <<'PYK'
import io,sys
t=io.open("scripts/sql/loli-caskey.sql",encoding="utf-8").read()
sys.stdout.write(t.replace("{KEY_TYPE}",sys.argv[1]))
PYK
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -i scripts/sql/_tmp.sql -o "scripts/data/$1.tsv"
  tr -d '\r' < "scripts/data/$1.tsv" | grep -P '^[^\t]+\t[^\t]+$' | grep -vP '^k\t' \
    > "scripts/data/$1.clean" || true
  mv "scripts/data/$1.clean" "scripts/data/$1.tsv"
  local n k
  n=$(grep -c . "scripts/data/$1.tsv" || true)
  k=$(cut -f1 "scripts/data/$1.tsv" | sort -u | grep -c . || true)
  printf '  %-24s %6s 行 / 鍵 %4s 種\n' "$1" "$n" "$k"
}

# 総称の親の鍵。`<remark>As Cyanide compounds [RR-00812-8]</remark>` の角括弧の中。
# **一番うしろの角括弧を見る**（名前の中にも角括弧が出てくる）。無ければ行のCAS自身
REM="r.value('(remark[substring(.,1,3)=\"As \"])[1]','varchar(400)')"
QPOS="CHARINDEX('[', REVERSE($REM))"
PARENT="CASE WHEN $QPOS > 2 THEN SUBSTRING($REM, LEN($REM)-$QPOS+2, $QPOS-2) ELSE d.Cas END"

# --- 化審法 -----------------------------------------------------------------
if want cscl; then
  echo "化審法"
  # 第一種・第二種は同じ一覧（631）。`value` が Class I / Class II。
  # **枝番の号は type 側に政令番号が書かれる**（`Cabinet Order Number 35 Subitem (c), ...`）。
  # その場合 code は省令番号なので、type の数字のほうを採る
  # **式は1行で書くこと。**改行を挟むと途中で切れて構文エラーになる
  CSCL_KEY="CASE WHEN $TYPE LIKE 'Cabinet Order Number [0-9]%' THEN LEFT(SUBSTRING($TYPE,22,8), PATINDEX('%[^0-9]%', SUBSTRING($TYPE,22,8)+' ')-1) ELSE $CODE END"
  dump loli-cscl-c1  631  "$CSCL_KEY" "AND $VALUE = 'Class I'"
  dump loli-cscl-c2  631  "$CSCL_KEY" "AND $VALUE = 'Class II'"
  dump loli-cscl-mon 634  "$VALUE"    "AND $TYPE = 'Official Gazette Number'"
  dump loli-cscl-pri 4589 "$VALUE"    "AND $TYPE = 'Substance control number'"
  # 特定一般化学物質だけ通し番号が無く、官報公示整理番号（`(5)-7124`）で突き合わせる
  dump loli-cscl-sgn 10077 "REPLACE(REPLACE($CODE,'(',''),')','')"
fi

# --- 化管法 -----------------------------------------------------------------
# **Control No.（value）は別の番号。**政令番号は note 欄
if want prtr; then
  echo "化管法"
  dump loli-prtr-c1  9013 "$NOTE"
  dump loli-prtr-sc1 9013 "$NOTE" "AND $CAT = 'Specific class 1'"
  dump loli-prtr-c2  9014 "$NOTE"
  # **条件つきのリンクを別に取る。**
  # LOLI は総称（`As Xylenol [1300-71-6]`）から個々の異性体へ広げ、
  # 「政令の名称が定める条件に合致すること」という但し書きを付ける。
  # 炭素数や置換位置で絞られた号（`1-ドデカノール`『炭素数が10のものに限る』）で出る。
  # そのまま該当にすると**2-ノナノールが1-ドデカノールとして出る**ので、印を付ける
  COND="$REMARKS LIKE '%conditions stipulated by the Cabinet Order name%'"
  dump loli-prtr-c1-cond 9013 "$NOTE" "AND $COND"
  dump loli-prtr-c2-cond 9014 "$NOTE" "AND $COND"
fi

# --- 毒劇法 -----------------------------------------------------------------
# **鍵が2種類ある。**指定令（`Order Article 1-17`）と法の別表（`Law Table 1-1`）
if want pdsca; then
  echo "毒劇法（指定令）"
  dump loli-pdsca-tox   1015 "REPLACE($CODE,'Order Article ','')" "AND $CAT='Poisonous'   AND $CODE LIKE 'Order Article%'"
  dump loli-pdsca-del   1015 "REPLACE($CODE,'Order Article ','')" "AND $CAT='Deleterious' AND $CODE LIKE 'Order Article%'"
  echo "毒劇法（法別表）"
  dump loli-pdsca-tox-l 1015 "REPLACE($CODE,'Law Table ','')"     "AND $CAT='Poisonous'   AND $CODE LIKE 'Law Table%'"
  dump loli-pdsca-del-l 1015 "REPLACE($CODE,'Law Table ','')"     "AND $CAT='Deleterious' AND $CODE LIKE 'Law Table%'"
fi

# --- 安衛法 -----------------------------------------------------------------
if want isha; then
  echo "安衛法"
  # **表示・通知の物質は3つの表から来る。**どれも1から番号が振られるので、
  # 番号に出典を入れて区別する（第0-3章）。3本とも取らないと取り残しが出る
  #   則別表第2      … 9908 / 9906
  #   令別表第9      … 9907 / 9905
  #   令別表第3第1号 … 1818（製造許可物質。表示・通知の対象でもある）
  dump loli-isha-label     9908 "$CODE"
  dump loli-isha-sds       9906 "$CODE"
  dump loli-isha-label-t9  9907 "$CODE"
  dump loli-isha-sds-t9    9905 "$CODE"
  # 1818 には令第17条（石綿分析用試料）も混ざる。addinfo で別表のぶんだけ採る
  dump loli-isha-mfgpermit 1818 "$CODE" "AND $ADD = 'Cabinet Order - Attached Table'"
  dump loli-isha-mfgban    1816 "$CODE"
  dump loli-isha-spec1     2226 "$CODE" "AND $GRP = 'Group 1'"
  dump loli-isha-spec2     2226 "$CODE" "AND $GRP = 'Group 2'"
  dump loli-isha-spec3     2226 "$CODE" "AND $GRP = 'Group 3'"
  # **有機溶剤と特別管理物質は Data に番号が無く、refno にある。**
  # 特別管理物質の refno は `1-01` `2-13-2` で、第1類・第2類の別まで入っている
  dump loli-isha-org       1813 "$REFNO"
  dump loli-isha-spm       4534 "$REFNO"
fi

# --- 環境系4法 ---------------------------------------------------------------
if want env; then
  echo "環境系"
  # 大気汚染防止法 有害物質（令第1条）は「ばい煙」の一覧。
  # **3074（有害大気汚染物質）は別物**なので使わない
  dump loli-apa-hazard  7782 "REPLACE($REFNO,'Cabinet Order Article 1-','')" "AND $REFNO LIKE 'Cabinet Order Article 1-%'"
  # 水質汚濁防止法
  dump loli-wpca-hazard 5605 "REPLACE($CODE,'Cabinet Order Article 2-','')"  "AND $CODE  LIKE 'Cabinet Order Article 2-%'"
  dump loli-wpca-desig  5606 "$VALUE" "AND $TYPE = 'Cabinet Order Article 3-3 Number'"
  # 土壌汚染対策法。**Data には番号が無く、refno に `01`〜`26` が入っている**
  dump loli-scca        4021 "$REFNO"
fi

# --- 化学兵器禁止法 -----------------------------------------------------------
# 別表の項ごとに一覧が分かれている。refno が号番号
if want cwca; then
  echo "化学兵器禁止法"
  dump loli-cwca-spec-tox   4048 "$REFNO"
  dump loli-cwca-spec-prec  4043 "$REFNO"
  dump loli-cwca-d1-tox     4055 "$REFNO"
  dump loli-cwca-d1-prec    4050 "$REFNO"
  dump loli-cwca-d2-tox     4057 "$REFNO"
  dump loli-cwca-d2-prec    4056 "$REFNO"
fi

# --- 米国 ---------------------------------------------------------------------
# **どちらも一覧に番号が無い。**法令が CAS で規定しているので、こちらの番号が CAS。
# LOLI の総称の親（`As … [CAS]`）、無ければ行のCAS自身と突き合わせる
if want us; then
  echo "米国"
  dump loli-us-tri    428 "$PARENT"   # EPCRA 第313条（TRI）
  dump loli-us-tsca6  635 "$PARENT"   # TSCA 第6条 規制物質
fi

# --- EU -----------------------------------------------------------------------
if want eu; then
  echo "EU"
  # 認可対象（附属書XIV）・制限（附属書XVII）は addinfo が項番号。
  # **附属書XVII の `10[a]` はそのまま出す。**枝の扱いは取り込む側で決める
  # （`18[a]` は項18の枝ではなく、項 `18a`（水銀）だった。第4章 4-2d）
  dump loli-eu-annex14 3614 "$ADD"
  dump loli-eu-annex17 2459 "$ADD"
  # 認可候補（SVHC）は refno が EC番号。無い行は総称の親（CAS）で引く
  dump loli-eu-svhc    3611 "COALESCE(NULLIF($REFNO,''), $PARENT)"
  # **CLP 附属書VI だけ一覧に Index番号が無い。**物質側の別名の番号から引く
  dump_key loli-eu-clp6 Annex
fi

rm -f scripts/sql/_tmp.sql
echo
echo "取り出しました。取り込みは scripts/seed-cas-links.ts"
echo "番号が無いのは大防法 特定粉じん（3070・石綿1件）だけ。ここは対応表で結ぶ"
