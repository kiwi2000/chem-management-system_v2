# アプリを新しい版に入れ替える（導入手順書 §10「更新のしかた」）。アップデートセットの中から、管理者で実行する。
#
#   powershell -ExecutionPolicy Bypass -File <セット>\scripts\update.ps1
#
# 流れ:
#   1. いま入っている版と、届いた版を比べて表示（アプリの版・データベースの表の変更の有無）
#   2. バックアップ（scripts\backup-db.ps1）
#   3. アプリを止める
#   4. 新しいファイルに入れ替える（.env・記録・秘密は残す）
#   5. データベースの表に足りない変更を足す（02-migrate.ps1。変わっていなければ何もしない）
#   6. アプリを起動し、状態を出す
# 失敗したら: 前の版のセットで同じ手順を行い、必要なら 2 のバックアップから復元する（backup-db.ps1 の頭にやり方）。

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$SetDir = "",
  [string]$Root = "C:\chem",
  [switch]$SkipBackup
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $SetDir) { $SetDir = Split-Path -Parent $PSScriptRoot }
$appSrc = Join-Path $SetDir "app"
if (-not (Test-Path $appSrc)) { throw "セットの中身が見つかりません: $appSrc" }
$new = Read-Manifest (Join-Path $appSrc "manifest.json")
$cur = Read-Manifest (Join-Path $Root "manifest.json")
if (-not $new) { throw "app\manifest.json がありません" }
if (-not (Test-Path (Join-Path $Root ".env"))) { throw "$Root に .env がありません。初回は install.ps1 を使ってください" }
$nssm = Join-Path $Root "nssm\nssm.exe"

Write-Step "版の比較"
$curVer = "（不明）"; $curMig = "（不明）"
if ($cur) { $curVer = "$($cur.version)（$($cur.commit)）"; $curMig = $cur.lastMigration }
Write-Host "    いま:   $curVer  表の最終変更 $curMig"
Write-Host "    届いた: $($new.version)（$($new.commit)）  表の最終変更 $($new.lastMigration)"
if ($cur -and $cur.lastMigration -eq $new.lastMigration) {
  Write-Ok "データベースの表は変わりません（アプリのファイルだけ入れ替えます）"
} else {
  Write-Warn2 "データベースの表が変わります。02-migrate.ps1 が足りない変更を足します（先にバックアップを取ります）"
}

if ($SkipBackup) {
  Write-Warn2 "バックアップを飛ばします（-SkipBackup）"
} else {
  Write-Step "バックアップ"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\backup-db.ps1")
  if ($LASTEXITCODE -ne 0) { throw "バックアップが失敗したので止めます" }
}

Write-Step "アプリを止める"
& $nssm stop chem-app | Out-Null
Start-Sleep -Seconds 3
Write-Ok "chem-app: $((Get-Service chem-app).Status)"

Write-Step "ファイルの入れ替え（$appSrc → $Root）"
& robocopy $appSrc $Root /MIR /XF .env /XD logs secrets caddy nssm /NFL /NDL /NJH /NP /R:2 /W:2 | Select-Object -Last 8
if ($LASTEXITCODE -ge 8) { throw "robocopy が失敗しました（終了コード $LASTEXITCODE）" }
Write-Ok "版 $($new.version) を置きました"

& (Join-Path $PSScriptRoot "02-migrate.ps1") -Root $Root

Write-Step "アプリを起動"
& $nssm start chem-app | Out-Null
Start-Sleep -Seconds 15
& (Join-Path $PSScriptRoot "check.ps1") -Root $Root
