# 納品フォルダを HTML で組み直す。
#   Markdown → HTML（画像は images/<文書名>/ に別置き、見出しの目次と「目次に戻る」付き）
#   すでに HTML のもの（導入手順書）→ 「目次に戻る」だけ差し込む
#   元が PDF しか無いもの（費用概算）と docx → そのまま写す
import html, io, os, re, shutil, urllib.parse

os.chdir(r"C:\Users\moris\Documents\dev\chem-management-system_v2")
DST = "docs/納品_2026-09-20"
TITLE = "ケミカルコンプライアンス支援システム　提供文書一式（2026-09-20）"

# ── Markdown → HTML（.cache/md2html.py と同じ書きかたを扱う。見出しに id と目次を足した） ──
def inline(t):
    t = html.escape(t, quote=False)
    holes = []
    def keep(m):
        holes.append(m.group(1)); return "\x00%d\x00" % (len(holes) - 1)
    t = re.sub(r"`([^`]+)`", keep, t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    for i, c in enumerate(holes):
        t = t.replace("\x00%d\x00" % i, "<code>%s</code>" % c)
    return t


def convert(src_text, src_dir, img_dir, img_rel):
    """本文の HTML、見出しの一覧 [(level, id, text)]、写した画像の数 を返す"""
    lines = src_text.split("\n"); out = []; para = []; heads = []; nimg = 0; i = 0
    def flush():
        nonlocal para
        if para:
            out.append("<p>%s</p>" % inline(" ".join(x.strip() for x in para))); para = []
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            flush(); buf = []; i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i]); i += 1
            out.append("<pre>%s</pre>" % html.escape("\n".join(buf))); i += 1; continue
        m = re.match(r"^(#{1,4}) (.+)$", ln)
        if m:
            flush(); lv = len(m.group(1)); hid = "h%d" % (len(heads) + 1)
            heads.append((lv, hid, m.group(2)))
            out.append('<h%d id="%s">%s</h%d>' % (lv, hid, inline(m.group(2)), lv)); i += 1; continue
        if re.match(r"^\s*(---|\*\*\*|___)\s*$", ln):
            flush(); out.append("<hr>"); i += 1; continue
        m = re.match(r"^!\[(.*?)\]\((.+?)\)\s*$", ln)
        if m:
            flush()
            full = os.path.join(src_dir, m.group(2))
            if os.path.isfile(full):
                os.makedirs(img_dir, exist_ok=True)
                name = os.path.basename(full); shutil.copy2(full, os.path.join(img_dir, name)); nimg += 1
                out.append('<figure><img src="%s/%s" alt="%s"></figure>' % (img_rel, urllib.parse.quote(name), html.escape(m.group(1))))
            else:
                out.append("<p><em>%s</em></p>" % html.escape(m.group(1)))
            i += 1; continue
        if ln.startswith(">"):
            flush(); buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip(">").strip()); i += 1
            out.append("<blockquote>%s</blockquote>" % inline(" ".join(x for x in buf if x))); continue
        if ln.startswith("|"):
            flush(); rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i]); i += 1
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
            if len(cells) >= 2 and re.match(r"^:?-{2,}:?$", cells[1][0].replace(" ", "") or "-"):
                head, body = cells[0], cells[2:]
            else:
                head, body = cells[0], cells[1:]
            t = ['<div class="tw"><table>', "<thead><tr>%s</tr></thead>" % "".join("<th>%s</th>" % inline(c) for c in head), "<tbody>"]
            for r in body:
                t.append("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r))
            t.append("</tbody></table></div>"); out.append("\n".join(t)); continue
        if re.match(r"^[-*] ", ln):
            flush(); items = []; subs = []
            while i < len(lines):
                cur = lines[i]
                if re.match(r"^[-*] ", cur): items.append(cur[2:].strip()); subs.append([])
                elif re.match(r"^\s{2,}[-*] ", cur) and items: subs[-1].append(re.sub(r"^\s*[-*] ", "", cur).strip())
                elif cur.startswith("  ") and cur.strip() and items:
                    if subs[-1]: subs[-1][-1] += " " + cur.strip()
                    else: items[-1] += " " + cur.strip()
                else: break
                i += 1
            out.append("<ul>%s</ul>" % "".join(
                "<li>%s%s</li>" % (inline(t_), ("<ul>%s</ul>" % "".join("<li>%s</li>" % inline(x) for x in s_)) if s_ else "")
                for t_, s_ in zip(items, subs))); continue
        if re.match(r"^\d+\. ", ln):
            flush(); items = []
            while i < len(lines):
                cur = lines[i]
                if re.match(r"^\d+\. ", cur): items.append(re.sub(r"^\d+\. ", "", cur).strip())
                elif cur.startswith("   ") and cur.strip() and items: items[-1] += " " + cur.strip()
                else: break
                i += 1
            out.append("<ol>%s</ol>" % "".join("<li>%s</li>" % inline(x) for x in items)); continue
        if ln.strip() == "":
            flush(); i += 1; continue
        para.append(ln); i += 1
    flush()
    return "\n".join(out), heads, nimg


CSS = """
body{font-family:"Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif;font-size:15px;line-height:1.75;color:#1a1a1a;background:#fff;max-width:1100px;margin:0 auto;padding:0 24px 48px}
.bar{position:sticky;top:0;background:#f3f5f9;border-bottom:1px solid #d5dce8;margin:0 -24px 20px;padding:8px 24px;font-size:13px}
.bar a{color:#1e4e8c;text-decoration:none}.bar a:hover{text-decoration:underline}
h1{font-size:22px;border-bottom:3px solid #1e4e8c;padding-bottom:6px;margin:8px 0 14px}
h2{font-size:17px;color:#1e4e8c;border-left:6px solid #1e4e8c;padding-left:10px;margin:30px 0 10px}
h3{font-size:15.5px;margin:22px 0 6px}h4{font-size:15px;margin:16px 0 4px}
h2 a.pl,h3 a.pl{color:#b8c4d6;text-decoration:none;margin-left:8px;font-weight:normal}
p{margin:6px 0}
.tw{overflow-x:auto;margin:8px 0 14px}
table{border-collapse:collapse;min-width:100%;font-size:13.5px}
th,td{border:1px solid #b8c4d6;padding:6px 9px;vertical-align:top;text-align:left}
th{background:#e8eef7;white-space:nowrap}
pre{background:#f3f5f9;border:1px solid #d5dce8;padding:10px 12px;font-family:"BIZ UDGothic","MS Gothic",Consolas,monospace;font-size:13px;line-height:1.5;overflow-x:auto}
code{background:#f3f5f9;padding:0 3px;font-family:"BIZ UDGothic","MS Gothic",Consolas,monospace;font-size:13.5px}
blockquote{border-left:4px solid #c9d2e0;background:#f7f9fc;margin:8px 0;padding:6px 12px;color:#333}
ul,ol{margin:4px 0 8px;padding-left:24px}li{margin:3px 0}
hr{border:0;border-top:1px solid #c9d2e0;margin:20px 0}
figure{margin:12px 0 4px}figure img{max-width:100%;border:1px solid #c9d2e0}
a{color:#1e4e8c}
nav.toc{background:#f7f9fc;border:1px solid #d5dce8;padding:10px 16px;margin:0 0 22px;font-size:13.5px}
nav.toc ul{margin:0;padding-left:20px}nav.toc li.l3{margin-left:16px;font-size:13px}
"""


def page(title, body, heads, back):
    toc = ""
    entries = [(lv, hid, tx) for lv, hid, tx in heads if lv in (2, 3)]
    if len(entries) >= 3:
        toc = '<nav class="toc"><strong>この文書の目次</strong><ul>%s</ul></nav>' % "".join(
            '<li class="l%d"><a href="#%s">%s</a></li>' % (lv, hid, inline(tx)) for lv, hid, tx in entries)
        # 各見出しの右に「目次へ」の小さな戻り口
        body = re.sub(r'(<h[23] id="(h\d+)">.*?)(</h[23]>)', r'\1<a class="pl" href="#top" title="この文書の目次へ">↑</a>\3', body)
    bar = '<div class="bar"><a href="%s">← 目次に戻る</a></div>' % back
    # 文書の目次は題名（h1）の直下に置く。題名が無ければ先頭
    if toc and "</h1>" in body:
        body = body.replace("</h1>", "</h1>" + toc, 1)
    else:
        body = toc + body
    return ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>%s</title><style>%s</style></head><body id="top">%s%s'
            '<p style="margin-top:36px"><a href="%s">← 目次に戻る</a></p></body></html>'
            % (html.escape(title), CSS, bar, body, back))


# ── 納品する文書 ───────────────────────────────────────────
GROUPS = [
    ("1_説明書", [
        ("docs/機能概要説明書.md", "何ができるかを画面付きで説明。最初に読む文書"),
        ("docs/社内サーバー導入手順書.html", "お客様のサーバーへ入れる手順（インストールセットにも同梱）"),
        ("docs/運用構成書.md", "本番環境の構成"),
    ]),
    ("2_仕様書・設計書", [
        ("docs/化学物質管理システム_要件定義書_v0.7.md", "何を作るかの合意"),
        ("docs/システム仕様書_発注用_v1.0.md", "発注時の仕様"),
        ("docs/機能仕様書.md", "機能の仕様（全体）"),
        ("docs/詳細機能仕様書.md", "機能の仕様（細部）"),
        ("docs/画面設計書.md", "画面ごとの設計"),
        ("docs/data-model.md", "テーブル定義（ER）"),
        ("docs/judgment-engine.md", "判定のアルゴリズムとテストケース"),
        ("docs/法規制の内容と該非判定の方法.md", "各法規制をどう判定しているか"),
        ("docs/法規制データの作り方.md", "法規制データの出どころと作りかた"),
        ("docs/公開検証環境_仕様と変更履歴.md", "検証環境の仕様と、これまでの変更"),
    ]),
    ("3_見本", [
        ("docs/templates/サンプル_製品成分報告書.docx", "帳票様式（Word）の見本。システムに預けて使います"),
    ]),
    ("4_見積もり・費用", [
        ("docs/バージョンアップ作業の見積もり.md", "導入後の更新作業の見積もり"),
        ("docs/開発費用の概算.pdf", "開発費用の概算（PDF のみ）"),
        ("docs/開発費用の概算(AI版).pdf", "開発費用の概算・AI 版（PDF のみ）"),
    ]),
    ("5_設計判断", [(f"docs/decisions/{n}", "なぜそう作ったかの記録")
                  for n in sorted(os.listdir("docs/decisions")) if n.endswith(".md")]),
]

if os.path.exists(DST):
    shutil.rmtree(DST)
index_rows = []
stats = {"html": 0, "img": 0, "copy": 0}
for folder, items in GROUPS:
    os.makedirs(os.path.join(DST, folder), exist_ok=True)
    rows = []
    for src, role in items:
        assert os.path.isfile(src), src
        stem, ext = os.path.splitext(os.path.basename(src))
        back = "../目次.html"
        if ext == ".md":
            text = io.open(src, encoding="utf-8").read()
            img_dir = os.path.join(DST, "images", stem)
            body, heads, nimg = convert(text, os.path.dirname(src), img_dir, "../images/" + urllib.parse.quote(stem))
            title = heads[0][2] if heads and heads[0][0] == 1 else stem
            out = stem + ".html"
            io.open(os.path.join(DST, folder, out), "w", encoding="utf-8", newline="\n").write(page(title, body, heads, back))
            stats["html"] += 1; stats["img"] += nimg
        elif ext == ".html":
            s = io.open(src, encoding="utf-8").read()
            bar = '<div style="position:sticky;top:0;background:#f3f5f9;border-bottom:1px solid #d5dce8;padding:8px 24px;font-size:13px;font-family:sans-serif"><a href="%s" style="color:#1e4e8c;text-decoration:none">← 目次に戻る</a></div>' % back
            s = re.sub(r"(<body[^>]*>)", r"\1" + bar, s, count=1)
            s = s.replace("</body>", '<p style="margin:36px 24px;font-family:sans-serif"><a href="%s" style="color:#1e4e8c">← 目次に戻る</a></p></body>' % back)
            out = stem + ".html"
            io.open(os.path.join(DST, folder, out), "w", encoding="utf-8", newline="\n").write(s)
            stats["html"] += 1
        else:
            out = os.path.basename(src)
            shutil.copy2(src, os.path.join(DST, folder, out)); stats["copy"] += 1
        rows.append((out, role))
    index_rows.append((folder, rows))

# ── 目次 ──────────────────────────────────────────────────
parts = []
for folder, rows in index_rows:
    trs = "".join('<tr><td><a href="%s">%s</a></td><td>%s</td></tr>' % (urllib.parse.quote(f"{folder}/{n}"), html.escape(n), html.escape(r)) for n, r in rows)
    parts.append('<section><h2><a href="%s/">%s</a><span class="n">%d 件</span></h2><div class="tw"><table>%s</table></div></section>'
                 % (urllib.parse.quote(folder), html.escape(folder), len(rows), trs))
idx = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>提供文書一式（2026-09-20）</title>'
       '<style>%s h2 a{color:inherit;text-decoration:none}h2 a:hover{text-decoration:underline}.n{font-weight:normal;color:#666;font-size:12px;margin-left:10px}td:first-child{width:46%%}p.note{color:#555;font-size:13px}</style></head>'
       '<body><h1>%s</h1><p class="note">文書名を押すと開きます。各文書の上下に「目次に戻る」があります。文書の原本は開発側で管理しており、内容の更新はこの一式の差し替えで行います。</p>%s</body></html>'
       % (CSS, TITLE, "".join(parts)))
io.open(os.path.join(DST, "目次.html"), "w", encoding="utf-8", newline="\n").write(idx)
print("HTML %(html)d 件 / 画像 %(img)d 枚 / そのまま写した %(copy)d 件" % stats)
