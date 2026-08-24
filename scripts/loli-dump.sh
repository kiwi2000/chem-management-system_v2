#!/usr/bin/env bash
# LOLI（社内SQL Server）から鍵とCASを取り出して scripts/data/*.tsv に落とす。
# 接続情報は .env.loli（gitに載せない）。
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . <(tr -d '\r' < .env.loli); set +a

dump() { # 1=出力名 2=ListID 3=CLASS_LIKE 4=START 5=END
  python - "$2" "$3" "$4" "$5" > scripts/sql/_tmp.sql <<'PY'
import io,sys
t=io.open("scripts/sql/loli-key-cas.sql",encoding="utf-8").read()
sys.stdout.write(t.replace("{LIST_ID}",sys.argv[1]).replace("{CLASS_LIKE}",sys.argv[2])
                  .replace("{START}",sys.argv[3]).replace("{END}",sys.argv[4]))
PY
  sqlcmd -S "tcp:$LOLI_SERVER,1433" -U "$LOLI_USER" -P "$LOLI_PASSWORD" -C -d "$LOLI_DB" \
    -h -1 -W -s $'\t' -i scripts/sql/_tmp.sql -o "scripts/data/$1.tsv"
  tr -d '\r' < "scripts/data/$1.tsv" | grep -P '^[^\t]+\t[^\t]+$' | grep -v '^k\t' > "scripts/data/$1.clean"
  mv "scripts/data/$1.clean" "scripts/data/$1.tsv"
  echo "$1: $(grep -c . "scripts/data/$1.tsv") 行 / 鍵 $(cut -f1 "scripts/data/$1.tsv" | sort -u | wc -l) 種"
}

# 化管法
dump loli-prtr-c1  9013 ""                 "Ordinance No. " ","
dump loli-prtr-sc1 9013 "Specific class 1" "Ordinance No. " ","
dump loli-prtr-c2  9014 ""                 "Ordinance No. " ","
# 毒劇法
dump loli-pdsca-tox 1015 "Poisonous"   "[Order Article " "]"
dump loli-pdsca-del 1015 "Deleterious" "[Order Article " "]"
# 安衛法
# 表示・通知は「則別表第2」の番号で突き合わせる。令別表第9（9905/9907）は号が33しかない
dump loli-isha-label      9908 ""        "(Attached table, "               ","
dump loli-isha-sds        9906 ""        "(Attached table, "               ","
dump loli-isha-mfgpermit  1818 ""        "Attached Table, "                ","
dump loli-isha-mfgban     1816 ""        "(Article, "                      ","
dump loli-isha-spec1      2226 "Group 1" "(["                              "]"
dump loli-isha-spec2      2226 "Group 2" "(["                              "]"
dump loli-isha-spec3      2226 "Group 3" "(["                              "]"

rm -f scripts/sql/_tmp.sql
