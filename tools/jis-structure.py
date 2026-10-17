# JISC の音声 PDF から起こした文字（=== page N === 区切り、固定幅で折り返し）を、
# 人が読める構造（箇条・注記・表・箇条書き）の付いたテキストに下ごしらえする（2026-10-17）。
# 使い方: python tools/jis-structure.py <文字起こし.txt> <出力.md> <規格番号 例 "Z 7253">
# 出力は「段落ごとに 1 行」の Markdown 風テキスト。表は "【表】" の印を付けて 1 行に流したまま
# （列の組み直しは人が行う）。紙面のページ番号は "⟦p.N⟧" で残す（PDF のページとは違う）。
import re
import sys

src, out, code = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(src, encoding="utf-8").read()

# 1. ページごとに行をつなぐ（折り返しは語の途中でも切れている。行頭の空白は語の区切りなので残す）
pages = re.split(r"=== page (\d+) ===\n", text)
joined = []
header_re = re.compile(r"^\s*(?:(\d+)\s+)?" + re.escape(code) + r"：2025\s*(?:（(\d+)）)?\s*")
for i in range(1, len(pages), 2):
    pdf_no = int(pages[i])
    body = pages[i + 1]
    lines = body.split("\n")
    # 先頭の「18 Z 7253：2025」や「Z 7253：2025 （2）」（紙面のページ番号）を外して印にする
    paper = None
    if lines and lines[0].strip():
        m = header_re.match(lines[0])
        if m:
            paper = m.group(1) or (("(" + m.group(2) + ")") if m.group(2) else None)
            lines[0] = lines[0][m.end():]
    s = "".join(lines)
    s = re.sub(r"[ 　]{2,}", "  ", s)
    joined.append((pdf_no, paper, s))

flat = ""
for pdf_no, paper, s in joined:
    mark = f"⟦p.{paper}⟧" if paper else f"⟦pdf{pdf_no}⟧"
    flat += f" {mark} " + s.strip() + " "

# 2. 構造の区切りを見つけて改行を入れる
# 箇条番号: 「 6.2.3 注意喚起語 」「 B.1.2.2 望ましい試験動物種 」「 附属書A（規定）」「 表B.1－…」「 注記1 」「 注a) 」「 － 」
patterns = [
    (r"\s(附属書\s?[A-Z]{1,2}\s*（(?:規定|参考)）)", r"\n\n## \1\n\n"),
    (r"\s((?:[A-Z]\.)?\d{1,2}(?:\.\d{1,2}){0,4})\s+(?=[^\s0-9.，。）)]{1,40}(?:\s|$))", r"\n\n### \1 "),
    (r"\s(表\s?[A-Z]{0,2}\.?\d+(?:\([a-z]\))?－)", r"\n\n【表】\1"),
    (r"\s(図\s?[A-Z]{0,2}\.?\d+－)", r"\n\n【図】\1"),
    (r"\s(注記\s?\d*)\s", r"\n\n\1 "),
    (r"\s(注\s?[a-z]\))\s", r"\n\n\1 "),
    (r"\s(例\s?\d*)\s(?=[^。]{3,})", r"\n\n\1 "),
    (r"\s－\s", r"\n- "),
    (r"。\s+(?=[^）\]」』])", "。\n\n"),
]
s = flat
for pat, rep in patterns:
    s = re.sub(pat, rep, s)

# 3. 見出しの深さを番号の深さに合わせる（1 → ##、1.1 → ###、1.1.1 → ####）
def heading_level(m):
    num = m.group(1)
    depth = num.count(".") + 1
    return "\n\n" + "#" * min(2 + depth - 1, 5) + " " + num + " "

s = re.sub(r"\n\n### ((?:[A-Z]\.)?\d{1,2}(?:\.\d{1,2}){0,4}) ", heading_level, s)
s = re.sub(r"\n{3,}", "\n\n", s).strip() + "\n"
open(out, "w", encoding="utf-8").write(s)

heads = len(re.findall(r"^#{2,5} ", s, re.M))
tables = len(re.findall(r"^【表】", s, re.M))
figs = len(re.findall(r"^【図】", s, re.M))
print(f"{out}: 行 {s.count(chr(10))}, 見出し {heads}, 表 {tables}, 図 {figs}")
