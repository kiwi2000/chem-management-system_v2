# 納品用の文書一式を作る

`docs/` の原本（Markdown・HTML）から、お客様へ渡す HTML の一式を `docs/納品_<日付>/` に組む。

```
python scripts/deliver/build-html.py    # 原本 → HTML（画像は images/ に別置き、各文書に目次と「目次に戻る」）
python scripts/deliver/add-search.py    # 全文検索（search-index.js と目次の検索窓、各文書の帯の検索窓）
```

2 本とも `PYTHONIOENCODING=utf-8` を付けて流す。出力先の日付と文書の並びは `build-html.py` の
`DST` と `GROUPS` で決める。Google ドライブへは robocopy の `/MIR` で
`H:\マイドライブ\dev\chem-management-system_v2_納品\` に写す。

原本が PDF しか無いもの（開発費用の概算）と docx はそのまま写す。`docs/out/` の PDF 一式とは別物。
