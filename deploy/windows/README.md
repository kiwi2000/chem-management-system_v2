# Windows Server 直置き構成のスクリプト

導入手順書 §10「Windows Server への導入」で使うもの。お客さんにはインストールセット
（`scripts/build-install-set.ps1` で作る zip）の `scripts\` として同梱され、`C:\chem\deploy\windows\` にも写る。
手順の説明そのものは手順書を読むこと。ここは部品の一覧。

| スクリプト                 | 役目                                                                                                                                                 | 権限   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `install.ps1`              | 初回の導入をまとめて行う（W1〜W8 を順に呼ぶ）。`-Unattended` で乱数のパスワードを `C:\chem\secrets` に保存（当方の作業者向け。お客さんは画面で打つ） | 管理者 |
| `update.ps1`               | 更新。版の比較 → バックアップ → 停止 → ファイル入れ替え（robocopy /MIR） → 表の変更 → 起動 → 状態                                                    | 管理者 |
| `check.ps1`                | 状態をまとめて出す。何も変えない                                                                                                                     | 一般   |
| `00-prereqs.ps1`           | Node.js / PostgreSQL（無人） / Caddy / NSSM を `installers\` から入れる。入っているものは飛ばす                                                      | 管理者 |
| `01-create-db.ps1`         | ユーザー chem とデータベース chem（UTF-8 / 照合順序 C）を作る                                                                                        | 一般   |
| `02-migrate.ps1`           | `prisma migrate status` → `deploy`。`-DumpFile` で pg_dump -Fc を空の DB に流し込む                                                                  | 一般   |
| `03-install-services.ps1`  | nssm で chem-app / chem-caddy を登録・起動（記録は `C:\chem\logs`、落ちたら再起動、PostgreSQL の後に起動）                                           | 管理者 |
| `04-firewall.ps1 -LanCidr` | 443 / 80 を LAN からだけ許可。5432 / 3001 が閉じていることを表示                                                                                     | 管理者 |
| `05-backup-task.ps1`       | タスク chem-backup（毎日 3:00、`scripts\backup-db.ps1`）を登録して 1 回動かす                                                                        | 管理者 |
| `_common.ps1`              | 共通の部品（.env の読み取り、PATH の読み直し、乱数パスワード、manifest）                                                                             |        |

決まり: Windows PowerShell 5.1 で動くこと（`&&` や `?:` を使わない、native の `2>&1` を付けない）。
ファイルは **UTF-8 BOM 付き**（無いと 5.1 が Shift-JIS として読んで壊れる）。
