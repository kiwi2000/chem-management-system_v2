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

# Node.js のセキュリティ更新（2026-10-22）。同梱の MSI が、入っているものより新しい同じ大きい版なら入れ替える
# （大きい版が違うときは 00-prereqs.ps1 と同じく止める。別の版で組み立てたアプリの部品が読めないことがある）
Write-Step "Node.js の版"
$nodeMsi = Get-ChildItem (Join-Path $SetDir "installers") -Filter "node-*-x64.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeMsi -and $nodeCmd -and $nodeMsi.Name -match 'node-v(\d+\.\d+\.\d+)') {
  $want = [version]$Matches[1]
  $have = [version]((& node -v).Trim().TrimStart("v"))
  if ($want.Major -ne $have.Major) {
    throw "Node.js $have が入っていますが、このセットは Node.js $($want.Major) 用です。00-prereqs.ps1 の案内どおり入れ替えてから、もう一度実行してください"
  } elseif ($want -gt $have) {
    Write-Host "    $have → $want に入れ替えます（$($nodeMsi.Name)。1〜2 分）"
    $p = Start-Process msiexec.exe -ArgumentList @("/i", "`"$($nodeMsi.FullName)`"", "/qn", "/norestart") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Node.js の入れ替えが失敗しました（終了コード $($p.ExitCode)）" }
    Write-Ok "入れ替えました: $(& node -v)"
  } else {
    Write-Ok "そのまま: $have（同梱 $want）"
  }
} else {
  Write-Warn2 "Node.js の版を確かめられませんでした（同梱の MSI か node が見つかりません）"
}

# PostgreSQL のセキュリティ更新（2026-10-22）。同梱の公式バイナリ zip が入っているものより新しい 16.x なら、
# bin / lib / share を入れ替える（data はそのまま。同じ大きい版の中の入れ替えは、ファイルを置き換えるだけでよい）
Write-Step "PostgreSQL の版"
$pgRoot = "C:\Program Files\PostgreSQL\16"
$pgZip = Get-ChildItem (Join-Path $SetDir "installers") -Filter "postgresql-16*-windows-x64-binaries.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
$pgExe = Join-Path $pgRoot "bin\postgres.exe"
if ($pgZip -and (Test-Path $pgExe) -and $pgZip.Name -match 'postgresql-(16\.\d+)-') {
  $pgWant = [version]$Matches[1]
  $pgHaveText = (& $pgExe --version) -join " "
  if ($pgHaveText -match '(\d+\.\d+)') { $pgHave = [version]$Matches[1] } else { $pgHave = $null }
  if ($pgHave -and $pgWant -gt $pgHave) {
    Write-Host "    $pgHave → $pgWant に入れ替えます（$($pgZip.Name)。1〜2 分）"
    & $nssm stop chem-caddy | Out-Null
    Stop-Service postgresql-x64-16 -ErrorAction Stop
    $tmp = Join-Path $env:TEMP "pg-unzip"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    & (Join-Path $env:SystemRoot "System32\tar.exe") -xf $pgZip.FullName -C $tmp "pgsql/bin" "pgsql/lib" "pgsql/share"
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL の zip の展開が失敗しました（終了コード $LASTEXITCODE）" }
    foreach ($d in @("bin", "lib", "share")) {
      $old = Join-Path $pgRoot "$d.old"
      if (Test-Path $old) { Remove-Item $old -Recurse -Force }
      Rename-Item (Join-Path $pgRoot $d) "$d.old"
      Move-Item (Join-Path $tmp "pgsql\$d") (Join-Path $pgRoot $d)
    }
    Remove-Item $tmp -Recurse -Force
    # zip から出したフォルダは TEMP の権限を引きずる（00-prereqs.ps1 と同じ手当て）
    & icacls $pgRoot /reset /T /Q | Out-Null
    & icacls (Join-Path $pgRoot "data") /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /T /Q | Out-Null
    Start-Service postgresql-x64-16 -ErrorAction Stop
    Start-Sleep -Seconds 3
    $after = (& $pgExe --version) -join " "
    if ((Get-Service postgresql-x64-16).Status -ne "Running") { throw "PostgreSQL が起動しません。bin.old / lib.old / share.old を戻してください" }
    foreach ($d in @("bin", "lib", "share")) { Remove-Item (Join-Path $pgRoot "$d.old") -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Ok "入れ替えました: $after"
  } elseif ($pgHave) {
    Write-Ok "そのまま: $pgHave（同梱 $pgWant）"
  } else {
    Write-Warn2 "入っている PostgreSQL の版が読めませんでした: $pgHaveText"
  }
} else {
  Write-Warn2 "PostgreSQL の版を確かめられませんでした（同梱の zip か postgres.exe が見つかりません）"
}

# Caddy のセキュリティ更新（2026-10-22）。同梱の zip が新しければ caddy.exe を入れ替える（robocopy は caddy フォルダーを残すので、ここで行う）
Write-Step "Caddy の版"
$caddyExe = Join-Path $Root "caddy\caddy.exe"
$caddyZip = Get-ChildItem (Join-Path $SetDir "installers") -Filter "caddy_*_windows_amd64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($caddyZip -and (Test-Path $caddyExe) -and $caddyZip.Name -match 'caddy_(\d+\.\d+\.\d+)_') {
  $cWant = [version]$Matches[1]
  $cHaveText = (& $caddyExe version) -join " "
  if ($cHaveText -match 'v?(\d+\.\d+\.\d+)') { $cHave = [version]$Matches[1] } else { $cHave = $null }
  if ($cHave -and $cWant -gt $cHave) {
    Write-Host "    $cHave → $cWant に入れ替えます（$($caddyZip.Name)）"
    & $nssm stop chem-caddy | Out-Null
    Start-Sleep -Seconds 2
    $tmp = Join-Path $env:TEMP "caddy-unzip"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    & (Join-Path $env:SystemRoot "System32\tar.exe") -xf $caddyZip.FullName -C $tmp "caddy.exe"
    if ($LASTEXITCODE -ne 0) { throw "Caddy の zip の展開が失敗しました（終了コード $LASTEXITCODE）" }
    Copy-Item (Join-Path $tmp "caddy.exe") $caddyExe -Force
    Remove-Item $tmp -Recurse -Force
    & $nssm start chem-caddy | Out-Null
    Write-Ok "入れ替えました: $((& $caddyExe version) -join ' ')"
  } elseif ($cHave) {
    Write-Ok "そのまま: $cHave（同梱 $cWant）"
  } else {
    Write-Warn2 "入っている Caddy の版が読めませんでした: $cHaveText"
  }
} else {
  Write-Warn2 "Caddy の版を確かめられませんでした（同梱の zip か caddy.exe が見つかりません）"
}

Write-Step "ファイルの入れ替え（$appSrc → $Root）"
# data（作った帳票の PDF の既定の置き場所）は残す。道筋で書く（名前だけだと node_modules の中の data まで外れる）
& robocopy $appSrc $Root /MIR /XF .env /XD logs secrets caddy nssm (Join-Path $Root "data") /NFL /NDL /NJH /NP /R:2 /W:2 | Select-Object -Last 8
if ($LASTEXITCODE -ge 8) { throw "robocopy が失敗しました（終了コード $LASTEXITCODE）" }
Write-Ok "版 $($new.version) を置きました"

& (Join-Path $PSScriptRoot "02-migrate.ps1") -Root $Root

Write-Step "アプリを起動"
& $nssm start chem-app | Out-Null
Start-Sleep -Seconds 15
& (Join-Path $PSScriptRoot "check.ps1") -Root $Root
