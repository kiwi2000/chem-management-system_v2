# Markdown（表・Mermaid の図・引用の注記つき）を、印刷向けの HTML にする（2026-10-17。JIS の組み直し用）
# 使い方: python tools/md-to-html.py <入力.md> <出力.html> "<題名>" "<副題>"
# Mermaid は HTML の中で描く（tools/html-to-pdf.mjs が描き終わるのを待って PDF にする）
import re
import sys

import markdown

src, out, title, subtitle = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else ""
md_text = open(src, encoding="utf-8").read()

# 紙面のページ番号 ⟦p.N⟧ → 小さな印
md_text = re.sub(r"⟦p\.([^⟧]+)⟧", r'<span class="pg">p.\1</span>', md_text)
md_text = re.sub(r"⟦pdf\d+⟧", "", md_text)

# JIS の「1) 2)」「a) b)」「(i) (ii)」の項目は、行が続くと 1 つの段落につながるので、1 項目ずつ段落に分ける
md_text = re.sub(r"\n(?=(?:\d{1,2}\)|[a-z]\)|\([ivx]+\)|（[ivx]+）)\s)", "\n\n", md_text)

# ```mermaid ... ``` → <pre class="mermaid">（markdown の fenced_code より先に抜いておく）
blocks = []
def stash(m):
    blocks.append(m.group(1))
    return f"\n\nMERMAIDBLOCK{len(blocks) - 1}\n\n"
md_text = re.sub(r"```mermaid\n(.*?)```", stash, md_text, flags=re.S)

html = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "toc", "sane_lists", "md_in_html", "attr_list"],
    extension_configs={"toc": {"toc_depth": "2-3", "title": "目次"}},
)
for i, b in enumerate(blocks):
    esc = b.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    html = html.replace(f"<p>MERMAIDBLOCK{i}</p>", f'<pre class="mermaid">{esc}</pre>')

# 見出しに目に見えない印（§hN§）を埋める。PDF のしおりを付けるときにこの印でページを探す（規格自身の目次の文字に当たらないため）
counter = [0]
def mark(m):
    counter[0] += 1
    return f'<h{m.group(1)}{m.group(2)}><span class="hmark">§h{counter[0]}§</span>{m.group(3)}</h{m.group(1)}>'
html = re.sub(r"<h([234])([^>]*)>(.*?)</h\1>", mark, html, flags=re.S)

toc = ""
m = re.search(r'<div class="toc">.*?</div>\n', html, flags=re.S)
if m:
    toc = m.group(0)
    html = html.replace(toc, "")

page = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
@page {{ size: A4; margin: 18mm 16mm 20mm 16mm; }}
:root {{ --ink: #1b1f24; --muted: #5a6270; --line: #c9ced6; --band: #eef2f7; --accent: #1f4e79; --add: #7a4b00; --add-bg: #fff7e6; }}
html {{ font-family: "Noto Sans JP", "BIZ UDGothic", "Yu Gothic", "Meiryo", sans-serif; font-size: 10.5pt; line-height: 1.75; color: var(--ink); }}
body {{ margin: 0; }}
.cover {{ page-break-after: always; display: flex; flex-direction: column; justify-content: center; min-height: 240mm; border-left: 6px solid var(--accent); padding-left: 10mm; }}
.cover h1 {{ font-size: 24pt; margin: 0 0 6mm; line-height: 1.4; }}
.cover .sub {{ font-size: 12pt; color: var(--muted); }}
.cover .note {{ margin-top: 20mm; font-size: 9.5pt; color: var(--muted); max-width: 150mm; }}
.toc {{ page-break-after: always; }}
.toc .toctitle {{ font-size: 16pt; font-weight: 700; margin-bottom: 4mm; }}
.toc ul {{ list-style: none; padding-left: 0; margin: 0; }}
.toc ul ul {{ padding-left: 6mm; }}
.toc li {{ margin: 1mm 0; }}
.toc a {{ color: var(--ink); text-decoration: none; }}
h2 {{ font-size: 16pt; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 1.5mm; margin: 12mm 0 4mm; page-break-after: avoid; }}
h3 {{ font-size: 13pt; margin: 8mm 0 3mm; page-break-after: avoid; }}
h4 {{ font-size: 11.5pt; margin: 6mm 0 2mm; page-break-after: avoid; }}
h5, h6 {{ font-size: 10.5pt; margin: 4mm 0 2mm; page-break-after: avoid; }}
p {{ margin: 0 0 2.5mm; text-align: justify; }}
ul, ol {{ margin: 0 0 2.5mm; padding-left: 6mm; }}
li {{ margin: 0.5mm 0; }}
blockquote {{ margin: 2mm 0 3mm; padding: 1.5mm 4mm; border-left: 3px solid var(--line); background: var(--band); font-size: 9.8pt; }}
blockquote p {{ margin: 0 0 1mm; }}
blockquote.add, .add {{ border-left-color: var(--add); background: var(--add-bg); }}
table {{ border-collapse: collapse; width: 100%; margin: 2mm 0 4mm; font-size: 9.2pt; line-height: 1.5; page-break-inside: auto; }}
th, td {{ border: 1px solid var(--line); padding: 1.2mm 2mm; vertical-align: top; text-align: left; }}
th {{ background: var(--band); font-weight: 700; word-break: keep-all; }}
tr {{ page-break-inside: avoid; }}
thead {{ display: table-header-group; }}
pre.mermaid {{ background: #fff; border: 1px solid var(--line); padding: 3mm; margin: 2mm 0 4mm; page-break-inside: avoid; text-align: center; }}
pre.mermaid svg {{ max-width: 100%; max-height: 235mm; width: auto; height: auto; }}
/* 図の見出し（**図B.12－…** の段落）と図を同じページに置く */
p:has(+ pre.mermaid), p:has(+ p + pre.mermaid), blockquote:has(+ pre.mermaid) {{ page-break-after: avoid; break-after: avoid; }}
p:has(+ table), p:has(+ p + table) {{ page-break-after: avoid; break-after: avoid; }}
code {{ font-family: "Consolas", "BIZ UDGothic", monospace; font-size: 9.2pt; }}
.hmark {{ font-size: 1pt; color: transparent; position: absolute; }}
.pg {{ display: inline-block; font-size: 7.5pt; color: var(--muted); border: 1px solid var(--line); border-radius: 2px; padding: 0 1mm; margin: 0 1mm; vertical-align: middle; }}
strong {{ font-weight: 700; }}
.note-attention {{ color: #a40000; }}
</style>
</head>
<body>
<section class="cover">
  <h1>{title}</h1>
  <div class="sub">{subtitle}</div>
  <div class="note">
    この文書は、JISC の閲覧用（読み上げ用）PDF から文字を取り出し、本文を変えずに見出し・表・図を組み直したもの。
    <b>「図解（補足）」と記した図は、この規格に無く、読みやすさのために加えたもの。</b>
    <span class="pg">p.N</span> は原本の紙面のページ番号。【要確認】は組み直しの際に対応に自信の無かった箇所。
    規格の著作権は日本規格協会にある。社内の参照用。配布しない。
  </div>
</section>
{toc}
{html}
</body>
</html>
"""
open(out, "w", encoding="utf-8").write(page)
print(f"{out}: {len(page)} bytes, mermaid {len(blocks)}")
