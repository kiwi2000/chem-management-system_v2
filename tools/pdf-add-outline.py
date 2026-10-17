# 組み上げた PDF に「しおり」（見出しの一覧）を付ける（2026-10-17）。
# HTML の h2〜h4 の見出しを拾い、PDF の中でその文字が最初に出るページを探して付ける。
# 使い方: python tools/pdf-add-outline.py <入力.html> <PDF（上書き）>
import re
import sys

import pymupdf

html_path, pdf_path = sys.argv[1], sys.argv[2]
html = open(html_path, encoding="utf-8").read()

heads = []
for m in re.finditer(r"<h([234])[^>]*>(.*?)</h\1>", html, flags=re.S):
    level = int(m.group(1)) - 1  # h2 → 1
    text = re.sub(r"<[^>]+>", "", m.group(2))
    text = re.sub(r"\s+", " ", text).strip()
    if text:
        heads.append((level, text))

doc = pymupdf.open(pdf_path)
page_texts = [re.sub(r"\s+", "", p.get_text()) for p in doc]
toc = []
cursor = 0  # 見出しは本文の順に出るので、前の見出しのページから先だけ探す
for level, text in heads:
    key = re.sub(r"\s+", "", text)[:40]
    hit = None
    for i in range(cursor, len(page_texts)):
        if key in page_texts[i]:
            hit = i
            break
    if hit is None:
        continue
    cursor = hit
    toc.append([level, text, hit + 1])

# しおりの深さは飛ばせない（1 の次に 3 は不可）ので、詰める
fixed = []
prev = 0
for level, text, page in toc:
    level = min(level, prev + 1)
    fixed.append([level, text, page])
    prev = level
doc.set_toc(fixed)
doc.save(pdf_path, incremental=True, encryption=pymupdf.PDF_ENCRYPT_KEEP)
print(f"{pdf_path}: しおり {len(fixed)} 件（見出し {len(heads)} 件）")
