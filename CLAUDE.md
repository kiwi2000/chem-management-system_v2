# 化学物質管理システム v2 — プロジェクト指針

このファイルは「毎回必要な、変わらない事実」だけを置く（**200行未満を維持**）。
確定した仕様は `docs/steps/SXX.md`、設計判断の理由は `docs/decisions/` に書く。ここに進捗ログを増やさない。
資料はすべて `docs/` に置く。
開発全体の共通事項は `dev/CLAUDE.md`、開発以外も含む共通事項は `~/.claude/CLAUDE.md` にある（2026-10-12 に共通分をそちらへ移した）。

## 1. これは何か

化学物質・製品組成・法規制情報を一元管理し、**規制該当を自動判定**するシステム。
v1（`../chem-management-system`）を、機能ごとに動作を確認しながら作り直したもの。v1 は参照用に残してある。

- 運用: 国内VPS＋Tailscale VPN＋Docker。**外部サービスへの通信ゼロ**（認証も自前実装）
- 最優先: データを外に漏らさないこと。次いで正確さ・使いやすさ・性能
- **目標: 日本で使われている有名メーカー（UL・日立・富士通など）の化学物質管理システムや SDS 作成システムを
  数段上回るものを作り、置き換えること**（2026-10-17 利用者が明言）。仕様を決めるときは「他社にできないことができるか」
  「他社より正確・速い・分かりやすいか」で比べる。目先の作りやすさで質を落とさない
- **仕様で決まっていないことは、原則として利用者が設定で変えられる作りにする**（2026-10-17 指示）。既定の値を置き、
  変える口（ルールセットの選択点・自社ルール・システム設定・製品ごとの上書き）を用意する。個別の決定は 1 つずつ検討する
- **目標: 売れるシステムを作ること**（2026-10-17 追加）。技術的に優れているだけでなく、お客さんが買いたくなり、
  導入・乗り換え・運用がしやすいこと。仕様を決めるときは「お客さんにとっての価値と、導入の障害」も比べる

## 2. 技術スタック（変更しないこと）

| 層     | 採用                                                             | 注意                                                     |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| アプリ | Next.js 16 App Router / React 19 / TypeScript strict             | 画面とAPIを同一プロジェクトに置く                        |
| DB     | PostgreSQL 16（Docker）                                          | MySQL / SQL Server へ切替可能な書き方を保つ              |
| ORM    | **Prisma 6 系に固定**                                            | 7系は datasource の書式が変わり動かない                  |
| UI     | shadcn/ui（`base-nova` style）＋ `@base-ui/react` ＋ Tailwind v4 | `components/ui/*` は v1 から移植済み。CLI で再取得しない |
| 検証   | Zod（`packages/shared` にクライアント・サーバー共用で置く）      |                                                          |

構成は npm workspaces: `apps/web` / `packages/shared` / `packages/domain`（S12で追加）。テストは Vitest。

## 3. 開発の進め方（この型を守る）

機能を1つずつ **S0〜S19** の順に作る。各ステップは単独で起動・検証・コミットできること。

```
① 現行動作リストを番号付きで提示 → ② 変えたい番号だけ回答をもらう
→ ③ 実装 → ④ ブラウザ／APIで実測して結果を示す → ⑤ 承認・記録・コミット
```

- **承認前**は `prisma migrate reset` でマイグレーションを作り直してよい。**承認後は前進のみ**

**各ステップの完了条件（DoD）**: `npm run typecheck` / `npm run lint` / `npm test`（既存分も全部）/ `npm run build` / ブラウザ実操作での確認 / `docs/steps/SXX.md` / commit

## 4. 守るべきルール

### セキュリティ

- **すべての API Route Handler は `lib/authz.ts` の `requireUser` / `requirePermission` / `requireAnyPermission` / `requireAdmin` を必ず通す。**
  画面側の出し分けだけに頼らない（呼び忘れは `apps/web/lib/authz-coverage.test.ts` が検出する）
- 権限を要する画面は、サーバーコンポーネントでも `getActor()` で確認して中身を描画しない
  （`app/admin/layout.tsx` / `app/substances/layout.tsx` が例）
- **システム設定は参照も変更も管理者だけ。** 一般ユーザーの画面で設定値が要るときは API を緩めず、
  サーバーコンポーネントで `getAppSettings()` を呼んで必要な値だけ渡す
- 設定は2種類。混ぜないこと（`docs/steps/S16-2_個人設定.md`）
  - **個人設定** `/preferences` … 言語・テーマ。本人だけに効く。ログイン前でも変えられる
  - **システム設定** `/admin/settings` … 全員に効く。管理者のみ
- **標準の画面・マニュアル・変更履歴の文言に、SDS 版だけの機能（製品の GHS 判定・SDS 作成）を書かない。**存在を知られないため
  （決定 0016）。2026-10-17 に拡張属性の説明へ「GHS 判定や SDS が使う項目」と書きかけた。
  見つけ方: `packages/shared/src/i18n/ja.ts`・`en.ts`・`app/spec/` を `GHS 判定|SDS 作成|GHS classification|SDS` で grep し、
  モジュール（`apps/web/modules/`）の外に出ていないか見る。ソースの注釈・移行の SQL の注釈は残ってよい
- **機密（非公開製品・非公開組成）はサーバー側で除外してから返す。** クライアントで隠すのは不可。TSV/ドキュメント出力にも同じマスキングを適用する
- パスワードは Argon2id。セッションはトークン生値を httpOnly Cookie、DBには SHA-256 ハッシュのみ保存

### データ

- 含有率・閾値などの数値に **Float を使わない**。DBは Decimal、計算は decimal.js
- コード・CAS番号の突合と一意判定は `normalizeCode()`（trim＋大文字化）を通した値で行う。DBの照合順序差を吸収するため
- 業務キー（製品コード等）はユーザーが付与する。内部キーは別に持つ
- **列挙（enum）に値を足す移行と、その値を使う移行（初期データの投入など）は分ける。**PostgreSQL は、足した移行の中では新しい値を使えない
  （例: `20261017090000_…` と `20261017090100_property_defaults`）

### 画面

- **一覧は必ず `components/data-table` を使う。** 列ごとの絞り込み・複数列の並べ替え・ページングが要る
  （`docs/decisions/0006`）。列定義はサーバー側 `QueryColumn` と画面側 `TableColumn` でキーを揃える
- **一覧に出す（並べ替え・絞り込みに使う）項目は、その表の列に持つ。** Prisma は1対多の子テーブルの
  項目で並べ替えできない
- マスタの作り分け: 項目3つ程度までは一覧の上のフォーム、それ以上は別画面（`docs/steps/S6_金属換算係数.md`）
- **別画面で開く既存データは、まず読み取り専用で見せ「編集」ボタンで書き換え可にする。**
  誤操作を防ぐため。上部に「表示のみ / 編集中」を出し、編集ボタンは権限がある人にだけ見せる
- **一覧の削除はまとめて。** 編集権限があるとき先頭にチェックボックス列を出し、
  表の上の削除ボタン（アイコンのみ）でまとめて消す。**詳細へは先頭列のコードのリンクから**、
  行内で直すマスタは**行末の鉛筆から**。行のダブルクリックには意味を持たせない（選択と衝突する）
- **開閉できるまとまり（`useState` の `…Open`）を足したら、「すべて開く」「すべて閉じる」の処理と、
  ボタンを出し分ける条件（`allJudgementOpen` など）にも必ず入れる。**入れ忘れると外側が閉じたまま中だけ開き、
  何も見えない（2026-10-14 に判定の表で起きた）。見つけ方: その部品で `Open] = useState` を grep し、
  1 つずつ `expandAll` / `collapseAll` の `onClick` に現れるかを見る

### 実装

- **編集の API（PUT / PATCH）には楽観的ロックを必ず入れる**（2026-10-18 指示。仕組みは `apps/web/lib/edit-stamp.ts`、記録は `docs/steps/S29_楽観的ロック.md`）。
  DTO に `stamp` を持たせ、画面は保存時に `stamp` を送り返し、サーバーは `parseEditStamp` → `updateMany({ where: { id, ...stampWhere(lock) } })` の件数で
  食い違いを見て 409 `stale_edit` を返す。画面は入力を残したまま `StaleEditNotice` を出す。
  見つけ方: `apps/web/lib/edit-stamp-coverage.test.ts` が PUT / PATCH の route.ts と、PUT / PATCH を送る画面の付け忘れを検出する。例外は理由を書いてそこに載せる
- **画面に出る文字列を直接書かない。** `packages/shared/src/i18n/ja.ts` にキーを足し、
  `en.ts` にも英語を入れる（入れ忘れはビルドで落ちる）。使い方は `docs/steps/S18_多言語UI基盤.md`
- **導入先で動く作りは、3 つの入れ方（Railway・Docker・Windows Server）で確かめる。**2026-10-16 に次の 3 つが見つかった
  - ファイルを書く場所は、更新で消えないこと（Windows は robocopy の `/XD`、Docker は保存領域）。
    見つけ方: `writeFile` / `mkdir` を grep し、書く先が `compose.prod.yml` の `volumes` と `update.ps1` の `/XD` に入っているか
  - 環境変数は `compose.prod.yml` の `environment` に書かないと Docker のアプリに届かない（`.env.prod` は compose の `${}` を埋めるだけ）。
    見つけ方: `process.env.` を grep し、1 つずつ `compose.prod.yml` と `.env.*.example` にあるか
  - 道筋を `process.cwd()` から作らない（サービスは apps/web で動く）。`appRoot()`（`lib/doc-files.ts`）を使う。見つけ方: `process.cwd()` を grep
- **データソースの合算は「CAS ごとに最優先のデータソースを選び、その行は全部」。CAS ごとに 1 行にしない。**
  1 つの物質に番号が 2 つ以上ある（化審法番号など）。`DISTINCT ON (cas)` で 2 つ目以降が消え、合算が LOLI 単独より少なくなっていた（2026-10-16）。
  見つけ方: `DISTINCT ON` を grep し、残す単位が本当に 1 行でよいか確かめる。合算と各データソースの件数を比べる（合算 ≧ 最優先のソース）

## 5. 環境（Windows 11 + WSL2）— 過去に詰まった点

1. **相対 import に `.js` 拡張子を付けない**。Next.js のモジュール解決が失敗する
2. ルートの `.env` は `apps/web/next.config.mjs` の `loadRootEnv()` が読む（Next.js は `apps/web` 直下しか自動で読まない）
3. `next.config.mjs` の `transpilePackages` に workspace パッケージを列挙する。追加時は忘れずに
4. **dev サーバーと `next build` は同時に動かしてよい**（Next.js 16 から dev は `.next/dev` に書く。2026-10-09 確認）。15 までは `.next` を共有して壊れた。`prisma generate` は dev を止めてから
5. **`npm run build`（とインストールセットの組み立て）のあとは `node scripts/gen-modules.mjs all`**。build がモジュールの一覧を空で作り直し、開発画面から SDS のメニューが消える
6. **画面を確かめるときのアドレスは `http://localhost:3001`。**`127.0.0.1` だと dev が画面の部品を配らず、「読み込み中」のまま操作できない（2026-10-17）。
   手順はスキル **check-screens**

## 6. コマンド

```
docker compose up -d          # DB起動（v2 は 5433。v1 の 5432 と併存できる）
npm run dev                   # 開発サーバー（v2 は 3001。v1 の 3000 と併存できる）
npx prisma migrate dev        # マイグレーション作成・適用（データ欠損を伴う変更は
                              #   非対話環境で止まるので migration.sql を手書きして migrate deploy）
npx prisma studio             # DBをブラウザで確認
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium   # 帳票の PDF 化に使う Chromium（node_modules に入る。初回だけ）
npx tsx scripts/set-password.ts <メール> <パスワード>   # パスワード発行
```

## 7. v1 との違い（意図的なもの）

- 判定API: v1 は指定バージョンの全リンクをメモリに載せていた。v2 は展開後のCAS集合で絞り込む
- 多言語UI: 各画面を作る時点から翻訳キー化する（v1 は基盤のみで全画面未対応）
- ESLint / Prettier / web層テストを最初から入れる（v1 には無かった）
