# 評価機（Windows Server 2025）への導入記録 2026-09-14

社内の評価機に、お客さんへ渡すのと同じ**インストールセット**と**導入手順書 §10** を使って導入した記録。
操作はすべて開発 PC から ssh（鍵認証）で行い、**手順書の手順を、お客さんの管理者がするのと同じ順**にたどった。
各手順に、打ったコマンドと、その出力をそのまま載せる（画面のある手順はスクリーンショット）。

## 環境

| 項目 | 値 |
| --- | --- |
| サーバー | WIN-4SHCN21RPK4 / 192.168.1.109 / Windows Server 2025 Standard Evaluation（10.0.26100） |
| 資源 | メモリ 16GB、C: 空き約 384GB、WORKGROUP |
| 導入前 | Node.js・PostgreSQL・Caddy・NSSM いずれも無し。npm レジストリへ到達可（セットはインターネット不要で作ってある） |
| 開発 PC → サーバー | OpenSSH（`out/enable-ssh.ps1` でサーバー側を用意。公開鍵のみ、22 番は 192.168.1.0/24 からだけ） |
| 名前 | `chem.lan`（開発 PC の hosts に登録。パスキーと証明書のため IP ではなく名前で開く） |
| セット | `out/chem-install-set-0.1.0-win64.zip`（`scripts/build-install-set.ps1` で作成、commit a986142） |

## 手順書との対応

| 手順書 | 記録の節 |
| --- | --- |
| W1 セットの展開 | §1 |
| W2 導入の実行（install.ps1） | §2 |
| W3 社内パソコンからの接続 | §3 |
| W4 状態の確認 | §4 |
| 更新のしかた（update.ps1） | §5（別の版を当てて確かめる） |

お客さんの管理者は W2 でパスワードを画面で打つが、この記録では作業者（AI）がパスワードを扱えないので
`-Unattended` で乱数を作らせ、`C:\chem\secrets\` に保存させた（手順書に書いてある当方作業者向けの方式）。


## 1. セットの受け取りと W1 展開

開発 PC で `scripts\build-install-set.ps1` を実行して作った `chem-install-set-0.1.0-win64.zip`（662.7 MB）と、
その SHA256 を書いたファイルを、お客さんがコピーするのと同じように `C:\` へ置いた（ここでは scp）。
届いたものの照合と、手順書 W1 の展開。**Expand-Archive は 42,057 ファイルの展開に 560 秒かかった**ので、
手順書は Windows 標準の `tar -xf`（1〜2 分）に改めた。

```text
PS C:\> (Get-FileHash C:\chem-install-set-0.1.0-win64.zip -Algorithm SHA256).Hash.ToLower(); Get-Content C:\chem-install-set-0.1.0-win64.zip.sha256
65e54fa1b2a6dc92efbd26ff226efd2aec967784faa4c93518396b79ee688efe
65e54fa1b2a6dc92efbd26ff226efd2aec967784faa4c93518396b79ee688efe  chem-install-set-0.1.0-win64.zip
PS C:\> Expand-Archive -Path C:\chem-install-set-0.1.0-win64.zip -DestinationPath C:\
PS C:\> Rename-Item C:\chem-install-set-0.1.0-win64 C:\chem-install
（展開 560 秒）
PS C:\> Get-ChildItem C:\chem-install

Name           Length
----           ------
app                  
installers           
scripts              
README.txt     935   
SHA256SUMS.txt 1569  
手順書.html       53933 



PS C:\> Get-ChildItem C:\chem-install\installers

Name                                           Length
----                                           ------
caddy_2.11.4_windows_amd64.zip               17559418
node-v22.23.2-x64.msi                        31727616
nssm-2.24.zip                                  351793
postgresql-16.10-1-windows-x64-binaries.zip 322530154
```

## 2. W2 導入の実行（install.ps1）

手順書のコマンドに `-Unattended` を付けて実行した（パスワードは乱数で作って `C:\chem\secrets\` へ保存。作業者は見ない）。
**1 回で通らず、7 回実行した。**止まるたびにスクリプトを直し、直したものを `C:\chem-install\scripts\` へ上書きして、
同じコマンドをもう一度実行した（手順書に書いた「済んだところは飛ばす」がそのまま効いた）。
直した内容は最後の表にまとめる。

### 2-1. 1 回目 — PostgreSQL の GUI インストーラーが画面の無いセッションで動かない

（この回の出力は上書きしてしまったので、当時の画面から写したもの）

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem

==> パスワード
    !!  パスワードは乱数で作り、C:\chem\secrets に保存しました（Administrators だけが読めます）

━━ W1 前提ソフト ━━

==> Node.js
    入れています: node-v22.23.2-x64.msi（1〜2 分）
    OK  入れました: v22.23.2

==> PostgreSQL 16
    入れています: postgresql-16.10-1-windows-x64.exe（3〜5 分）
RUN-RESULT: failed: PostgreSQL のインストールが失敗しました（終了コード 1）
at <ScriptBlock>, C:\chem-install\scripts\00-prereqs.ps1: line 63
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 83
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
```

### 2-2. 2 回目 — バイナリ zip 方式に変更。initdb が DLL 不足で落ちる（VC++ ランタイム）

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem

==> パスワード
    !!  パスワードは乱数で作り、C:\chem\secrets に保存しました（Administrators だけが読めます）

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> PostgreSQL 16
    展開しています: postgresql-16.10-1-windows-x64-binaries.zip（1〜2 分）
    initdb（UTF-8 / 照合順序 C / scram-sha-256）
RUN-RESULT: failed: initdb が失敗しました（終了コード -1073741515）
at <ScriptBlock>, C:\chem-install\scripts\00-prereqs.ps1: line 83
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 83
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
```

### 2-3. 3 回目 — VC++ ランタイム同梱後。initdb は通るが、サービスが Access is denied で起動しない（展開したフォルダの権限）

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended   （2回目。前回止まった W1 の続きから）
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem

==> パスワード
    !!  パスワードは乱数で作り、C:\chem\secrets に保存しました（Administrators だけが読めます）

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> Visual C++ ランタイム（PostgreSQL が使う）
    入れています: vc_redist.x64.exe
    OK  入れました（終了コード 0）

==> PostgreSQL 16
    initdb（UTF-8 / 照合順序 C / scram-sha-256）
The files belonging to this database system will be owned by user "Administrator".
This user must also own the server process.

The database cluster will be initialized with locale "C".
The default text search configuration will be set to "english".

Data page checksums are disabled.

fixing permissions on existing directory C:/Program Files/PostgreSQL/16/data ... ok
creating subdirectories ... ok
selecting dynamic shared memory implementation ... windows
selecting default max_connections ... 100
selecting default shared_buffers ... 128MB
selecting default time zone ... Asia/Tokyo
creating configuration files ... ok
running bootstrap script ... ok
performing post-bootstrap initialization ... ok
syncing data to disk ... ok

Success. You can now start the database server using:

    ^"C^:^\Program^ Files^\PostgreSQL^\16^\bin^\pg^_ctl^" -D ^"C^:^/Program^ Files^/PostgreSQL^/16^/data^" -l logfile start

    サービス postgresql-x64-16 を登録（NetworkService で起動）
RUN-RESULT: failed: Service 'postgresql-x64-16 (postgresql-x64-16)' cannot be started due to the following error: Cannot start service postgresql-x64-16 on computer '.'.
at <ScriptBlock>, C:\chem-install\scripts\00-prereqs.ps1: line 106
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 83
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
```

### 2-4. 4 回目 — 権限を直した後。postgres のパスワードが、やり直しで作り直された乱数と食い違う

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended   （3回目）
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem

==> パスワード
    !!  パスワードは乱数で作り、C:\chem\secrets に保存しました（Administrators だけが読めます）

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> Visual C++ ランタイム（PostgreSQL が使う）
    OK  すでにあります: v14.44.35211.00

==> PostgreSQL 16
    OK  入れました（サービス postgresql-x64-16: Running、C:\Program Files\PostgreSQL\16）

==> Caddy
    OK  置きました: v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=

==> NSSM
    OK  置きました

━━ W2 データベースとユーザー ━━

==> 接続の確認
psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL:  password authentication failed for user "postgres"
RUN-RESULT: failed: postgres として接続できません。パスワードとサービスの起動を確かめてください
at <ScriptBlock>, C:\chem-install\scripts\01-create-db.ps1: line 49
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 91
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
```

### 2-5. 5 回目 — 秘密の使い回しを直した後。DB・アプリ配置・表まで進み、利用者一覧（tsx）が DATABASE_URL 無しで止まる

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended   （4回目）
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem

==> パスワード
    !!  postgres のパスワードは前回の C:\chem\secrets\postgres.txt を使います
    !!  chem-db のパスワードは前回の C:\chem\secrets\chem-db.txt を使います
    !!  admin のパスワードは前回の C:\chem\secrets\admin.txt を使います

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> Visual C++ ランタイム（PostgreSQL が使う）
    OK  すでにあります: v14.44.35211.00

==> PostgreSQL 16
    OK  すでにあります（サービス postgresql-x64-16）

==> Caddy
    OK  すでにあります: v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=

==> NSSM
    OK  すでにあります

━━ W2 データベースとユーザー ━━

==> 接続の確認
    OK  PostgreSQL 16.10, compiled by Visual C++ build 1944, 64-bit

==> ユーザー chem
CREATE ROLE
    OK  作りました

==> データベース chem（UTF-8 / 照合順序 C）
CREATE DATABASE
    OK  作りました

==> 確認（文字コードが UTF8 であること）
chem|UTF8|C

━━ W3 アプリの配置 ━━

==> robocopy C:\chem-install\app → C:\chem（数分）
   Bytes :   1.015 g   1.015 g         0         0         0         0
   Times :   0:00:41   0:00:35                       0:00:00   0:00:06


   Speed :           31,125,500 Bytes/sec.
   Speed :            1,781.015 MegaBytes/min.
   Ended : 2026年9月14日 17:49:08

    OK  置きました（版 0.1.0）

==> .env を作る
    OK  C:\chem\.env（Administrators だけが読めます）

━━ W4 データベースの表 ━━

==> 環境の確認（C:\chem）
    OK  node v22.23.2
    OK  .env: chem@127.0.0.1:5432/chem

==> prisma migrate status（表の変更の有無）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations
Following migrations have not yet been applied:
20260813101757_init_auth_i18n
20260813120000_i18n_in_code
20260814090000_permissions_and_news
20260814100000_substances
20260814140000_substance_main_name
20260814160000_metal_conversion_factors
20260814190000_user_theme
20260814200000_user_header_strong
20260815010000_groups
20260815020000_user_background
20260815120000_products
20260815130000_product_composition_default
20260816090000_composition_lines
20260820090000_alias_language_split
20260820100000_drop_product_visibility_flags
20260820110000_product_model_and_uses
20260820120000_product_model_index
20260820130000_saved_filters
20260820140000_draft_flag
20260820150000_inactive_permissions
20260820160000_publish_state
20260821090000_feedback
20260821120000_user_avatar
20260822090000_cas_representative
20260823100000_regulation_tables
20260823140000_region_is_area
20260823160000_countries
20260823180000_law_belongs_to_country
20260823200000_languages
20260823220000_long_statutory_names
20260824100000_category_number_label
20260824110000_feedback_reply
20260824120000_source_url
20260824130000_data_sources
20260824140000_current_version_pinned
20260824150000_source_code_and_note_only
20260824160000_elements
20260825120000_mfa_method
20260825140000_feedback_seen
20260825190000_composition_expansion
20260825200000_product_judgement
20260825210000_judgement_hit_contributions
20260825230000_metal_factor_note
20260825240000_metal_etc
20260826000000_metal_factor_element_allow_cn
20260826120000_number_order
20260826140000_inventories
20260826160000_inventory_value
20260827100000_inventory_version
20260827110000_inventory_source
20260827120000_threshold_basis
20260827130000_document_templates
20260827140000_document_template_seq
20260827150000_document_permissions
20260828010000_organisations
20260828020000_passkeys
20260828030000_session_end_reason
20260828040000_preferred_page_sizes
20260828050000_natural_collation
20260829060000_source_color
20260829100000_source_mark
20260829110000_drop_balance
20260829233000_statutory_applicable_condition
20260829234500_move_condition_notes
20260830130000_organisation_kinds
20260830140000_org_permissions
20260830190000_document_template_files
20260831030000_category_judged
20260902000000_substance_score
20260903100000_feedback_comments
20260903120000_user_organisations
20260903150000_cas_link_data
20260904010000_feedback_kind_todo_idea
20260904020000_judgement_version
20260905010000_cas_link_version_source_index
20260906010000_cas_link_diffs
20260906020000_link_version_sequence
20260906030000_link_version_as_of
20260906040000_link_diff_unchanged
20260909120000_category_effective_dates
20260912120000_judgement_per_version
20260913100000_feedback_permissions
20260913100100_feedback_permissions_to_admins
20260913120000_drop_document_sender_permission

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.
npm notice
npm notice New major version of npm available! 10.9.8 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice

==> prisma migrate deploy（表を作る／足りない変更を足す）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations

Applying migration `20260813101757_init_auth_i18n`
Applying migration `20260813120000_i18n_in_code`
Applying migration `20260814090000_permissions_and_news`
Applying migration `20260814100000_substances`
Applying migration `20260814140000_substance_main_name`
Applying migration `20260814160000_metal_conversion_factors`
Applying migration `20260814190000_user_theme`
Applying migration `20260814200000_user_header_strong`
Applying migration `20260815010000_groups`
Applying migration `20260815020000_user_background`
Applying migration `20260815120000_products`
Applying migration `20260815130000_product_composition_default`
Applying migration `20260816090000_composition_lines`
Applying migration `20260820090000_alias_language_split`
Applying migration `20260820100000_drop_product_visibility_flags`
Applying migration `20260820110000_product_model_and_uses`
Applying migration `20260820120000_product_model_index`
Applying migration `20260820130000_saved_filters`
Applying migration `20260820140000_draft_flag`
Applying migration `20260820150000_inactive_permissions`
Applying migration `20260820160000_publish_state`
Applying migration `20260821090000_feedback`
Applying migration `20260821120000_user_avatar`
Applying migration `20260822090000_cas_representative`
Applying migration `20260823100000_regulation_tables`
Applying migration `20260823140000_region_is_area`
Applying migration `20260823160000_countries`
Applying migration `20260823180000_law_belongs_to_country`
Applying migration `20260823200000_languages`
Applying migration `20260823220000_long_statutory_names`
Applying migration `20260824100000_category_number_label`
Applying migration `20260824110000_feedback_reply`
Applying migration `20260824120000_source_url`
Applying migration `20260824130000_data_sources`
Applying migration `20260824140000_current_version_pinned`
Applying migration `20260824150000_source_code_and_note_only`
Applying migration `20260824160000_elements`
Applying migration `20260825120000_mfa_method`
Applying migration `20260825140000_feedback_seen`
Applying migration `20260825190000_composition_expansion`
Applying migration `20260825200000_product_judgement`
Applying migration `20260825210000_judgement_hit_contributions`
Applying migration `20260825230000_metal_factor_note`
Applying migration `20260825240000_metal_etc`
Applying migration `20260826000000_metal_factor_element_allow_cn`
Applying migration `20260826120000_number_order`
Applying migration `20260826140000_inventories`
Applying migration `20260826160000_inventory_value`
Applying migration `20260827100000_inventory_version`
Applying migration `20260827110000_inventory_source`
Applying migration `20260827120000_threshold_basis`
Applying migration `20260827130000_document_templates`
Applying migration `20260827140000_document_template_seq`
Applying migration `20260827150000_document_permissions`
Applying migration `20260828010000_organisations`
Applying migration `20260828020000_passkeys`
Applying migration `20260828030000_session_end_reason`
Applying migration `20260828040000_preferred_page_sizes`
Applying migration `20260828050000_natural_collation`
Applying migration `20260829060000_source_color`
Applying migration `20260829100000_source_mark`
Applying migration `20260829110000_drop_balance`
Applying migration `20260829233000_statutory_applicable_condition`
Applying migration `20260829234500_move_condition_notes`
Applying migration `20260830130000_organisation_kinds`
Applying migration `20260830140000_org_permissions`
Applying migration `20260830190000_document_template_files`
Applying migration `20260831030000_category_judged`
Applying migration `20260902000000_substance_score`
Applying migration `20260903100000_feedback_comments`
Applying migration `20260903120000_user_organisations`
Applying migration `20260903150000_cas_link_data`
Applying migration `20260904010000_feedback_kind_todo_idea`
Applying migration `20260904020000_judgement_version`
Applying migration `20260905010000_cas_link_version_source_index`
Applying migration `20260906010000_cas_link_diffs`
Applying migration `20260906020000_link_version_sequence`
Applying migration `20260906030000_link_version_as_of`
Applying migration `20260906040000_link_diff_unchanged`
Applying migration `20260909120000_category_effective_dates`
Applying migration `20260912120000_judgement_per_version`
Applying migration `20260913100000_feedback_permissions`
Applying migration `20260913100100_feedback_permissions_to_admins`
Applying migration `20260913120000_drop_document_sender_permission`

┌─────────────────────────────────────────────────────────┐
│  Update available 6.19.3 -> 8.0.0-rc.15                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘
The following migration(s) have been applied:

migrations/
  └─ （移行 84 件の一覧。省略）
      
All migrations have been successfully applied.

==> 利用者の一覧（繋がっていることの確認）
PrismaClientInitializationError: 
Invalid `prisma.user.findMany()` invocation in
C:\chem\scripts\set-password.ts:21:35

  18 const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
  19 
  20 async function list() {
→ 21   const users = await prisma.user.findMany(
error: Environment variable not found: DATABASE_URL.
  -->  schema.prisma:19
   | 
18 |   provider = "postgresql" // 切替: "mysql" / "sqlserver"
19 |   url      = env("DATABASE_URL")
   | 

Validation Error Count: 1
    at ei.handleRequestError (C:\chem\node_modules\@prisma\client\src\runtime\RequestHandler.ts:242:13)
    at ei.handleAndLogRequestError (C:\chem\node_modules\@prisma\client\src\runtime\RequestHandler.ts:174:12)
    at ei.request (C:\chem\node_modules\@prisma\client\src\runtime\RequestHandler.ts:143:12)
    at async a (C:\chem\node_modules\@prisma\client\src\runtime\getPrismaClient.ts:833:24)
    at async list (C:\chem\scripts\set-password.ts:21:17)
    at async main (C:\chem\scripts\set-password.ts:53:5) {
  clientVersion: '6.19.3',
  errorCode: undefined,
  retryable: undefined
}
RUN-RESULT: failed: set-password.ts --list が失敗しました
at <ScriptBlock>, C:\chem-install\scripts\02-migrate.ps1: line 74
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 125
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
```

### 2-6. 6 回目 — 管理者作成まで進み、nssm の AppExit の呼び方で止まる

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended   （5回目）
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem
    !!  admin のパスワードは前回の C:\chem\secrets\admin.txt を使います

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> Visual C++ ランタイム（PostgreSQL が使う）
    OK  すでにあります: v14.44.35211.00

==> PostgreSQL 16
    OK  すでにあります（サービス postgresql-x64-16）

==> Caddy
    OK  すでにあります: v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=

==> NSSM
    OK  すでにあります

━━ W2 データベースとユーザー ━━
    OK  .env がすでにあるので、データベースは作ってあるとみなします

━━ W3 アプリの配置 ━━

==> robocopy C:\chem-install\app → C:\chem（数分）

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :      5860         0      5860         0         0         4
   Files :     42057         0     42057         0         0         1
   Bytes :   1.015 g         0   1.015 g         0         0      1018
   Times :   0:00:00   0:00:00                       0:00:00   0:00:00
   Ended : 2026年9月14日 17:51:48

    OK  置きました（版 0.1.0）

━━ W4 データベースの表 ━━

==> 環境の確認（C:\chem）
    OK  node v22.23.2
    OK  .env: chem@127.0.0.1:5432/chem

==> prisma migrate status（表の変更の有無）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations

Database schema is up to date!

==> prisma migrate deploy（表を作る／足りない変更を足す）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations


No pending migrations to apply.

==> 利用者の一覧（繋がっていることの確認）
ユーザーが1件もありません。--create を付けて最初の管理者を作成してください。

━━ W5 最初の管理者 ━━
ユーザーを作成しました: admin@example.co.jp（全権限を付与）
パスワードを設定しました: admin@example.co.jp
    OK  admin@example.co.jp（全権限）

━━ W6 サービス ━━

==> chem-app（アプリ本体）
    OK  chem-app を登録しました
Binary file (standard input) matches
━━ W6 サービス ━━
==> chem-app（アプリ本体）
    OK  chem-app を登録しました
PS>TerminatingError(): "nssm set chem-app AppExit が失敗しました"
>> TerminatingError(): "nssm set chem-app AppExit が失敗しました"
>> TerminatingError(): "nssm set chem-app AppExit が失敗しました"
>> TerminatingError(): "nssm set chem-app AppExit が失敗しました"
RUN-RESULT: failed: nssm set chem-app AppExit が失敗しました
at Set-Nssm, C:\chem-install\scripts\03-install-services.ps1: line 43
at Install-ChemService, C:\chem-install\scripts\03-install-services.ps1: line 66
at <ScriptBlock>, C:\chem-install\scripts\03-install-services.ps1: line 71
at <ScriptBlock>, C:\chem-install\scripts\install.ps1: line 146
at <ScriptBlock>, C:\chem-install\run-install.ps1: line 4
**********************
Windows PowerShell transcript end
End time: 20260914175157
**********************
```

### 2-7. 7 回目 — 最後まで完走（サービス 3 つ Running、ファイアウォール、バックアップ、状態）

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp -Unattended   （6回目）
ケミカルコンプライアンス支援システム 版 0.1.0（a986142、組み立て 2026-09-14T17:06:10+09:00）
セット: C:\chem-install → 導入先: C:\chem
    !!  admin のパスワードは前回の C:\chem\secrets\admin.txt を使います

━━ W1 前提ソフト ━━

==> Node.js
    OK  すでにあります: v22.23.2

==> Visual C++ ランタイム（PostgreSQL が使う）
    OK  すでにあります: v14.44.35211.00

==> PostgreSQL 16
    OK  すでにあります（サービス postgresql-x64-16）

==> Caddy
    OK  すでにあります: v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=

==> NSSM
    OK  すでにあります

━━ W2 データベースとユーザー ━━
    OK  .env がすでにあるので、データベースは作ってあるとみなします

━━ W3 アプリの配置 ━━

==> robocopy C:\chem-install\app → C:\chem（数分）

               Total    Copied   Skipped  Mismatch    FAILED    Extras
    Dirs :      5860         0      5860         0         0         4
   Files :     42057         0     42057         0         0         1
   Bytes :   1.015 g         0   1.015 g         0         0      1018
   Times :   0:00:00   0:00:00                       0:00:00   0:00:00
   Ended : 2026年9月14日 17:52:54

    OK  置きました（版 0.1.0）

━━ W4 データベースの表 ━━

==> 環境の確認（C:\chem）
    OK  node v22.23.2
    OK  .env: chem@127.0.0.1:5432/chem

==> prisma migrate status（表の変更の有無）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations

Database schema is up to date!

==> prisma migrate deploy（表を作る／足りない変更を足す）
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "chem", schema "public" at "127.0.0.1:5432"

84 migrations found in prisma/migrations


No pending migrations to apply.

==> 利用者の一覧（繋がっていることの確認）
┌─────────┬───────────────────────┬────────┬──────┬────────────┬────────┬──────────────┐
│ (index) │ email                 │ 権限数 │ 有効 │ パスワード │ MFA    │ 最終ログイン │
├─────────┼───────────────────────┼────────┼──────┼────────────┼────────┼──────────────┤
│ 0       │ 'admin@example.co.jp' │ 20     │ true │ '設定済み' │ 'なし' │ '-'          │
└─────────┴───────────────────────┴────────┴──────┴────────────┴────────┴──────────────┘

━━ W5 最初の管理者 ━━
パスワードを設定しました: admin@example.co.jp
    OK  admin@example.co.jp（全権限）

━━ W6 サービス ━━

==> chem-app（アプリ本体）
    !!  chem-app はすでにあります。設定だけ入れ直します
chem-app: STOP: ]0n0�0�0�0�0�0���Yg0M0~0[0�0g0W0_00

==> chem-caddy（入口・HTTPS）
    OK  chem-caddy を登録しました

==> 起動

Name               Status StartType
----               ------ ---------
chem-app          Running Automatic
chem-caddy        Running Automatic
postgresql-x64-16 Running Automatic


次: check.ps1 で health を確かめ、04-firewall.ps1（管理者）へ
アプリの記録: C:\chem\logs\chem-app.log（最初の起動は 30 秒ほどかかります）

━━ W7 通信の入口 ━━

==> 受信の規則（192.168.1.0/24 から 443 / 80）
    OK  chem HTTPS（TCP 443）
    OK  chem HTTP (redirect)（TCP 80）

==> 閉じているべき口（5432・3001）の確認
    OK  5432 と 3001 を開けている規則はありません
次: 社員 PC から Test-NetConnection <このサーバー> -Port 443 が True、-Port 5432 が False になること

━━ W8 毎日のバックアップ ━━

==> タスク chem-backup（毎日 03:00）
    OK  登録しました

==> その場で 1 回動かす
2026-09-14 17:53:29  backup done: C:\backups\chem\chem_20260914_175328.sql.zip (0 MB)

==> できたファイル

Name                         Length LastWriteTime      
----                         ------ -------------      
chem_20260914_175328.sql.zip  22477 2026/09/14 17:53:29




━━ 状態 ━━

==> 部品
    OK  node v22.23.2  (C:\Program Files\nodejs\node.exe)
    OK  caddy\caddy.exe
    OK  nssm\nssm.exe
    OK  apps\web\.next\BUILD_ID
    OK  deploy\Caddyfile.windows
    OK  .env: chem@127.0.0.1:5432/chem

==> サービス
TaskName:      \chem-backup
Next Run Time: 2026/09/15 3:00:00
Status:        Ready



Name               Status StartType
----               ------ ---------
chem-app          Running Automatic
chem-caddy        Running Automatic
postgresql-x64-16 Running Automatic



==> 応答
    OK  http://127.0.0.1:3001/api/health → 200 {"ok":true,"db":"up"}
    !!  https://127.0.0.1/api/health → 接続が切断されました: 送信時に、予期しないエラーが発生しました。。

==> 記録の末尾（20 行）
--- C:\chem\logs\chem-app.log

> @chem/web@0.1.0 start
> next start -p 3001

   笆ｲ Next.js 15.5.23
   - Local:        http://localhost:3001
   - Network:      http://192.168.1.109:3001

 笨・Starting...
 笨・Ready in 5.9s
--- C:\chem\logs\chem-caddy.log
{"level":"warn","ts":1789375985.3412266,"logger":"http.auto_https","msg":"server is listening only on the HTTP port, so no automatic HTTPS will be applied to this server","server_name":"srv1","http_port":80}
{"level":"warn","ts":1789375985.3604627,"logger":"pki.ca.local","msg":"installing root certificate (you might be prompted for password)","path":"storage:pki/authorities/local/root.crt"}
{"level":"info","ts":1789375985.3619564,"msg":"note: NSS support is not available on your platform"}
{"level":"info","ts":1789375985.3619564,"msg":"define JAVA_HOME environment variable to use the Java trust"}
{"level":"error","ts":1789375985.3642218,"logger":"pki.ca.local","msg":"failed to install root certificate","error":"add cert failed: Failed adding cert: The request is not supported.","certificate_file":"storage:pki/authorities/local/root.crt"}
{"level":"info","ts":1789375985.364811,"logger":"http","msg":"enabling HTTP/3 listener","addr":":443"}
{"level":"info","ts":1789375985.3653333,"logger":"http.log","msg":"server running","name":"srv0","protocols":["h1","h2","h3"]}
{"level":"warn","ts":1789375985.3658571,"logger":"http","msg":"HTTP/2 skipped because it requires TLS","network":"tcp","addr":":80"}
{"level":"warn","ts":1789375985.3658571,"logger":"http","msg":"HTTP/3 skipped because it requires TLS","network":"tcp","addr":":80"}
{"level":"info","ts":1789375985.3658571,"logger":"http.log","msg":"server running","name":"srv1","protocols":["h1","h2","h3"]}
{"level":"info","ts":1789375985.3674748,"msg":"autosaved config (load with --resume flag)","file":"C:\\WINDOWS\\system32\\config\\systemprofile\\AppData\\Roaming\\Caddy\\autosave.json"}
{"level":"info","ts":1789375985.3674748,"msg":"serving initial configuration"}
{"level":"info","ts":1789375985.3699102,"logger":"tls","msg":"cleaning storage unit","storage":"FileStorage:C:\\WINDOWS\\system32\\config\\systemprofile\\AppData\\Roaming\\Caddy"}
{"level":"info","ts":1789375985.3792262,"logger":"tls","msg":"finished cleaning storage units"}
{"level":"info","ts":1789376010.307695,"logger":"tls.on_demand","msg":"obtaining new certificate","remote_ip":"127.0.0.1","remote_port":"57364","server_name":"127.0.0.1"}
{"level":"info","ts":1789376010.3186731,"logger":"tls.obtain","msg":"acquiring lock","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3209412,"logger":"tls.obtain","msg":"lock acquired","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3209412,"logger":"tls.obtain","msg":"obtaining certificate","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3379443,"logger":"tls.obtain","msg":"certificate obtained successfully","identifier":"127.0.0.1","issuer":"local"}
{"level":"info","ts":1789376010.3379443,"logger":"tls.obtain","msg":"releasing lock","identifier":"127.0.0.1"}

==> 空き容量

Name FreeGB
---- ------
C     380.2



導入が終わりました。社員 PC から https://<このサーバーの名前>/ を開いてください。
パスワードは C:\chem\secrets にあります。管理者がログインしたら画面から変えてください。
RUN-RESULT: finished
```

### 2-8. 途中で行った切り分けと、一度きりの修復

1 回目のあと、EDB インストーラーをデバッグ出力付きで直接動かした（ログは暗号化された dump だけで読めず、
セッション 0 では GUI 系のインストーラーが動かないと判断してバイナリ zip 方式へ切り替えた）。

```text
TEMP=C:\Users\Administrator\AppData\Local\Temp  session=0

FullName                                                                 
--------                                                                 
C:\Users\Administrator\AppData\Local\Temp\postgresql_installer_68909d07ad
exit=1
True
<errorDump>
</errorDump>
---- tail
VbbvexVBdGFDpaNhr+PENBTABzVg1oMDCVPMd2gdp9uNcjFfjgC7BjL/uAos
GgumqF8PzPFKARVYypTNgimn3ZF0t0MKD9E6Vf4XS7QmhjMqn7rfSjyP+ii6
7r7NcK3FUXsCRMkkWyGtpq9Ax+eMpVLcj1HokgILLWwhQp2h/DR5EPRShqXs
I+/adhPPRL0t8+GyNHflc+2Nj74y3HIiQP7Je105/POk+C8cgeJpA6smEb1m
vlJ9B6aSFdkedV0ppNc2MdFjrLfLH+9U6bezLRrh8AIJTRAOx1fbcDp1wJeb
ANYz7CQed6/E73zrwflGK5t9Dd+n+Cb6vz9y1Hciqq0zb/de56UQ8c0rjaf4
O+NCaHI+HXB5ypSiTM2KDbmjrp0D2hfy3UibOo1x3HsSHp5n05T5wWmpKRpo
hpwldKZ0woPC7sh+ONoo/qoQWPg7mQESTSeKtTM1Wg0/EOO44DwEr59xjOAc
1ParAhwUehaxUeMnlgKH9hIpNIjuyH442ij+qqcvptuxOVxUTR3Ix/JZg8Px
MtKO6OJ//tN9QAWHrwaldpv09f9B+uN7WrHeU6IpgdijTf33/RgFDeL1OU8V
whWHMv37wkTrcBRhnlqcQd5cDeL1OU8VwhVEGmn5iTpqloQyY81pxDpH2QFr
BAfd+M0SJJ7MrFn8bxbPlc2WB/opvyeZYYxuz2IMzaCLUuDkoVp65aw6cC6/
RWPKc9jxVmOD9LZBmYX4QOfDGq8V8LDiTJq8WPWIR8LipGxjqTXDQdiT7fCo
oJp97sh+ONoo/qoaYmSPQq1UD0zzfB7+jUKQJ4q1MzVaDT/ZAWsEB934zWd4
zyH5cUXSkSwR/9uC55vOPMugMv5c39K6f6kzrw5Xp/BscqBq1Di3EsdF/EwA
S9iT7fCooJp97sh+ONoo/qoQ/zvDlDzfH1GyldNx4mmY477rNZmCp0+6t1L9
AqGzYyZqEB3M4L+4TR3Ix/JZg8MNibq9K2FAwMYocI6WN8tWsyltICB2Lbs=</dump>
    <installerVersion>23.11.0</installerVersion>
    <platformInfo>{Windows NT} 10.0 intel</platformInfo>
</errorDump>
```

3 回目のあと、サービスが起動しない原因（イベントログ 7000 Access is denied、bin の ACL に NetworkService が無い）:

```text
== sc qc
[SC] QueryServiceConfig SUCCESS

SERVICE_NAME: postgresql-x64-16
        TYPE               : 10  WIN32_OWN_PROCESS 
        START_TYPE         : 2   AUTO_START
        ERROR_CONTROL      : 1   NORMAL
        BINARY_PATH_NAME   : "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" runservice -N "postgresql-x64-16" -D "C:\Program Files\PostgreSQL\16\data" -w
        LOAD_ORDER_GROUP   : 
        TAG                : 0
        DISPLAY_NAME       : postgresql-x64-16
        DEPENDENCIES       : RPCSS
        SERVICE_START_NAME : NT AUTHORITY\NetworkService
== events


TimeCreated : 2026/09/14 17:45:48
Id          : 7000
Message     : postgresql-x64-16 サービスを、次のエラーが原因で開始できませんでした: 
              Access is denied.

TimeCreated : 2026/09/14 17:45:48
Id          : 7045
Message     : サービスがシステムにインストールされました。
              
              サービス名:  postgresql-x64-16
              サービス ファイル名:  "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" runservice -N "postgresql-x64-16" -D "C:\Program Files\PostgreSQL\16\data" -w
              サービスの種類:  ユーザー モード サービス
              サービス開始の種類:  自動的な開始
              サービス アカウント:  NT AUTHORITY\NetworkService





== data\log
== icacls data
C:\Program Files\PostgreSQL\16\data BUILTIN\Administrators:(OI)(CI)(F)
                                    NT AUTHORITY\NETWORK SERVICE:(OI)(CI)(F)
                                    WIN-4SHCN21RPK4\Administrator:(OI)(CI)(F)

Successfully processed 1 files; Failed processing 0 files
== icacls bin
C:\Program Files\PostgreSQL\16\bin NT AUTHORITY\SYSTEM:(OI)(CI)(F)
                                   BUILTIN\Administrators:(OI)(CI)(F)
                                   WIN-4SHCN21RPK4\Administrator:(OI)(CI)(F)

Successfully processed 1 files; Failed processing 0 files
```

4 回目のあと、initdb に使った postgres のパスワードが `install.ps1` のやり直しで上書きされていたので、
pg_hba を一時的に trust にして secrets の値に付け直した（作業者の一度きりの操作。スクリプトの欠陥は 5 回目までに直した）:

```text
== �C��: postgres �̃p�X���[�h�� secrets �̒l�ɕt�������i��Ǝ҂̈�x����̑���j
ALTER ROLE
pg_hba restored:
host    all             all             127.0.0.1/32            scram-sha-256
```

## 3. W4 状態の確認（check.ps1）と W3 の準備

7 回目の最後の「状態」では `https://127.0.0.1/api/health` だけ失敗していた（Windows PowerShell 5.1 で
ScriptBlock の証明書コールバックが動かない `check.ps1` の欠陥）。直して再実行し、Caddy の保存場所を
`C:\ProgramData\caddy` に固定するため `03-install-services.ps1` も再実行した。

```text
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\03-install-services.ps1   （Caddy の保存場所を固定するため再実行）
見つかりません: C:\nssm\nssm.exe
At C:\chem-install\scripts\03-install-services.ps1:30 char:30
+   if (-not (Test-Path $f)) { throw "見つかりません: $f" }
+                              ~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (見つかりません: C:\nssm\nssm.exe:String) [], RuntimeException
    + FullyQualifiedErrorId : 見つかりません: C:\nssm\nssm.exe
 
PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\check.ps1

==> 部品
    OK  node v22.23.2  (C:\Program Files\nodejs\node.exe)
    OK  caddy\caddy.exe
    OK  nssm\nssm.exe
    OK  apps\web\.next\BUILD_ID
    OK  deploy\Caddyfile.windows
    OK  .env: chem@127.0.0.1:5432/chem

==> サービス

Name               Status StartType
----               ------ ---------
chem-app          Running Automatic
chem-caddy        Running Automatic
postgresql-x64-16 Running Automatic



==> 応答
    OK  http://127.0.0.1:3001/api/health → 200 {"ok":true,"db":"up"}
    OK  https://127.0.0.1/api/health → 200 {"ok":true,"db":"up"}

==> 記録の末尾（6 行）
--- C:\chem\logs\chem-app.log
   笆ｲ Next.js 15.5.23
   - Local:        http://localhost:3001
   - Network:      http://192.168.1.109:3001

 笨・Starting...
 笨・Ready in 5.9s
--- C:\chem\logs\chem-caddy.log
{"level":"info","ts":1789376010.307695,"logger":"tls.on_demand","msg":"obtaining new certificate","remote_ip":"127.0.0.1","remote_port":"57364","server_name":"127.0.0.1"}
{"level":"info","ts":1789376010.3186731,"logger":"tls.obtain","msg":"acquiring lock","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3209412,"logger":"tls.obtain","msg":"lock acquired","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3209412,"logger":"tls.obtain","msg":"obtaining certificate","identifier":"127.0.0.1"}
{"level":"info","ts":1789376010.3379443,"logger":"tls.obtain","msg":"certificate obtained successfully","identifier":"127.0.0.1","issuer":"local"}
{"level":"info","ts":1789376010.3379443,"logger":"tls.obtain","msg":"releasing lock","identifier":"127.0.0.1"}

==> 空き容量

Name FreeGB
---- ------
C     380.2


PS C:\> powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\03-install-services.ps1   （Caddy の保存場所を固定するため再実行）

==> chem-app（アプリ本体）
    !!  chem-app はすでにあります。設定だけ入れ直します

==> chem-caddy（入口・HTTPS）
    !!  chem-caddy はすでにあります。設定だけ入れ直します

==> 起動

Name               Status StartType
----               ------ ---------
chem-app          Running Automatic
chem-caddy        Running Automatic
postgresql-x64-16 Running Automatic


次: check.ps1 で health を確かめ、04-firewall.ps1（管理者）へ
アプリの記録: C:\chem\logs\chem-app.log（最初の起動は 30 秒ほどかかります）
PS C:\> Invoke-WebRequest https://127.0.0.1/api/health（証明書の検証なし）→ 新しい保存場所に証明書ができるか
{"ok":true,"db":"up"}

Name             Length
----             ------
intermediate.crt    680
intermediate.key    227
root.crt            631
root.key            227
```

開発 PC（社員 PC にあたる）からの確認:

```text
$ curl -sk https://192.168.1.109/api/health
{"ok":true,"db":"up"}
$ curl -sk --resolve chem.lan:443:192.168.1.109 https://chem.lan/api/health
{"ok":true,"db":"up"}
$ curl -s -o /dev/null -w "%{http_code} %{redirect_url}" http://192.168.1.109/
301 https://192.168.1.109/
5432 closed (good)
3001 closed (good)
```

内部 CA のルート証明書は `C:\ProgramData\caddy\pki\authorities\local\root.crt`（CN=Caddy Local Authority - 2026 ECC Root、
2036-07-23 まで）にでき、`out/record/chem-lan-root.crt` に取り寄せた。
社員 PC の hosts への `192.168.1.109 chem.lan` の登録、ルート証明書の登録、`admin@example.co.jp` でのログインは
管理者権限とパスワードが要るので利用者が行った（W3）。結果:

- hosts に登録 → `https://chem.lan/login` が開き、パスワードでログインできた（Caddy の記録で 192.168.1.207 / Chrome 153 から名前で到達）
- **ルート証明書を入れる前にパスキーを登録しようとすると「登録をやめました」**（Chrome は証明書エラーのあるページでは
  WebAuthn を拒む。NotAllowedError）。`certutil -addstore Root chem-lan-root.crt` のあと、Edge はすぐ警告が消えたが
  Chrome は `chrome://restart` で再起動するまで「保護されていない通信」のままだった
- 証明書登録・再起動後、**パスキーの登録が通った**（Windows Hello）
- 手順書 W3 に「パスキーを使うなら証明書の登録は必須。ブラウザを開き直す」を追記（c252429）

## 4. 見つかった欠陥と直し

| 回 | 症状 | 原因 | 直し（コミット） |
| --- | --- | --- | --- |
| 1 | PostgreSQL のインストーラーが終了コード 1 | EDB の GUI インストーラーは画面の無いセッション（ssh・セッション 0）では無人モードでも動かない | 公式バイナリ zip から bin/lib/share を取り出し `pg_ctl initdb` とサービス登録を自前で行う（3859157） |
| 2 | initdb が -1073741515（DLL が無い） | 素の Windows Server に Visual C++ ランタイムが無い（GUI インストーラーは内部で入れていた） | `vc_redist.x64.exe` を同梱し、PostgreSQL の前に無人で入れる（1b67fe7） |
| 3 | サービスが Access is denied | TEMP から移したフォルダの ACL に NetworkService が無い | `icacls /reset` で Program Files の既定に戻し、data に NetworkService の書き込みを付ける。登録は一度だけ（65c4478） |
| 4 | postgres のパスワード不一致 | `-Unattended` のやり直しで乱数を作り直していた | 既存の secrets を使い回す（c9848d5） |
| 6 | `nssm set AppExit` が失敗 | 2 つの値を別々の引数で渡していた | 配列で渡す（816bd8e） |
| 5 | `set-password.ts --list` が DATABASE_URL 無しで失敗 | tsx のスクリプトは .env を読まない（prisma CLI は読む） | 呼ぶ前に `$env:DATABASE_URL` を入れる（816bd8e） |
| 7 | `check.ps1` の HTTPS 確認が「送信時に予期しないエラー」 | PS 5.1 では ScriptBlock の証明書コールバックが別スレッドで動かない | .NET の型で「すべて信頼」を作る（816bd8e） |
| 7 | root.crt が手順書の場所に無い | サービス（LocalSystem）の Caddy は systemprofile の下に保存する | `XDG_DATA_HOME=C:\ProgramData` を付けて `C:\ProgramData\caddy` に固定（816bd8e） |
| — | W1 の Expand-Archive が 560 秒 | .NET の zip 展開が遅い | 手順書を `tar -xf` に変更 |
| — | 3 回目以降 `03-install-services.ps1` 単独実行で `C:\nssm` を探す | セットの scripts\ から呼ぶと導入先を取り違えていた | `_common.ps1` の既定を `C:\chem` に（816bd8e） |

## 5. 未実施

- W3 の残り: 製品一覧・テンプレート編集・ドキュメント生成の一通りの操作確認（ログインとパスキーは済み）
- 更新のしかた（update.ps1）: 次の版を当てて確かめる
- サーバー再起動後の自動起動の確認
- データだけの更新（データセット）: 未作成

