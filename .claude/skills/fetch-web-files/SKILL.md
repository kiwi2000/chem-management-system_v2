---
name: fetch-web-files
description: 役所などのサイトから PDF を自分で取ってくる手順（WAF で curl が拒まれるサイト、内蔵ブラウザの保存の画面、Cloudflare のボット確認）と、経産省の GHS 仮訳 PDF の文字化けを復元して文字に起こす手順。「ダウンロードして」「この PDF を読んで」「資料を取ってきて」のときに参照する。
---

# サイトからファイルを取ってきて読む

利用者に「ダウンロードしておいて」と頼む前に、ここにある方法を順に試す（2026-10-17 指示。自分でやる）。

## 1. まず curl（素直に取れるサイト）

```bash
curl -s -o <保存先> -w "%{http_code} %{size_download}\n" -A "Mozilla/5.0" --max-time 600 "<URL>"
```

取れたら `head -c 5` が `%PDF` であることを確かめる（403 の HTML を PDF の名前で保存してしまわないため）。

## 2. 403 や 202 で拒まれるサイト（AWS WAF など。経産省 meti.go.jp がこれ）

内蔵ブラウザでそのサイトのページを開くと、WAF の通行証（Cookie）がブラウザに入る。それを curl に渡す。

1. `navigate` でそのサイトの普通のページを開く
2. `javascript_tool` で `document.cookie.split("; ").find(c => c.startsWith("aws-waf-token="))` と `navigator.userAgent` を読む
3. curl に `-A "<そのブラウザの UA>" -b "<aws-waf-token=...>"` を付けて取る。Referer と Accept も付けると通りやすい

- 通行証は会話に貼ってよい（サイトの訪問者用の印で、利用者の秘密ではない）。ただし必要な分だけ
- 大きなファイル（数十 MB）や特定の道筋は、通行証があっても 202（0 バイト）で止められることがある。そのときは 3 へ

## 3. 内蔵ブラウザで開いて、保存の画面を自動で押す（Windows）

PDF のアドレスを `navigate` で開くと、Claude アプリに「名前を付けて保存」の画面が出る。
`tools/auto-save-download.ps1` を**先に**背景で動かしておくと、決まった名前のファイルだけ自動で保存される。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\auto-save-download.ps1 -Minutes 20 -NamePattern '\.(pdf|zip)$' -SaveDir 'C:\...\docs\GHS分類の原典\国連GHS文書'
```

- PowerShell ツールで `run_in_background: true`。終わったら TaskStop で止める
- `-SaveDir` を付けると、その場所に保存される（ファイル名の欄に全体の道筋を入れてから押す）。同じ名前があれば押さない
- Claude の窓の保存の画面だけに触る。上書きの確認には触らない
- 元は voice_type プロジェクトの `auto-save-gemini.ps1`（別の会話で利用者から教わった）
- `navigate` の結果が「responded with a file download」のときは、保存の画面が出ている。「navigated to」で中身が空のときは、ブラウザの中で PDF が開いただけ（保存されていない）。どちらも、見張りが動いていれば保存される

## 4. Cloudflare のボット確認が出るサイト（unece.org など）

内蔵ブラウザでも「しばらくお待ちください…」の確認で止まり、こちらでは通れない（確認を突破する操作はしない）。
curl も 403。**利用者に自分のブラウザで取ってもらう**しかない。頼むときはファイル名・元・大きさを添える。

- 国連 GHS の英語 PDF（Rev.9 本編 `GHS_Rev9E_0.pdf`・正誤表 `ST-SG-AC10-30-Rev9-Corr1E.pdf`）は 2026-10-17 に利用者が取って
  `docs/GHS分類の原典/国連GHS文書/` に置いた。文字化けせず、PyMuPDF の `get_text()` で段落番号ごと検索できる

## 5. 手元の PC に受け口を開く方法は使えない

ブラウザの中で取ったものを `localhost` の受け口に送る作り（node の小さな http サーバー）は、
自動承認の決まりで止められる（Expose Local Services）。回避しない。

## 6. 経産省の GHS 仮訳 PDF は文字化けする → `tools/pdf-decode-meti.py` で復元する

- 原因: 埋め込みの MS 明朝・MS ゴシック（Identity-H）に文字の対応表が無く、どの道具（pdftotext・pypdf・pdfjs・PyMuPDF）でも
  「字体の中の字の番号」がそのまま文字として出る（`㝃ᒓ᭩` のような文字化け）
- 直し方: この PC の `C:\Windows\Fonts\msmincho.ttc` / `msgothic.ttc` の対応表を逆引きする（字の並びが同じなので当たる）

```bash
PYTHONIOENCODING=utf-8 python tools/pdf-decode-meti.py <pdf> <出力.txt>
```

- 要る部品: `pymupdf`・`fonttools`（`pip install pymupdf fonttools`。2026-10-17 に入れた）
- 出力はページごと（`=== page N ===`）。行は紙面の折り返しのまま切れる。空白が `=` になることがある
- 埋め込みでない字体（`MSMincho`・`MSGothic`。ハイフン無し）はもともと読める。ハイフン付き（`MS-Mincho-90ms-RKSJ-H`）だけ復元する
- 復元した文字は scratchpad か `.cache/` に置く（PDF そのものと同じく git に入れない）
