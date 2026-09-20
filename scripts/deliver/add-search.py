# 納品フォルダの HTML 一式に、全文検索を付ける（deliver-html.py のあとに流す）。
#   search-index.js … 全文書の「見出しごとの本文」を1つの JS に固めたもの（file:// でも読める）
#   目次.html       … 検索窓。語をスペース区切りで AND、当たった箇所を文書→見出しの順に並べる
#   各文書          … 上の帯に検索窓（目次の検索へ飛ぶ）と、?hl= で来たときに語を黄色くする仕組み
import html, io, json, os, re, urllib.parse

os.chdir(r"C:\Users\moris\Documents\dev\chem-management-system_v2")
DST = "docs/納品_2026-09-20"

TAG = re.compile(r"<[^>]+>")
HEAD = re.compile(r'<h([123])(?:\s+id="([^"]*)")?[^>]*>(.*?)</h\1>', re.S)


def text_of(fragment):
    t = TAG.sub(" ", fragment)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


def ensure_ids(body):
    """h1〜h3 に id が無ければ付ける（導入手順書のような既存 HTML 用）"""
    n = [0]
    def fix(m):
        lv, hid, inner = m.group(1), m.group(2), m.group(3)
        if hid:
            return m.group(0)
        n[0] += 1
        return '<h%s id="s%d">%s</h%s>' % (lv, n[0], inner, lv)
    return HEAD.sub(fix, body)


HL_SCRIPT = """<script>
(function(){
  var q=new URLSearchParams(location.search).get('hl');
  if(!q)return;
  var terms=q.split(/\\s+/).filter(Boolean);
  if(!terms.length)return;
  var re=new RegExp('('+terms.map(function(t){return t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}).join('|')+')','gi');
  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
    var p=n.parentNode&&n.parentNode.nodeName; if(p==='SCRIPT'||p==='STYLE'||p==='MARK')return NodeFilter.FILTER_REJECT;
    return re.test(n.nodeValue)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP}});
  var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  nodes.forEach(function(n){var s=document.createElement('span');s.innerHTML=n.nodeValue.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}).replace(re,'<mark>$1</mark>');n.parentNode.replaceChild(s,n)});
  var first=document.querySelector('mark');
  if(first&&!location.hash)first.scrollIntoView({block:'center'});
})();
</script>"""

SEARCH_BOX = ('<form class="sf" action="%s" method="get">'
              '<input type="search" name="q" placeholder="全文書から検索" aria-label="全文書から検索">'
              '<button type="submit">検索</button></form>')

index = []
for folder in sorted(os.listdir(DST)):
    fdir = os.path.join(DST, folder)
    if not os.path.isdir(fdir) or folder == "images":
        continue
    for name in sorted(os.listdir(fdir)):
        if not name.endswith(".html"):
            continue
        path = os.path.join(fdir, name)
        s = io.open(path, encoding="utf-8").read()
        s = ensure_ids(s)
        # 帯に検索窓を足す（deliver-html.py が入れた「目次に戻る」の帯の中）
        if 'class="sf"' not in s:
            box = SEARCH_BOX % "../目次.html"
            s = s.replace("目次に戻る</a></div>", "目次に戻る</a>" + box + "</div>", 1)
            s = s.replace("目次に戻る</a></div>", "目次に戻る</a>" + box + "</div>", 1)  # 既存 HTML の帯（style 直書き）も同じ形
            s = s.replace("</head>", "<style>.sf{float:right;margin:-2px 0 0 16px;display:inline-flex;gap:4px}.sf input{width:220px;padding:3px 8px;border:1px solid #b8c4d6;font-size:13px}.sf button{padding:3px 10px;border:1px solid #b8c4d6;background:#fff;color:#1e4e8c;cursor:pointer}mark{background:#ffe86b;padding:0 1px}</style></head>", 1)
        if "hl=" not in s or HL_SCRIPT not in s:
            s = s.replace("</body>", HL_SCRIPT + "</body>", 1)
        io.open(path, "w", encoding="utf-8", newline="\n").write(s)

        # 見出しごとに本文を切る
        body = s.split("<body", 1)[1].split(">", 1)[1] if "<body" in s else s
        body = re.sub(r"<nav class=\"toc\">.*?</nav>", " ", body, flags=re.S)
        body = re.sub(r"<script>.*?</script>", " ", body, flags=re.S)
        body = re.sub(r"<div class=\"bar\">.*?</div>", " ", body, flags=re.S)
        body = re.sub(r"<form class=\"sf\".*?</form>", " ", body, flags=re.S)
        title = ""
        m1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
        if m1:
            title = text_of(m1.group(1))
        parts = HEAD.split(body)  # [before, lv, id, inner, between, lv, id, inner, between, ...]
        sections = []
        lead = text_of(parts[0])
        if lead:
            sections.append({"id": "", "h": "", "t": lead})
        for k in range(1, len(parts), 4):
            lv, hid, inner, between = parts[k], parts[k + 1] or "", parts[k + 2], parts[k + 3]
            if lv == "1":
                continue
            head = text_of(inner).replace("↑", "").strip()
            body_text = text_of(between)
            sections.append({"id": hid, "h": head, "t": body_text})
        rel = f"{folder}/{name}"
        index.append({"p": rel, "d": title or os.path.splitext(name)[0], "s": sections})

io.open(os.path.join(DST, "search-index.js"), "w", encoding="utf-8", newline="\n").write(
    "window.DOC_INDEX=" + json.dumps(index, ensure_ascii=False) + ";")
size = os.path.getsize(os.path.join(DST, "search-index.js"))
nsec = sum(len(d["s"]) for d in index)
print("索引:", len(index), "文書 /", nsec, "節 /", round(size / 1024), "KB")

# ── 目次に検索窓と結果の欄 ──
p = os.path.join(DST, "目次.html")
s = io.open(p, encoding="utf-8").read()
ui = """
<div id="search" style="margin:16px 0 26px">
  <form onsubmit="return false" style="display:flex;gap:6px;align-items:center">
    <input id="q" type="search" placeholder="全文書から検索（スペースで区切ると、すべてを含む箇所）" style="flex:1;padding:8px 12px;font-size:15px;border:1px solid #b8c4d6" autofocus>
    <span id="qn" style="color:#666;font-size:13px;white-space:nowrap"></span>
  </form>
  <div id="r"></div>
</div>
<script src="search-index.js"></script>
<script>
(function(){
  var box=document.getElementById('q'),out=document.getElementById('r'),cnt=document.getElementById('qn');
  var docs=window.DOC_INDEX||[];
  function esc(s){return s.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
  function norm(s){return s.toLowerCase().replace(/[‐-―−ー－]/g,'-')}
  function run(){
    var q=box.value.trim();
    if(q.length<2){out.innerHTML='';cnt.textContent='';return}
    var terms=q.split(/\\s+/).filter(Boolean),nt=terms.map(norm),hits=[],total=0;
    docs.forEach(function(d){
      var rows=[];
      d.s.forEach(function(sec){
        var hay=norm(sec.h+' '+sec.t);
        if(!nt.every(function(t){return hay.indexOf(t)>=0}))return;
        var i=hay.indexOf(nt[0]),src=sec.t;var j=norm(src).indexOf(nt[0]);
        var from=Math.max(0,(j>=0?j:0)-60),snip=(from>0?'…':'')+src.slice(from,from+200)+(from+200<src.length?'…':'');
        var re=new RegExp('('+terms.map(function(t){return t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}).join('|')+')','gi');
        rows.push({sec:sec,snip:esc(snip).replace(re,'<mark>$1</mark>')});
      });
      if(rows.length){hits.push({d:d,rows:rows});total+=rows.length}
    });
    cnt.textContent=total?total+' 箇所（'+hits.length+' 文書）':'見つかりません';
    var hl=encodeURIComponent(q);
    out.innerHTML=hits.map(function(h){
      return '<div class="hit"><h3>'+esc(h.d.d)+'<span class="n">'+h.rows.length+' 箇所</span></h3><ul>'+h.rows.map(function(r){
        var href=encodeURI(h.d.p)+'?hl='+hl+(r.sec.id?'#'+r.sec.id:'');
        return '<li><a href="'+href+'">'+(r.sec.h?esc(r.sec.h):'（冒頭）')+'</a><div class="snip">'+r.snip+'</div></li>'}).join('')+'</ul></div>'}).join('');
  }
  var t;box.addEventListener('input',function(){clearTimeout(t);t=setTimeout(run,120)});
  var q0=new URLSearchParams(location.search).get('q');if(q0){box.value=q0;run()}
})();
</script>
"""
css = ".hit h3{font-size:15px;margin:18px 0 4px}.hit .n{font-weight:normal;color:#666;font-size:12px;margin-left:8px}.hit ul{margin:0;padding-left:18px}.hit li{margin:4px 0}.snip{color:#444;font-size:13px}mark{background:#ffe86b;padding:0 1px}"
if 'id="search"' not in s:
    s = s.replace("</style>", css + "</style>", 1)
    s = re.sub(r"(<p class=\"note\">.*?</p>)", r"\1" + ui.replace("\\", "\\\\"), s, count=1, flags=re.S)
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("目次に検索窓を付けました")
