# 化学物質管理システム v2 — プロジェクト指針

このファイルは「毎回必要な、変わらない事実」だけを置く（**5KB以内を維持**）。
確定した仕様は `docs/steps/SXX.md`、設計判断の理由は `docs/decisions/` に書く。ここに進捗ログを増やさない。

## 1. これは何か

化学物質・製品組成・法規制情報を一元管理し、**規制該当を自動判定**するシステム。
v1（`../chem-management-system`）を、機能ごとに動作を確認しながら作り直したもの。v1 は参照用に残してある。

- 運用: 国内VPS＋Tailscale VPN＋Docker。**外部サービスへの通信ゼロ**（認証も自前実装）
- 最優先: データを外に漏らさないこと。次いで正確さ・使いやすさ・性能

## 2. 技術スタック（変更しないこと）

| 層     | 採用                                                             | 注意                                                     |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| アプリ | Next.js 15 App Router / React 19 / TypeScript strict             | 画面とAPIを同一プロジェクトに置く                        |
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
- 迷う細部は暫定実装して動かしてから決める。些細な判断は自分で決め、実装後に「勝手に決めた点」として報告する

**各ステップの完了条件（DoD）**: `npm run typecheck` / `npm run lint` / `npm test`（既存分も全部）/ `npm run build` / ブラウザ実操作での確認 / `docs/steps/SXX.md` / commit

## 4. 守るべきルール

### セキュリティ

- **すべての API Route Handler は `lib/authz.ts` の `requireUser` / `requirePermission` / `requireAnyPermission` / `requireAdmin` を必ず通す。**
  画面側の出し分けだけに頼らない（呼び忘れは `apps/web/lib/authz-coverage.test.ts` が検出する）
- 権限を要する画面は、サーバーコンポーネントでも `getActor()` で確認して中身を描画しない
  （`app/admin/layout.tsx` / `app/substances/layout.tsx` が例）
- **システム設定は参照も変更も管理者だけ。** 一般ユーザーの画面で設定値が要るときは API を緩めず、
  サーバーコンポーネントで `getAppSettings()` を呼んで必要な値だけ渡す
- **機密（非公開製品・非公開組成）はサーバー側で除外してから返す。** クライアントで隠すのは不可。TSV/ドキュメント出力にも同じマスキングを適用する
- パスワードは Argon2id。セッションはトークン生値を httpOnly Cookie、DBには SHA-256 ハッシュのみ保存
- `.env` は絶対にコミットしない

### データ

- 含有率・閾値などの数値に **Float を使わない**。DBは Decimal、計算は decimal.js
- コード・CAS番号の突合と一意判定は `normalizeCode()`（trim＋大文字化）を通した値で行う。DBの照合順序差を吸収するため
- 業務キー（製品コード等）はユーザーが付与する。内部キーは別に持つ

### 画面

- **一覧は必ず `components/data-table` を使う。** 列ごとの絞り込み・複数列の並べ替え・ページングが要る
  （`docs/decisions/0006`）。列定義はサーバー側 `QueryColumn` と画面側 `TableColumn` でキーを揃える
- **一覧に出す（並べ替え・絞り込みに使う）項目は、その表の列に持つ。** Prisma は1対多の子テーブルの
  項目で並べ替えできない
- マスタの作り分け: 項目3つ程度までは一覧の上のフォーム、それ以上は別画面（`docs/steps/S6_金属換算係数.md`）

### 実装

- 共通化は同じものを3回書いてから。早すぎる抽象化は作り直しのコストが大きい
- 既存コードのスタイル（命名・コメント密度）に合わせる。コメントは日本語
- **画面に出る文字列を直接書かない。** `packages/shared/src/i18n/ja.ts` にキーを足し、
  `en.ts` にも英語を入れる（入れ忘れはビルドで落ちる）。使い方は `docs/steps/S18_多言語UI基盤.md`

## 5. 環境（Windows 11 + WSL2）— 過去に詰まった点

1. **`DATABASE_URL` のホストは `127.0.0.1`**。`localhost` は IPv6(`::1`) に解決され Docker 公開ポートに繋がらない
2. **相対 import に `.js` 拡張子を付けない**。Next.js のモジュール解決が失敗する
3. ルートの `.env` は `apps/web/next.config.mjs` の `loadRootEnv()` が読む（Next.js は `apps/web` 直下しか自動で読まない）
4. `next.config.mjs` の `transpilePackages` に workspace パッケージを列挙する。追加時は忘れずに
5. **dev サーバーを起動したまま `next build` しない**（`.next` を共有して `__webpack_modules__ is not a function` になる）。壊れたら dev を止めて `.next` を削除
6. Docker Desktop は他プロジェクトと共有。起動に失敗しても独断で触らない

## 6. コマンド

```
docker compose up -d          # DB起動（v2 は 5433。v1 の 5432 と併存できる）
npm run dev                   # 開発サーバー（v2 は 3001。v1 の 3000 と併存できる）
npx prisma migrate dev        # マイグレーション作成・適用（データ欠損を伴う変更は
                              #   非対話環境で止まるので migration.sql を手書きして migrate deploy）
npx prisma studio             # DBをブラウザで確認
npx tsx scripts/set-password.ts <メール> <パスワード>   # パスワード発行
```

## 7. v1 との違い（意図的なもの）

- 判定API: v1 は指定バージョンの全リンクをメモリに載せていた。v2 は展開後のCAS集合で絞り込む
- 多言語UI: 各画面を作る時点から翻訳キー化する（v1 は基盤のみで全画面未対応）
- ESLint / Prettier / web層テストを最初から入れる（v1 には無かった）
