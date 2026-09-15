# 評価機 更新記録（Windows Server 2025・2026-09-15）

導入手順書 §11「更新の手順（場合ごと）」を、お客さんが行うのと同じ手順で評価機 WIN-4SHCN21RPK4（192.168.1.109 / chem.lan）に対して実施した記録。
初期導入の記録は `docs/評価機導入記録_WindowsServer_2026-09-14.md`。

試したのは次の 3 つ。

| 場合 | 手順書 | 使ったもの |
| --- | --- | --- |
| 1-2 プログラムの更新（表が変わる） | §11-2 | `chem-install-set-0.1.0-win64.zip`（commit 3836c38、移行 2 件を含む） |
| 2 データソースの更新 | §11-3 | `chem-data-set-2026-09-15.zip`（開発 PC の DB から書き出した写し。9.6 MB、展開 204 MB） |
| 3 法規制の変更 | §11-4 | `chem-data-set-lawchange-test.zip`（化審法 第2種特定化学物質に終了日、その写しを新区分として追加） |

## 環境（更新前）

- 入っていた版: 0.1.0（commit a986142、表の最終変更 20260913120000_drop_document_sender_permission）
- サービス: chem-app / chem-caddy / postgresql-x64-16 いずれも Running
- バックアップ: `C:\backups\chem\chem_20260915_030002.sql.zip`（毎日 3 時の自動）

## 1. 1-2 プログラムの更新（表が変わる版）— §11-2

開発 PC で `scripts\build-install-set.ps1`（commit 3836c38）を作り、`C:\` へ置いた（687.5 MB、SHA256 9bde13ca…46fe）。

### W1 展開（前のセットのフォルダは消してから）

```text
PS C:\> (Get-FileHash C:\chem-install-set-0.1.0-win64.zip -Algorithm SHA256).Hash.ToLower(); Get-Content C:\chem-install-set-0.1.0-win64.zip.sha256
9bde13ca53eb6b76e421d73e1b293224b18237bab0bc29fb90efc856bbb746fe
9bde13ca53eb6b76e421d73e1b293224b18237bab0bc29fb90efc856bbb746fe  chem-install-set-0.1.0-win64.zip
PS C:\> Remove-Item -Recurse -Force C:\chem-install
PS C:\> tar -xf C:\chem-install-set-0.1.0-win64.zip -C C:\        （31 秒）
PS C:\> Rename-Item C:\chem-install-set-0.1.0-win64 C:\chem-install
```

### update.ps1（手順書の 3）

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\update.ps1

==> 版の比較
    いま:   0.1.0（a986142）  表の最終変更 20260913120000_drop_document_sender_permission
    届いた: 0.1.0（3836c38）  表の最終変更 20260915123000_expansion_judged_version
    !!  データベースの表が変わります。02-migrate.ps1 が足りない変更を足します（先にバックアップを取ります）
==> バックアップ                → C:\backups\chem\chem_20260915_192210.sql.zip
==> アプリを止める              OK  chem-app: Stopped
==> ファイルの入れ替え（C:\chem-install\app → C:\chem）   1.017 GB / 42 秒（robocopy）
    OK  版 0.1.0 を置きました
==> prisma migrate status / deploy   （適用: 20260915090000_data_import_jobs, 20260915120000_judgement_per_statutory_substance, 20260915123000_expansion_judged_version）
==> アプリを起動
==> サービス   chem-app / chem-caddy / postgresql-x64-16  Running Automatic
==> 応答       http://127.0.0.1:3001/api/health → 200   https://127.0.0.1/api/health → 200
RUN-RESULT: finished
```

開始 19:22:09、終了 19:23:58。**アプリが止まっていたのは 19:22:5x〜19:23:4x の約 1 分。**
`C:\chem\manifest.json` は commit 3836c38 / 表の最終変更 20260915123000 に変わった。DB の `_prisma_migrations` にも 3 件が finished で入っている。

気づき:

- `Start-Transcript` の記録には、子プロセス（backup-db.ps1・npx prisma・tsx）の出力が入らない（画面には出る）。
  更新の記録を残すなら `update.ps1 *> C:\chem-install\update.log` のようにリダイレクトするほうがよい
- `chem-app.log` に `バッチ ジョブを終了しますか (Y/N)?` が残る。nssm が npm を止めるときの Ctrl+C の反応で、害は無い

## 2. 2 データソースの更新（データセット）— §11-3

### 1 回目: 空の DB には法律が入らない（欠陥）

開発 PC のエクスポート画面で「データセット」（データソースは全部）を書き出し（`chem-data-set-2026-09-15.zip`、9.6 MB / 展開 204 MB）、
アップロード → インポート → 確認 を行った。読み取りは **6 秒**（650,216 行）。

結果: **法律 35 件が全部「読めない」**。`国「CHN」がありません（登録されている国: ）`。評価機は初回導入で表を作っただけの空の DB で、
地域・国が 1 件も無い。データセットには法律の国コードしか入っておらず、国そのものは運んでいなかった。

直し（commit 次項）: データセットに **地域・国・元素・金属換算係数** を入れ、法律より先に取り込むようにした
（空の DB でも、データセット 1 つで法規制の判定に要るものがそろう）。評価機には次の版（1-1 の更新として当てる）で確かめる。
反映は「反映する行が無い」で止まり（データソース 6・バージョン 2 は 1 回目の試しで入っていた）、本体は変わっていない。

## 3. 1-1 プログラムの更新（表が変わらない版）— §11-1

上の欠陥を直した版（commit 2222e1e。表の変更は無し）でセットを作り直し、同じ手順で当てた
（`chem-install-set-0.1.0-win64.zip` 687.5 MB、SHA256 6386696e…d389）。

```text
PS C:\> tar -xf C:\chem-install-set-0.1.0-win64.zip -C C:\ ; Rename-Item C:\chem-install-set-0.1.0-win64 C:\chem-install
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\update.ps1
==> 版の比較
    いま:   0.1.0（3836c38）  表の最終変更 20260915123000_expansion_judged_version
    届いた: 0.1.0（2222e1e）  表の最終変更 20260915123000_expansion_judged_version
    OK  データベースの表は変わりません（アプリのファイルだけ入れ替えます）
==> バックアップ          2026-09-15 21:56:27  backup done: C:\backups\chem\chem_20260915_215625.sql.zip (10.5 MB)
==> アプリを止める        OK  chem-app: Stopped
==> ファイルの入れ替え    1.017 GB / 36 秒
==> prisma migrate status  Database schema is up to date!
==> prisma migrate deploy  No pending migrations to apply.
==> アプリを起動 → サービス 3 つ Running、health 200
```

開始 21:56:24、終了 21:57:44（**80 秒**。アプリが止まっていたのは約 40 秒）。手順書 §11-1 のとおり、
表が変わらないことがスクリプトの表示で分かり、それ以外は 1-2 と同じ操作で済んだ。

### 2 回目: 直した版で通しで実施（手順書 §11-3 の 2〜7）

直した版（1-1 で当てた commit 2222e1e）に、地域・国・元素・金属換算係数を含むデータセット（10.1 MB）を取り込んだ。
画面のボタンと同じ API を呼んで進めた（アップロード → インポート → 確認 → 反映 → 版を現在に → 判定し直し）。

| 段 | 結果 | 所要 |
| --- | --- | --- |
| 2 アップロード | 種類「データセット（法規制）」と判定 | 4 秒 |
| 3 インポート（一時領域へ） | 650,216 行。読めない 0。追加: 地域 11・国 24・元素 119・金属換算係数 25,187・法律 35・区分 91・分類 113・法文物質名 20,731・結び付き 629,485。データソース 6・バージョン 2 は変更なし | **147 秒** |
| 4 確認 | 要確認 0・読めない 0 | — |
| 5 反映 | 675,796 行を本体に書いた。失敗 0 | **600 秒（10 分）** |
| 6 バージョン | 2026Q3 を「現在」に | 即時 |
| 7 判定し直し | 製品 0 件なので即終了。「要再計算」は消えた | 即時 |

手順書に書く目安: LOLI 1 版ぶんのデータセットは、読み取り 2〜3 分・反映 10 分ほど（評価機は Windows Server 2025 評価版・4 vCPU 相当）。
反映中もアプリは止まらない。

## 4. 3 法規制の変更 — §11-4

改正を模した小さなデータセット（化審法 第2種特定化学物質 C2 に適用終了日 2027-03-31 を入れ、その写し C2-2027 を
適用開始日 2027-04-01 で足し、試験用の法文物質名 1 件と USER の結び付きを加えたもの。19.9 KB）を、同じ手順で取り込んだ。

| 段 | 結果 | 所要 |
| --- | --- | --- |
| 3 インポート | 1,158 行。区分: 更新 1（C2 の終了日）・追加 1（C2-2027）。分類 追加 1、法文物質名 追加 25、結び付き 追加 555。ほかは変更なし。読めない 0 | 6 秒 |
| 4 確認 | 要確認 0（評価機では画面で直したものが無いため） | — |
| 5 反映 | 583 行、失敗 0 | 6 秒 |
| 6 バージョン | 切り替え不要（版は変わらない） | — |
| 7 判定し直し | 製品 0 件のため即終了 | — |

手順書 §11-4 (b) のとおり、**古い区分は消えず終了日が付き、新しい区分が並んで足された**。
「区分の更新」は画面で直したものが無ければ「更新」で既定オンになる。直したものがあれば「要確認」で止まる（ローカルで確認済み）。

## 5. まとめ

| 手順 | 結果 |
| --- | --- |
| 1-2 表が変わる更新 | ○ 約 2 分、停止 1 分 |
| 1-1 表が変わらない更新 | ○ 80 秒、停止 40 秒 |
| 2 データセット（LOLI 1 版ぶん） | ○ 読み取り 147 秒、反映 600 秒、停止なし。**1 回目で欠陥（地域・国が無いと法律が入らない）を見つけて直した** |
| 3 法規制の変更 | ○ 6 秒 + 6 秒 |

未実施: サーバー再起動後の自動起動、Linux 側の通し確認、画面（ブラウザ）からの操作（今回は画面のボタンと同じ API を呼んだ。
検証用の短命セッションを Cookie に入れたブラウザが、ログアウト後の HttpOnly Cookie と競合して使えなかったため）。
