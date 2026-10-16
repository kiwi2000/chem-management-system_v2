# 業務DBの日次バックアップ（Windows Server 版）。
# Docker を使わず PostgreSQL を直接入れた構成で使う。Linux 版は backup-db.sh。
#
# タスクスケジューラへの登録（毎日3時・管理者で）:
#   schtasks /Create /TN "chem-backup" /SC DAILY /ST 03:00 /RU SYSTEM ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\chem\scripts\backup-db.ps1"
#
# 復元（--clean 付きで取っているので、いまの中身をバックアップ時点の内容に置き換える。管理者の PowerShell で）:
#   C:\chem\nssm\nssm.exe stop chem-app
#   Expand-Archive C:\backups\chem\chem_20260902_030000.sql.zip -DestinationPath C:\backups\restore
#   $env:PGPASSWORD = "<chem のパスワード（C:\chem\.env の DATABASE_URL の中）>"
#   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -h 127.0.0.1 -U chem -d chem `
#     -f C:\backups\restore\chem_20260902_030000.sql
#   C:\chem\nssm\nssm.exe start chem-app
# （導入手順書 第10章「バックアップからの復元」と同じ。バックアップは zip なので先に展開する）
#
# 動いた記録は C:\chem\logs\backup.log に1行ずつ残す（成功も失敗も。タスクの出力はどこにも残らないため）。
#
# **ホストは 127.0.0.1 を使う。**localhost だと IPv6(::1) に解決されて
# 繋がらないことがある（CLAUDE.md §5）。
[CmdletBinding()]
param(
  [string]$BackupDir = "C:\backups\chem",
  [int]$KeepDays = 14,
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$Database = "chem",
  [string]$User = "chem"
)

$ErrorActionPreference = "Stop"

# パスワードは .env から読む。スクリプトにも、タスクの引数にも書かない
$repo = Split-Path -Parent $PSScriptRoot

# 記録（成功も失敗も1行ずつ）。失敗はここに残してから止まる
$logDir = Join-Path $repo "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "backup.log"
function Write-BackupLog([string]$msg) {
  Add-Content -Path $logFile -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" -Encoding UTF8
}
trap {
  Write-BackupLog "failed: $_"
  $env:PGPASSWORD = $null
  break
}

$envFile = Join-Path $repo ".env"
if (-not (Test-Path $envFile)) { throw ".env が見つかりません: $envFile" }

$url = (Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1).Line
if (-not $url) { throw ".env に DATABASE_URL がありません" }
# postgresql://ユーザー:パスワード@ホスト:ポート/データベース
if ($url -notmatch 'postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?"\s]+)') {
  throw "DATABASE_URL の形が読めません"
}
$User = $Matches[1]
$env:PGPASSWORD = $Matches[2]
$pgHost = $Matches[3]
$pgPort = $Matches[4]
$Database = $Matches[5]

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dump = Join-Path $BackupDir "chem_$stamp.sql"
$zip = "$dump.zip"

# pg_dump は 2>&1 を付けない（native の stderr を ErrorRecord に包むと、
# 正常終了でも失敗と判定される。Windows PowerShell 5.1 の癖）
& (Join-Path $PgBin "pg_dump.exe") --clean --if-exists -h $pgHost -p $pgPort -U $User -d $Database -f $dump
if ($LASTEXITCODE -ne 0) { throw "pg_dump が失敗しました（終了コード $LASTEXITCODE）" }

Compress-Archive -Path $dump -DestinationPath $zip -Force
Remove-Item $dump -Force

# 古いものを片付ける
Get-ChildItem -Path $BackupDir -Filter "chem_*.sql.zip" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
  Remove-Item -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  backup done: $zip ($size MB)"
Write-BackupLog "done: $zip ($size MB)"

$env:PGPASSWORD = $null

# ── 別の機器への複製（必ず設定してください）──────────────────
# バックアップが同じサーバーの中だけにあると、そのサーバーが壊れたときに
# データも一緒に失われます。社内NASなどへ毎日コピーしてください。
# **このファイルには書き足さない**（アプリの更新で元に戻る）。タスクスケジューラに別のタスクを作る。例:
#   robocopy C:\backups\chem \\nas01\backup\chem /E
