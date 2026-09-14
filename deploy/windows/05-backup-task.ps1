# 毎日のバックアップをタスクスケジューラに登録し、その場で 1 回動かす（導入手順書 §10 W8）。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\05-backup-task.ps1
#
# 管理者で実行する。本体は scripts\backup-db.ps1（毎日 3:00、SYSTEM で実行、14 日保持）。
# パスワードは .env から読むので、タスクにもここにも書かない。
# バックアップは同じ機械の中（C:\backups\chem）にできる。**別の機器への複製は backup-db.ps1 の末尾を見て設定する。**

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$TaskName = "chem-backup",
  [string]$At = "03:00",
  [string]$BackupDir = "C:\backups\chem"
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $Root) { $Root = $script:ChemRoot }
$script = Join-Path $Root "scripts\backup-db.ps1"
if (-not (Test-Path $script)) { throw "見つかりません: $script" }

Write-Step "タスク $TaskName（毎日 $At）"
$tr = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$script`" -BackupDir `"$BackupDir`""
& schtasks /Create /F /TN $TaskName /SC DAILY /ST $At /RU SYSTEM /RL HIGHEST /TR $tr | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create が失敗しました" }
Write-Ok "登録しました"

Write-Step "その場で 1 回動かす"
& powershell -NoProfile -ExecutionPolicy Bypass -File $script -BackupDir $BackupDir
if ($LASTEXITCODE -ne 0) { throw "backup-db.ps1 が失敗しました" }

Write-Step "できたファイル"
Get-ChildItem $BackupDir -Filter "chem_*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name, Length, LastWriteTime | Format-Table -AutoSize

& schtasks /Query /TN $TaskName /FO LIST | Select-String -Pattern "TaskName|Status|Next Run Time|次回"
