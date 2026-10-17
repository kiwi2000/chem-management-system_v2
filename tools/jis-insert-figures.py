# JIS の読みやすい版（Markdown）に、本物の PDF から切り出した原図・絵表示・表示例を差し込む（2026-10-17）。
# 使い方: python tools/jis-insert-figures.py <book.md（上書き）> <7252|7253> <docs/GHS分類の原典/JIS>
# 図は <JIS フォルダ>/figs/ にある前提（相対パス figs/… で参照する。HTML はその JIS フォルダに作る）。
import json
import os
import re
import sys

md_path, code, jis_dir = sys.argv[1], sys.argv[2], sys.argv[3]
md = open(md_path, encoding="utf-8").read()
figs = os.path.join(jis_dir, "figs")

PAGE_RE = re.compile(r"_p(\d+)")


def pageof(f):
    m = PAGE_RE.search(f)
    return m.group(1) if m else "?"


if code == "7252":
    # 判定論理などの図: 「**図A.1－…**」の見出し行の直後に原図（本物の PDF の切り抜き）を入れ、描き直し（Mermaid）はその下に残す
    mapping = json.load(open(os.path.join(figs, "z7252_map.json"), encoding="utf-8"))
    used = set()

    def insert(m):
        name = m.group(2)
        files = mapping.get(name)
        if not files:
            return m.group(0)
        used.add(name)
        imgs = "\n\n".join(
            '<img class="fig" src="figs/%s" alt="図%s 原図（JIS Z 7252:2025 p.%s）">'
            % (os.path.basename(f), name, pageof(f))
            for f in files
        )
        pages = "・".join(pageof(f) for f in files)
        note = (
            "> **原図**　JIS Z 7252:2025 の PDF %s ページから切り出したもの。"
            "下の図は、これを読みやすく描き直したもの（描き直しは原図を正とする）。" % pages
        )
        return "%s\n\n%s\n\n%s" % (m.group(0), note, imgs)

    md, n = re.subn(r"^(\*\*図\s?([A-Z]{0,2}\.?\d+)\s?－[^\n]*\*\*)\s*$", insert, md, flags=re.M)
    print("原図を差し込んだ図: %d（切り出しのある図 %d、使った %d）" % (n, len(mapping), len(used)))
    unused = sorted(set(mapping) - used)
    if unused:
        print("  見出しが見つからず使わなかった図:", unused)

if code == "7253":
    # 絵表示: 「（GHS02）」のようにコードが書かれた所の前に絵を置く（表 2 とラベル要素の表）
    def pict(m):
        return '<img class="pict" src="figs/%s.png" alt="%s">%s' % (m.group(1), m.group(1), m.group(0))

    md, n = re.subn(r"[（(](GHS0[1-9])[）)]", pict, md)
    print("絵表示を置いた箇所: %d" % n)
    # 附属書 F の表示例: 「（参考例1）」の行の後に本物のページの切り抜きを入れる（図は文字起こしに無い）
    pages = sorted(f for f in os.listdir(figs) if f.startswith("z7253_annexF_"))
    if pages:
        imgs = "\n\n".join(
            '<img class="fig" src="figs/%s" alt="附属書F 表示例（JIS Z 7253:2025 PDF %s ページ）">' % (f, pageof(f))
            for f in pages
        )
        block = (
            "\n\n> **原図**　附属書 F の表示例は文字では表せないので、JIS Z 7253:2025 の PDF の該当ページをそのまま入れた。\n\n"
            + imgs
            + "\n"
        )
        md, n = re.subn(r"(^（参考例1）\s*$)", lambda m: m.group(1) + block, md, count=1, flags=re.M)
        print("附属書 F の表示例のページ: %d（差し込み %d）" % (len(pages), n))

open(md_path, "w", encoding="utf-8").write(md)
