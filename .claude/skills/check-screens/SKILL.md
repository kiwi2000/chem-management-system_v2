---
name: check-screens
description: 化学物質管理システム v2 の開発画面（:3001）に、ログインした状態で入って画面・API を確かめる手順。一時ユーザーのセッションを作り、Playwright で開いて写真を撮る。「画面で確かめて」「ブラウザで実測」や、DoD のブラウザ確認のときに参照する。
---

# 開発画面をログインした状態で確かめる

パスワードを打たずに確かめるため、**DB に一時ユーザーとセッションを直接作り**、
そのセッションの Cookie を付けたブラウザで開く。セッションの値は会話に出さない。

## 1. 一時ユーザーを作る

`.cache/temp-session.ts`（git 管理外）を使う。無ければ下の中身で作る。

```bash
node --env-file=.env node_modules/tsx/dist/cli.mjs .cache/temp-session.ts <scratchpad>/tok.txt
```

- 合言葉（セッションの値）は scratchpad のファイルにだけ書く。**cat などで表示しない**（自動承認で止められる）。
  使うときは `$(< file)` でコマンドに渡すか、スクリプトの中で読む
- 権限は ADMIN・物質・製品・組成・法規制の閲覧と編集。**ADMIN はほかの権限を含まない**ので、確かめる画面に要る権限を足す
- 終わったら必ず消す: `... .cache/temp-session.ts --remove`、トークンのファイルも消す
- **本番の DB に向けて流さない**（`.env` の `DATABASE_URL` が開発の 5433 であることを確かめてから）

```ts
// .cache/temp-session.ts の中身（要点）
const EMAIL = "spec-check@example.test";
// 既存なら sessions / user_permissions / audit_logs / users の順に消す。--remove ならここで終わり
// users に作成 → user_permissions に必要な権限 → sessions に { tokenHash: sha256(raw), expiresAt: 1 時間後 }
// raw（randomBytes(32) の base64url）を引数のファイルに書く
```

## 2. 開いて確かめる

**アドレスは `http://localhost:3001`**（`127.0.0.1` だと dev が画面の部品を配らず「読み込み中」のまま）。
Cookie の名前は `chem_session`。

- API だけなら curl: `curl -s -b "chem_session=$(< tok.txt)" http://localhost:3001/api/...`
- 画面は Playwright（`node_modules/playwright` にある）。スクリプトは scratchpad に書き、
  `createRequire("<リポジトリ>/package.json")` で playwright を読む

```js
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "ja-JP" });
await ctx.addCookies([{ name: "chem_session", value: token, url: "http://localhost:3001" }]);
await page.goto(url, { waitUntil: "domcontentloaded" });
// データを引き終わるまで待つ（"load" や "networkidle" は、URL を書き換え続ける画面で止まることがある）
await page.waitForFunction(() => !document.body.innerText.includes("読み込み中"), null, {
  timeout: 90000,
});
```

## 3. 詰まりやすい点

- **カードは既定で閉じている**（2026-09-11 の決まり。開け閉めは端末に覚える）。新しいブラウザでは全部閉じて見える。
  見出し（`[data-slot='card-title']`）を押すか、上の「すべて開く」を押してから撮る
- 「編集」ボタンは `getByRole("button", { name: "編集", exact: true })`
- 撮った写真は Read で見る。ページ全体は `fullPage: true`、1 つの枠だけなら `locator.screenshot()`
- アプリ内のブラウザ（プレビュー）でも見られるが、ログインの Cookie を渡せないので、ログインが要る画面はこの手順で
- データを書き換えて確かめたら、元に戻すか、戻さないなら報告に書く
