"""CHRIP の物質ページ（.cache/chrip/detail/*.html）から IARC の発がん性評価を抜き出す。

ページの「国際がん研究機関（IARC）：発がん性評価」の欄には、評価ごとに
  Volume / 公表年 / Agent名称 / 発がん性グループ / 詳細情報
が並ぶ。1つの物質に複数の評価が付くことがある（Volume が出るたびに1件）。

  python scripts/chrip-iarc-extract.py        → scripts/data/iarc-chrip.tsv

出る列: CAS / グループ / Agent名称 / Volume / 公表年 / CHRIP_ID
取り込みは scripts/seed-iarc-chrip-links.ts。
"""
import glob
import html as htmlmod
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".cache", "chrip", "detail")
OUT = os.path.join(ROOT, "scripts", "data", "iarc-chrip.tsv")

HEAD = "国際がん研究機関（IARC）：発がん性評価"
KEYS = ("Volume", "公表年", "Agent名称", "発がん性グループ", "詳細情報")


def lines(text: str):
    text = re.sub(r"<script.*?</script>", " ", text, flags=re.S)
    text = re.sub(r"<style.*?</style>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = htmlmod.unescape(text).replace("\xa0", " ")
    return [l.strip() for l in text.split("\n") if l.strip()]


def extract(path: str):
    ls = lines(io.open(path, encoding="utf-8", errors="replace").read())
    cid = ls[ls.index("CHRIP_ID") + 1] if "CHRIP_ID" in ls else os.path.basename(path).split(".")[0]
    cas = ls[ls.index("CAS RN") + 1] if "CAS RN" in ls else None
    if HEAD not in ls or not cas:
        return []
    i = ls.index(HEAD) + 1
    rows = []
    cur = None
    while i < len(ls):
        l = ls[i]
        # 次の情報源の見出し（「…：発がん性評価」「…：…」の形）に当たったら終わり
        if l != HEAD and re.search(r"[（(][A-Z]{2,6}[）)][：:]", l):
            break
        if l == "Volume":
            cur = {"Volume": ls[i + 1] if i + 1 < len(ls) else ""}
            rows.append(cur)
            i += 2
            continue
        if cur is not None and l in KEYS[1:4]:
            cur[l] = ls[i + 1] if i + 1 < len(ls) else ""
            i += 2
            continue
        i += 1
    out = []
    for r in rows:
        group = (r.get("発がん性グループ") or "").strip()
        agent = (r.get("Agent名称") or "").strip()
        if not group or not agent:
            continue
        out.append((cas, group, agent, (r.get("Volume") or "").strip(), (r.get("公表年") or "").strip(), cid))
    return out


def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.html")))
    rows = []
    for f in files:
        rows.extend(extract(f))
    seen = set()
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as w:
        w.write("# CHRIP の物質ページから抜いた IARC 発がん性評価: CAS / グループ / Agent名称 / Volume / 公表年 / CHRIP_ID\n")
        for r in rows:
            key = (r[0], r[1], r[2])
            if key in seen:
                continue
            seen.add(key)
            w.write("\t".join(r) + "\n")
    by = {}
    for r in rows:
        by[r[1]] = by.get(r[1], 0) + 1
    print(f"files {len(files)}  rows {len(rows)}  unique {len(seen)}  by group {by}")


if __name__ == "__main__":
    main()
