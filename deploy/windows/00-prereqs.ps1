# 前提ソフトを入れる（導入手順書 §10）。install.ps1 から呼ばれる。管理者で実行する。
#
#   powershell -ExecutionPolicy Bypass -File <セット>\scripts\00-prereqs.ps1 -Installers <セット>\installers
#
# インストールセットの installers\ にある公式インストーラーを使う（インターネットは要らない）:
#   node-*-x64.msi                  Node.js 22 LTS。PATH に通す
#   postgresql-16.*-windows-x64-binaries.zip  PostgreSQL 16 の公式バイナリ。展開して initdb・サービス登録（ポート 5432、サービス postgresql-x64-16）
#   caddy_*_windows_amd64.zip       caddy.exe を C:\chem\caddy\ に置く
#   nssm-*.zip                      nssm.exe（win64）を C:\chem\nssm\ に置く
# すでに入っているものは飛ばす。
# PostgreSQL の管理ユーザー（postgres）のパスワードは -SuperPassword で受け取る（install.ps1 が渡す）。

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installers,
  [string]$Root = "C:\chem",
  [securestring]$SuperPassword,
  [int]$PgPort = 5432,
  [string]$PostgresService = "postgresql-x64-16"
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not (Test-Path $Installers)) { throw "installers フォルダが見つかりません: $Installers" }
New-Item -ItemType Directory -Force -Path $Root, (Join-Path $Root "caddy"), (Join-Path $Root "nssm") | Out-Null

function Find-Installer([string]$Pattern) {
  $f = Get-ChildItem $Installers -Filter $Pattern | Select-Object -First 1
  if (-not $f) { throw "installers に $Pattern がありません" }
  return $f.FullName
}

Write-Step "Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Update-PathFromMachine; $node = Get-Command node -ErrorAction SilentlyContinue }
if ($node) {
  Write-Ok "すでにあります: $(& node -v)"
} else {
  $msi = Find-Installer "node-*-x64.msi"
  Write-Host "    入れています: $(Split-Path -Leaf $msi)（1〜2 分）"
  $p = Start-Process msiexec.exe -ArgumentList @("/i", "`"$msi`"", "/qn", "/norestart") -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Node.js のインストールが失敗しました（終了コード $($p.ExitCode)）" }
  Update-PathFromMachine
  Write-Ok "入れました: $(& node -v)"
}

Write-Step "PostgreSQL 16"
# GUI のインストーラーは使わない（画面の無いセッションでは無人モードでも動かない）。
# 公式のバイナリ zip から bin / lib / share だけを取り出し、initdb とサービス登録を自分で行う
# （EDB のインストーラーが中でやっていることと同じ。pgAdmin などは入れない）
$pgRoot = "C:\Program Files\PostgreSQL\16"
$pgData = Join-Path $pgRoot "data"
if (Get-Service $PostgresService -ErrorAction SilentlyContinue) {
  Write-Ok "すでにあります（サービス $PostgresService）"
} else {
  if (-not $SuperPassword) {
    $SuperPassword = Read-Host -AsSecureString "postgres（管理ユーザー）に付けるパスワード"
  }
  $zip = Find-Installer "postgresql-16*-windows-x64-binaries.zip"
  if (-not (Test-Path (Join-Path $pgRoot "bin\postgres.exe"))) {
    Write-Host "    展開しています: $(Split-Path -Leaf $zip)（1〜2 分）"
    $tmp = Join-Path $env:TEMP "pg-unzip"
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $tmp, $pgRoot | Out-Null
    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    & $tar -xf $zip -C $tmp "pgsql/bin" "pgsql/lib" "pgsql/share"
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL の zip の展開が失敗しました（終了コード $LASTEXITCODE）" }
    foreach ($d in @("bin", "lib", "share")) { Move-Item (Join-Path $tmp "pgsql\$d") (Join-Path $pgRoot $d) }
    Remove-Item $tmp -Recurse -Force
  }
  $pgCtl = Join-Path $pgRoot "bin\pg_ctl.exe"
  if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
    Write-Host "    initdb（UTF-8 / 照合順序 C / scram-sha-256）"
    # initdb は管理者権限では動かないが、pg_ctl 経由なら権限を落として実行してくれる。
    # 権限を落とした側でも書けるよう、data の所有を作業者と NetworkService に付けておく
    New-Item -ItemType Directory -Force -Path $pgData | Out-Null
    & icacls $pgData /inheritance:r /grant "${env:USERNAME}:(OI)(CI)F" /grant "NT AUTHORITY\NetworkService:(OI)(CI)F" /grant "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
    & icacls $pgRoot /grant "NT AUTHORITY\NetworkService:(OI)(CI)RX" | Out-Null
    $pwFile = Join-Path $env:TEMP "pg-superpw.txt"
    [IO.File]::WriteAllText($pwFile, (ConvertTo-Plain $SuperPassword) + "`n", (New-Object Text.ASCIIEncoding))
    try {
      & $pgCtl initdb -D $pgData -o "-U postgres --pwfile=$pwFile -E UTF8 --locale=C -A scram-sha-256"
      if ($LASTEXITCODE -ne 0) { throw "initdb が失敗しました（終了コード $LASTEXITCODE）" }
    } finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
    # 記録は data\log に残す（EDB のインストーラーと同じ）
    Add-Content -Path (Join-Path $pgData "postgresql.conf") -Value "`r`n# chem install`r`nlogging_collector = on`r`nlog_directory = 'log'`r`nport = $PgPort`r`n" -Encoding ascii
  }
  Write-Host "    サービス $PostgresService を登録（NetworkService で起動）"
  & $pgCtl register -N $PostgresService -U "NT AUTHORITY\NetworkService" -D $pgData -S auto -w
  if ($LASTEXITCODE -ne 0) { throw "サービスの登録が失敗しました（終了コード $LASTEXITCODE）" }
  Start-Service $PostgresService
  Start-Sleep -Seconds 3
  $svc = Get-Service $PostgresService
  if ($svc.Status -ne "Running") { throw "サービス $PostgresService が起動しません。$pgData\log を確かめてください" }
  Write-Ok "入れました（サービス ${PostgresService}: $($svc.Status)、$pgRoot）"
}

Write-Step "Caddy"
$caddyExe = Join-Path $Root "caddy\caddy.exe"
if (Test-Path $caddyExe) {
  Write-Ok "すでにあります: $(& $caddyExe version)"
} else {
  $zip = Find-Installer "caddy_*_windows_amd64.zip"
  $tmp = Join-Path $env:TEMP "caddy-unzip"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp
  Copy-Item (Join-Path $tmp "caddy.exe") $caddyExe
  Remove-Item $tmp -Recurse -Force
  Write-Ok "置きました: $(& $caddyExe version)"
}

Write-Step "NSSM"
$nssmExe = Join-Path $Root "nssm\nssm.exe"
if (Test-Path $nssmExe) {
  Write-Ok "すでにあります"
} else {
  $zip = Find-Installer "nssm-*.zip"
  $tmp = Join-Path $env:TEMP "nssm-unzip"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp
  $found = Get-ChildItem $tmp -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match "win64" } | Select-Object -First 1
  if (-not $found) { throw "zip の中に win64\nssm.exe がありません" }
  Copy-Item $found.FullName $nssmExe
  Remove-Item $tmp -Recurse -Force
  Write-Ok "置きました"
}
