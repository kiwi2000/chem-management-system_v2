#!/usr/bin/env bash
# 中国の目録の**原文**を、官庁のサイトから落とす。
#
#   bash scripts/china-fetch.sh
#
# 落とし先は .cache/china/。2回目からはそこを読むので、繋がらなくても動く。
# 取り出しは scripts/build-china-data.ts。
#
# 気をつけること（`docs/法規制データの作り方.md` 第2章 2-4）
#   - **ページは gzip で返る。**--compressed が要る
#   - User-Agent を付けないと 403 を返すサイトがある
#   - 旧形式の .doc は LibreOffice で HTML に変換してから読む
#   - PDF は pdftotext -layout で読む
set -uo pipefail
cd "$(dirname "$0")/.."

DIR=".cache/china"
mkdir -p "$DIR"

# LibreOffice の場所。Windows とそれ以外で違う
SOFFICE="/c/Program Files/LibreOffice/program/soffice.exe"
[ -x "$SOFFICE" ] || SOFFICE="soffice"

get() { # 1=保存名 2=URL
  if [ -s "$DIR/$1" ]; then
    echo "  $1 は取得済み"
    return 0
  fi
  local code
  code=$(curl -sSL --compressed --max-time 120 -A "Mozilla/5.0" \
    -o "$DIR/$1" -w "%{http_code}" "$2") || { echo "  ✗ $1 取れません"; return 1; }
  if [ "$code" != "200" ]; then
    echo "  ✗ $1 HTTP $code"
    rm -f "$DIR/$1"
    return 1
  fi
  echo "  $1  $(wc -c < "$DIR/$1") バイト"
}

# .doc を HTML に変換する。**旧形式（OLE2）なので中身をそのままは読めない**
doc2html() { # 1=doc名
  local base="${1%.doc}"
  if [ -s "$DIR/$base.html" ]; then
    echo "  $base.html は変換済み"
    return 0
  fi
  "$SOFFICE" --headless --convert-to "html:HTML (StarWriter)" --outdir "$DIR" "$DIR/$1" >/dev/null 2>&1
  [ -s "$DIR/$base.html" ] && echo "  $base.html  $(wc -c < "$DIR/$base.html") バイト" || echo "  ✗ $1 の変換に失敗"
}

pdf2txt() { # 1=pdf名
  local base="${1%.pdf}"
  if [ -s "$DIR/$base.txt" ]; then
    echo "  $base.txt は変換済み"
    return 0
  fi
  pdftotext -layout -enc UTF-8 "$DIR/$1" "$DIR/$base.txt" 2>/dev/null
  [ -s "$DIR/$base.txt" ] && echo "  $base.txt  $(wc -c < "$DIR/$base.txt") バイト" || echo "  ✗ $1 の変換に失敗"
}

echo "=== 危険化学品目録（2015版）2,828品目 ＋ 劇毒化学品目録（備考が「剧毒」）"
echo "    応急管理部 公告2015年第5号"
get hazchem.doc "https://www.mem.gov.cn/gk/gwgg/201503/W020240524633771640375.doc"
doc2html hazchem.doc

echo "=== 易製爆危険化学品名録（2017年版）"
echo "    公安部（工業情報化部が載せている写し）"
get explosive.doc "https://wap.miit.gov.cn/cms_files/filemanager/1226211233/attach/20238/b8e6287c65a741189abf23778afd4324.doc"
doc2html explosive.doc

echo "=== 重点管控新汚染物清单（2023年版）"
echo "    生態環境部ほか5部門 令第28号"
get newpol.html "https://www.mee.gov.cn/gzk/gz/202212/t20221230_1009192.shtml"

echo "=== 優先管理化学品名録（第一批）"
echo "    環境保護部 公告2017年第83号"
get priority1.html "https://www.mee.gov.cn/gkml/hbb/bgg/201712/t20171229_428832.htm"

echo "=== 優先管理化学品名録（第二批）"
echo "    生態環境部 公告2020年第47号"
get priority2.pdf "https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202011/W020201113571806102775.pdf"
pdf2txt priority2.pdf

echo "=== 中国厳格制限有毒化学品名録（2023年）"
echo "    生態環境部 公告2023年第31号"
get restricted.pdf "https://www.mee.gov.cn/xxgk2018/xxgk/xxgk01/202310/W020231019674253866600.pdf"
pdf2txt restricted.pdf

echo
echo "=== まだ出どころを確かめていないもの"
echo "  易製毒化学品品種目録（国務院令第445号 附表）"
echo "  監控化学品目録（国務院令第190号 附件）"
