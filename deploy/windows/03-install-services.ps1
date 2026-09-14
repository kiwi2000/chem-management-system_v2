# アプリと入口（Caddy）を Windows のサービスにして、電源を入れれば立ち上がるようにする（導入手順書 §10 W6）。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\03-install-services.ps1
#
# 管理者で実行する。02-build.ps1 のあと、一度だけ。
# もう一度実行すると設定を入れ直す（登録し直しにはならない）。
#
# 作るサービス:
#   chem-app    npm run start -w apps/web（127.0.0.1 以外からも 3001 で待つが、入口は Caddy だけに開ける）
#               NODE_ENV=production（HTTPS のときだけ効くログインの記録のため）
#               PostgreSQL のサービスが上がってから起動する
#   chem-caddy  caddy run --config deploy\Caddyfile.windows（443 → 127.0.0.1:3001、証明書は内部 CA）
# 記録は C:\chem\logs\ に出す（10MB で切り替え）。

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$Nssm = "",
  [string]$Caddy = "",
  [string]$PostgresService = "postgresql-x64-16"
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $Root) { $Root = $script:ChemRoot }
if (-not $Nssm) { $Nssm = Join-Path $Root "nssm\nssm.exe" }
if (-not $Caddy) { $Caddy = Join-Path $Root "caddy\caddy.exe" }

foreach ($f in @($Nssm, $Caddy)) {
  if (-not (Test-Path $f)) { throw "見つかりません: $f" }
}
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm が見つかりません。Node.js を入れてください" }
if (-not (Test-Path (Join-Path $Root "apps\web\.next"))) { throw "組み立てが済んでいません。先に 02-build.ps1 を実行してください" }
if (-not (Get-Service $PostgresService -ErrorAction SilentlyContinue)) {
  Write-Warn2 "サービス $PostgresService が見つかりません。PostgreSQL のサービス名を -PostgresService で指定してください"
}
$logs = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Set-Nssm([string]$Service, [string]$Key, [string[]]$Value) {
  & $Nssm set $Service $Key @Value | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "nssm set $Service $Key が失敗しました" }
}

function Install-ChemService([string]$Name, [string]$Exe, [string]$Arguments, [string]$Dir, [string]$Display) {
  if (Get-Service $Name -ErrorAction SilentlyContinue) {
    Write-Warn2 "$Name はすでにあります。設定だけ入れ直します"
    & $Nssm stop $Name | Out-Null
  } else {
    & $Nssm install $Name $Exe $Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nssm install $Name が失敗しました" }
    Write-Ok "$Name を登録しました"
  }
  Set-Nssm $Name Application $Exe
  Set-Nssm $Name AppParameters $Arguments
  Set-Nssm $Name AppDirectory $Dir
  Set-Nssm $Name DisplayName $Display
  Set-Nssm $Name Start SERVICE_AUTO_START
  Set-Nssm $Name AppStdout (Join-Path $logs "$Name.log")
  Set-Nssm $Name AppStderr (Join-Path $logs "$Name.log")
  Set-Nssm $Name AppRotateFiles 1
  Set-Nssm $Name AppRotateOnline 1
  Set-Nssm $Name AppRotateBytes 10485760
  # 落ちたら 5 秒おいて上げ直す
  Set-Nssm $Name AppExit @("Default", "Restart")
  Set-Nssm $Name AppRestartDelay 5000
}

Write-Step "chem-app（アプリ本体）"
Install-ChemService "chem-app" $npm "run start -w apps/web" $Root "ケミカルコンプライアンス支援システム"
Set-Nssm "chem-app" AppEnvironmentExtra "NODE_ENV=production"
if (Get-Service $PostgresService -ErrorAction SilentlyContinue) {
  Set-Nssm "chem-app" DependOnService $PostgresService
}

Write-Step "chem-caddy（入口・HTTPS）"
$caddyfile = Join-Path $Root "deploy\Caddyfile.windows"
Install-ChemService "chem-caddy" $Caddy "run --config `"$caddyfile`"" (Split-Path -Parent $Caddy) "ケミカルコンプライアンス支援システム（入口）"
# 証明書などの保存場所。サービス（LocalSystem）の既定は C:\Windows\System32\config\systemprofile\AppData\Roaming\Caddy で
# 見つけにくいので、C:\ProgramData\caddy に固定する（root.crt を配るときに探す場所）
$caddyHome = Join-Path $env:ProgramData "caddy"
New-Item -ItemType Directory -Force -Path $caddyHome | Out-Null
Set-Nssm "chem-caddy" AppEnvironmentExtra @("XDG_DATA_HOME=$env:ProgramData", "XDG_CONFIG_HOME=$env:ProgramData")

Write-Step "起動"
foreach ($s in @("chem-app", "chem-caddy")) {
  & $Nssm start $s | Out-Null
}
Start-Sleep -Seconds 15
Get-Service chem-app, chem-caddy, $PostgresService -ErrorAction SilentlyContinue |
  Select-Object Name, Status, StartType | Format-Table -AutoSize

Write-Host "次: check.ps1 で health を確かめ、04-firewall.ps1（管理者）へ" -ForegroundColor Cyan
Write-Host "アプリの記録: $logs\chem-app.log（最初の起動は 30 秒ほどかかります）"
