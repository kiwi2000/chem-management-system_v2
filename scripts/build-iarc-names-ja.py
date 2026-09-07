"""日本語版 Wikipedia「IARC発がん性リスク一覧」の wikitext から、英語名 → 日本語名の対応表を作る。

行の形:  | [[アフラトキシン]] (Aflatoxins) || 通常は混合物
         | [[六価クロム]]化合物 (Chromium[VI] compounds) || グループとして評価
最後のカッコが英語名。wiki のリンク [[a|b]] は b、[[a]] は a に直す。
"""
import io
import re

ROOT = "C:/Users/moris/Documents/dev/chem-management-system_v2/"
src = io.open(ROOT + ".cache/iarc-wiki.txt", encoding="utf-8").read()

rows = []
group = None
for line in src.split("\n"):
    m = re.match(r"^==\s*(グループ\S+)\s*==", line)
    if m:
        group = m.group(1)
        continue
    if not line.startswith("|") or line.startswith("|-") or line.startswith("|}") or group is None:
        continue
    cell = line[1:].split("||")[0].strip()
    # リンクをほどく
    cell = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", cell)
    cell = re.sub(r"\[\[([^\]]*)\]\]", r"\1", cell)
    cell = re.sub(r"<[^>]+>", "", cell).replace("&nbsp;", " ").strip()
    m = re.match(r"^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$", cell)
    if not m:
        continue
    ja, en = m.group(1).strip(), m.group(2).strip()
    if not ja or not en or re.search(r"[ぁ-んァ-ン一-龥]", en):
        continue
    rows.append((en, ja, group))

out = io.open(ROOT + "scripts/data/iarc-names-ja.tsv", "w", encoding="utf-8", newline="\n")
out.write("# 日本語版 Wikipedia「IARC発がん性リスク一覧」から取った 英語名 → 日本語名（2026-09-07）\n")
seen = set()
n = 0
for en, ja, group in rows:
    key = en.lower()
    if key in seen:
        continue
    seen.add(key)
    out.write(f"{en}\t{ja}\t{group}\n")
    n += 1
out.close()
by_group = {}
for _, _, g in rows:
    by_group[g] = by_group.get(g, 0) + 1
print("pairs", n, by_group)
