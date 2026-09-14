# Windows Server 直置き構成の組み立てスクリプト

導入手順書 §10「Windows Server への導入」の「打ち込む」部分を、順番に実行できる形にしたもの。
手順の説明そのものは手順書を読むこと。ここは順番と確かめかたの覚え書き。

前提: Node.js 22 LTS（MSI）・PostgreSQL 16（UTF-8 で入れる。postgres のパスワードを控える）・
`C:\chem\caddy\caddy.exe`・`C:\chem\nssm\nssm.exe` を入れ、配布物の zip を `C:\chem` に展開してある。

| 順 | スクリプト | 権限 | 確かめかた |
| --- | --- | --- | --- |
| 1 | `01-create-db.ps1` | 一般 | 最後に出る表で `UTF8` |
| 2 | `.env.windows.example` を `C:\chem\.env` に写し、パスワードを書く | | `check.ps1` に `.env: chem@127.0.0.1:5432/chem` |
| 3 | `02-build.ps1`（別の機械の DB を持ち込むなら `-DumpFile <pg_dump -Fc のファイル>`） | 一般 | `migrate deploy` が「適用なし」または成功、利用者の一覧が出る |
| 4 | `03-install-services.ps1` | 管理者 | 3 つのサービスが Running / Automatic |
| 5 | `check.ps1` | 一般 | `http://127.0.0.1:3001/api/health` と `https://127.0.0.1/api/health` が 200 |
| 6 | `04-firewall.ps1 -LanCidr <社内 LAN>` | 管理者 | 社員 PC から 443 が通り、5432 が通らない |
| 7 | `05-backup-task.ps1` | 管理者 | `C:\backups\chem\chem_*.zip` ができる |
| 8 | サーバーを再起動して 5 をもう一度 | | 自動起動の確認 |

社員 PC 側: hosts か社内 DNS でサーバーに名前を付ける（パスキーは IP では登録できない）。
`%ProgramData%\caddy\pki\authorities\local\root.crt` を「信頼されたルート証明機関」に入れると証明書の警告が消える。

更新: `backup-db.ps1` → `nssm stop chem-app` → 新しい zip を展開 → `02-build.ps1` → `nssm start chem-app`。
