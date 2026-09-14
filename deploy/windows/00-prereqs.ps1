# 前提ソフトを入れる（導入手順書 §10）。install.ps1 から呼ばれる。管理者で実行する。
#
#   powershell -ExecutionPolicy Bypass -File <セット>\scripts\00-prereqs.ps1 -Installers <セット>\installers
#
# インストールセットの installers\ にある公式インストーラーを使う（インターネットは要らない）:
#   node-*-x64.msi                  Node.js 22 LTS。PATH に通す
#   postgresql-16.*-windows-x64.exe PostgreSQL 16。無人で入れる（ポート 5432、サービス postgresql-x64-16、pgAdmin は入れない）
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
if (Get-Service $PostgresService -ErrorAction SilentlyContinue) {
  Write-Ok "すでにあります（サービス $PostgresService）"
} else {
  if (-not $SuperPassword) {
    $SuperPassword = Read-Host -AsSecureString "postgres（管理ユーザー）に付けるパスワード"
  }
  $exe = Find-Installer "postgresql-16*-windows-x64.exe"
  Write-Host "    入れています: $(Split-Path -Leaf $exe)（3〜5 分）"
  $args = @(
    "--mode", "unattended", "--unattendedmodeui", "none",
    "--superpassword", (ConvertTo-Plain $SuperPassword),
    "--serverport", "$PgPort", "--servicename", $PostgresService,
    "--enable-components", "server,commandlinetools", "--disable-components", "pgAdmin,stackbuilder"
  )
  $p = Start-Process $exe -ArgumentList $args -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "PostgreSQL のインストールが失敗しました（終了コード $($p.ExitCode)）" }
  $svc = Get-Service $PostgresService -ErrorAction SilentlyContinue
  if (-not $svc) { throw "インストール後にサービス $PostgresService が見つかりません" }
  if ($svc.Status -ne "Running") { Start-Service $PostgresService }
  Write-Ok "入れました（サービス ${PostgresService}: $((Get-Service $PostgresService).Status)）"
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
