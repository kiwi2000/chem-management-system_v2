# 多言語UI基盤（日本語 / English）

確定日: 2026-08-13

「日英切替を最初から全画面で」という方針のため、画面を増やす前に土台を作った。
設計判断の理由は `docs/decisions/0002` を参照。

## 決めたこと

1. 文言は **ソース内の辞書**（`packages/shared/src/i18n/ja.ts` / `en.ts`）で管理する
2. キーの正本は `ja.ts`。`en.ts` に同じキーが無いと**ビルドが失敗する**
3. 使い方は `const { m } = useI18n()`（クライアント）／ `const m = await getServerMessages()`（サーバー）
4. 文言はキー文字列ではなくオブジェクトを辿る（`m.login.submit`）。引数付きは関数（`m.errors.loadFailed(404)`）
5. 対象は **画面のラベル／エラー・確認メッセージ／マスタの名称／帳票・TSV**
6. マスタの名称は「日本語名・英語名の2列」を `pickName(locale, ja, en)` で切り替える。
   英語表示でも英語名が未登録なら日本語名を出す（空欄にしない）
7. 言語の優先順位は Cookie `chem_locale` → ユーザー設定 → 既定（ja）
8. 切替UIはトップバーのセレクタ。**ログイン画面にも置く**（ログイン前に選べる）
9. 切替すると Cookie とユーザー設定（`users.preferred_locale`）の両方を更新する
10. DB の `locales` / `ui_translations` テーブルは廃止した（マイグレーション `20260813120000_i18n_in_code`）

## 新しい画面を作るときの手順

1. `ja.ts` にその画面のブロックを足す（例: `substances: { title: "物質マスタ", ... }`）
2. `npm run typecheck` を走らせると `en.ts` の不足がエラーで出るので、英語を埋める
3. 画面側は `m.substances.title` のように参照する。**文字列リテラルを直接書かない**
4. サーバーが返すエラー文言は `m.errors.*`、入力チェックは `m.validation.*` に足す
5. Zod スキーマは辞書を受け取る関数として書く（`export const xxxSchema = (m: Messages) => z.object({...})`）

## 検証結果（実測）

- `en.ts` から `shell.signOut` を1つ削って `npm run typecheck` → `TS2741 Property 'signOut' is missing` で失敗することを確認（削除は元に戻し済み）
- ブラウザ: セレクタで English に切替 → サイドバー・トップバー・ホーム・`<html lang>`・タブのタイトルまで英語化
- ログアウトして `/login` を開くと**ログイン画面も英語**。そこで日本語に戻すと即座に日本語表示
- サーバー側の文言（curl で確認）
  - `GET /api/me` 未ログイン: en → `Please sign in` ／ ja → `ログインが必要です`
  - `POST /api/auth/login` 誤パスワード: en → `The email address or password is incorrect`
  - 入力チェック: en → `Enter a valid email address` / `Password is required`
- コンソールエラーなし。typecheck・lint・prettier いずれも通過

## 残っていること

- マスタの名称の切替（`pickName`）は関数を用意しただけ。実際に使うのは物質マスタ以降
- 帳票・TSV の英語化は S15 / S17 で対応する
