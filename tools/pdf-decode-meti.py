# 経産省の GHS 仮訳 PDF の文字化けを復元して、ページごとの文字に起こす。
# 原因: MS 明朝・MS ゴシックの埋め込み字体（Identity-H）に文字の対応表が無く、
#       取り出した文字が「字体の中の字の番号（GID）」になっている。
# 直し方: この PC の msmincho.ttc / msgothic.ttc の対応表（Unicode→GID）を逆引きする。
# 使い方: python pdf-decode.py <pdf> <out.txt>
import sys
import pymupdf
from fontTools.ttLib import TTCollection

def gid_to_unicode(path):
    f = TTCollection(path).fonts[0]
    cmap = f.getBestCmap()
    table = {}
    for u, gname in cmap.items():
        table.setdefault(f.getGlyphID(gname), u)
    return table

MINCHO = gid_to_unicode("C:/Windows/Fonts/msmincho.ttc")
GOTHIC = gid_to_unicode("C:/Windows/Fonts/msgothic.ttc")

def table_for(font_name):
    # 埋め込みの字体は "MS-Mincho-90ms-RKSJ-H" のようにハイフン付き。埋め込みでない "MSMincho" はそのままで読める
    n = font_name.lower()
    if "-" not in font_name:
        return None
    if "mincho" in n:
        return MINCHO
    if "gothic" in n:
        return GOTHIC
    return None

def decode_page(page):
    raw = page.get_text("rawdict")
    lines = []
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            chars = []
            for span in line.get("spans", []):
                table = table_for(span.get("font", ""))
                for ch in span.get("chars", []):
                    c = ch["c"]
                    if table is not None:
                        gid = ord(c)
                        u = table.get(gid)
                        c = chr(u) if u else c
                    chars.append(c)
            text = "".join(chars).strip()
            if text:
                lines.append(text)
    return "\n".join(lines)

def main():
    src, out = sys.argv[1], sys.argv[2]
    doc = pymupdf.open(src)
    parts = []
    for i, page in enumerate(doc):
        parts.append(f"=== page {i + 1} ===\n{decode_page(page)}")
    open(out, "w", encoding="utf-8").write("\n".join(parts))
    print(f"{doc.page_count} pages -> {out}")

main()
