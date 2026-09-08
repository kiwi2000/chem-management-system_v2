"""IARC 公式の List of Classifications を、一覧ページが読み込む JS（webapi.iarc.who.int/loc/loc.app.js）
から抜き出して scripts/data/iarc-official.tsv にする。

  curl -sL -A Mozilla/5.0 https://webapi.iarc.who.int/loc/loc.app.js -o .cache/loc.app.js
  python scripts/build-iarc-official.py

JS の中に {name:"...",group:"2B",cas:["75-07-0"],volume:["36","Sup 7","71"],year:1999,yeareval:1998}
の形で全件が埋め込まれている（ページの Excel ボタンはこれを書き出しているだけ）。
group の無い行（「(see …)」の参照行）は出さない。名前の <i>…</i> は落とす。
出る列: 名前 / グループ / CAS（; 区切り） / 巻（; 区切り、古い順） / 公表年 / 評価年 / 刊行準備中（in_prep なら 1）
in_prep は「いちばん新しい巻がまだ刊行されていない」印。刊行済みの巻だけを採る決まり（2026-09-08）は
scripts/lib/iarc-official.ts の readOfficial が scripts/data/iarc-published.tsv と合わせて適用する。ここは一覧のまま
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(ROOT, ".cache", "loc.app.js"), encoding="utf-8", errors="replace").read()

# 項目は name / group / cas / volume / year / yeareval / comment / in_prep。文字列は \" を含むことがある
KEYS = r"(?:group|cas|volume|year|yeareval|comment|in_prep)"
# 数値は 2e3（=2000）のように書かれていることがある
VALUE = r'(?:"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|\[[^\]]*\]|\d+(?:e\d+)?|!0|!1|true|false)'
REC = re.compile(r'\{name:"((?:[^"\\]|\\.)*)"((?:,' + KEYS + ":" + VALUE + r")*)\}")
FIELD = re.compile(r"," + "(" + KEYS[3:-1] + ")" + ":(" + VALUE + ")")


def unescape(name: str) -> str:
    if "\\u" in name:
        name = name.encode("utf-8").decode("unicode_escape")
    name = name.replace('\\"', '"')
    return re.sub(r"</?i>", "", name).strip()


rows = []
for m in REC.finditer(src):
    name = unescape(m.group(1))
    fields = {}
    for f, v in FIELD.findall(m.group(2)):
        if v.startswith("["):
            fields[f] = [x.strip().strip('"') for x in v[1:-1].split(",") if x.strip()]
        else:
            v = v.strip('"').strip()
            if re.fullmatch(r"\d+e\d+", v):
                v = str(int(float(v)))
            fields[f] = v
    group = fields.get("group")
    if not group:
        continue
    rows.append(
        (
            name,
            group,
            ";".join(fields.get("cas", [])),
            ";".join(fields.get("volume", [])),
            fields.get("year", ""),
            fields.get("yeareval", ""),
            "1" if fields.get("in_prep") == "!0" else "",
        )
    )

out = os.path.join(ROOT, "scripts", "data", "iarc-official.tsv")
with io.open(out, "w", encoding="utf-8", newline="\n") as w:
    w.write(
        "# IARC List of Classifications（monographs.iarc.who.int が読み込む loc.app.js から）: 名前 / グループ / CAS / 巻 / 公表年 / 評価年\n"
    )
    for r in rows:
        w.write("\t".join(r) + "\n")

# --diag: 正規表現に合わなかった行を見せる（項目が増えたときの調べもの用）
if "--diag" in os.sys.argv:
    ok = set(m.start() for m in REC.finditer(src))
    missed = [m.start() for m in re.finditer(r'\{name:"', src) if m.start() not in ok]
    print("missed", len(missed))
    for p in missed[:6]:
        print("MISSED:", src[p : p + 320].replace("\n", " "))

by = {}
for r in rows:
    by[r[1]] = by.get(r[1], 0) + 1
with_cas = sum(1 for r in rows if r[2])
in_prep = sum(1 for r in rows if r[6])
print(f"records {len(rows)} by group {by} with CAS {with_cas} in_prep {in_prep}")
