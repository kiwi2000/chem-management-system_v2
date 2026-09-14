# 初回の導入をまとめて行う（導入手順書 §10）。インストールセットの中から、管理者で実行する。
#
#   powershell -ExecutionPolicy Bypass -File <セット>\scripts\install.ps1 -LanCidr 192.168.1.0/24 -AdminEmail admin@example.co.jp
#
# 途中で 3 つのパスワードを聞く（画面で打つ。引数にも履歴にも残らない）:
#   postgres（データベースの管理ユーザー）／chem（アプリが使うユーザー）／最初の管理者（画面にログインする人）
# -Unattended を付けると、聞かずに乱数で作って C:\chem\secrets\ に保存する（Administrators だけが読める）。
#
# 流れ（手順書の W1〜W8 と同じ番号）:
#   W1 前提ソフト（Node.js / PostgreSQL / Caddy / NSSM）   00-prereqs.ps1
#   W2 データベースとユーザー                                 01-create-db.ps1
#   W3 アプリを C:\chem に置き、.env を作る
#   W4 データベースの表                                       02-migrate.ps1
#   W5 最初の管理者
#   W6 サービス登録・起動                                     03-install-services.ps1
#   W7 通信の入口                                             04-firewall.ps1
#   W8 毎日のバックアップ                                     05-backup-task.ps1
#   最後に check.ps1 で状態を出す。
# 途中で失敗したら、直してから同じコマンドをもう一度実行すればよい（済んだところは飛ばす）。

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LanCidr,
  [string]$AdminEmail = "",
  [string]$SetDir = "",
  [string]$Root = "C:\chem",
  [string]$DumpFile = "",
  [switch]$Unattended
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $SetDir) { $SetDir = Split-Path -Parent $PSScriptRoot }
$appSrc = Join-Path $SetDir "app"
$installers = Join-Path $SetDir "installers"
foreach ($d in @($appSrc, $installers)) { if (-not (Test-Path $d)) { throw "セットの中身が見つかりません: $d" } }
$manifest = Read-Manifest (Join-Path $appSrc "manifest.json")
if (-not $manifest) { throw "app\manifest.json がありません。組み立て済みのセットではありません" }
Write-Host "ケミカルコンプライアンス支援システム 版 $($manifest.version)（$($manifest.commit)、組み立て $($manifest.builtAt)）" -ForegroundColor Cyan
Write-Host "セット: $SetDir → 導入先: $Root"

# ── パスワード ──
$secretsDir = Join-Path $Root "secrets"
$generated = @{}
function Get-Secret([string]$Key, [string]$Prompt) {
  if ($Unattended) {
    # やり直しのときは前回作ったものを使う（作り直すと、もう入れたものと食い違う）
    $f = Join-Path $secretsDir "$Key.txt"
    if (Test-Path $f) {
      $pw = (Get-Content $f -Raw).Trim()
      Write-Warn2 "$Key のパスワードは前回の $f を使います"
    } else {
      $pw = New-RandomPassword 24
      $generated[$Key] = $pw
    }
    return (ConvertTo-SecureString $pw -AsPlainText -Force)
  }
  return (Read-Host -AsSecureString $Prompt)
}
$envFile = Join-Path $Root ".env"
$pgService = Get-Service "postgresql-x64-16" -ErrorAction SilentlyContinue
$superPw = $null
if (-not $pgService -or -not (Test-Path $envFile)) {
  Write-Step "パスワード"
  $superPw = Get-Secret "postgres" "postgres（データベースの管理ユーザー）のパスワード"
}
$chemPw = $null
if (-not (Test-Path $envFile)) {
  $chemPw = Get-Secret "chem-db" "chem（アプリが使うデータベースのユーザー）のパスワード（12 文字以上、@ / ' を含めない）"
}
$adminPw = $null
if ($AdminEmail) {
  $adminPw = Get-Secret "admin" "最初の管理者 $AdminEmail のログインパスワード"
}
if ($Unattended -and $generated.Count -gt 0) {
  New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
  & icacls $secretsDir /inheritance:r /grant "SYSTEM:(OI)(CI)F" /grant "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
  foreach ($k in $generated.Keys) {
    $f = Join-Path $secretsDir "$k.txt"
    Set-Content -Path $f -Value $generated[$k] -Encoding ascii
  }
  Write-Warn2 "パスワードは乱数で作り、$secretsDir に保存しました（Administrators だけが読めます）"
}

# ── W1 ──
Write-Host ""
Write-Host "━━ W1 前提ソフト ━━" -ForegroundColor Magenta
$p = @{ Installers = $installers; Root = $Root }
if ($superPw) { $p.SuperPassword = $superPw }
& (Join-Path $PSScriptRoot "00-prereqs.ps1") @p

# ── W2 ──
Write-Host ""
Write-Host "━━ W2 データベースとユーザー ━━" -ForegroundColor Magenta
if (Test-Path $envFile) {
  Write-Ok ".env がすでにあるので、データベースは作ってあるとみなします"
} else {
  & (Join-Path $PSScriptRoot "01-create-db.ps1") -AdminPassword $superPw -UserPassword $chemPw
}

# ── W3 ──
Write-Host ""
Write-Host "━━ W3 アプリの配置 ━━" -ForegroundColor Magenta
Write-Step "robocopy $appSrc → $Root（数分）"
# .env・記録・秘密は残す。/MIR で古いファイルを消す（更新でも同じ）
& robocopy $appSrc $Root /MIR /XF .env /XD logs secrets caddy nssm /NFL /NDL /NJH /NP /R:2 /W:2 | Select-Object -Last 8
if ($LASTEXITCODE -ge 8) { throw "robocopy が失敗しました（終了コード $LASTEXITCODE）" }
Write-Ok "置きました（版 $($manifest.version)）"
if (-not (Test-Path $envFile)) {
  Write-Step ".env を作る"
  $example = Join-Path $Root ".env.windows.example"
  $text = Get-Content $example -Raw -Encoding UTF8
  $text = $text.Replace("CHANGE_ME", (ConvertTo-Plain $chemPw))
  [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
  & icacls $envFile /inheritance:r /grant "SYSTEM:F" /grant "BUILTIN\Administrators:F" | Out-Null
  Write-Ok "$envFile（Administrators だけが読めます）"
}
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

# ── W4 ──
Write-Host ""
Write-Host "━━ W4 データベースの表 ━━" -ForegroundColor Magenta
$m = @{ Root = $Root }
if ($DumpFile) { $m.DumpFile = $DumpFile }
& (Join-Path $PSScriptRoot "02-migrate.ps1") @m

# ── W5 ──
Write-Host ""
Write-Host "━━ W5 最初の管理者 ━━" -ForegroundColor Magenta
if ($AdminEmail) {
  Set-Location $Root
  $npx = Get-NodeCommand "npx.cmd"
  $env:DATABASE_URL = Get-DatabaseUrlValue $envFile
  try {
    & $npx tsx scripts/set-password.ts $AdminEmail (ConvertTo-Plain $adminPw) --create
    if ($LASTEXITCODE -ne 0) { throw "管理者の作成が失敗しました" }
  } finally { $env:DATABASE_URL = $null }
  Write-Ok "$AdminEmail（全権限）"
} else {
  Write-Warn2 "-AdminEmail が無いので作りません（あとで npx tsx scripts\set-password.ts <メール> <パスワード> --create）"
}

# ── W6〜W8 ──
Write-Host ""
Write-Host "━━ W6 サービス ━━" -ForegroundColor Magenta
& (Join-Path $PSScriptRoot "03-install-services.ps1") -Root $Root
Write-Host ""
Write-Host "━━ W7 通信の入口 ━━" -ForegroundColor Magenta
& (Join-Path $PSScriptRoot "04-firewall.ps1") -LanCidr $LanCidr
Write-Host ""
Write-Host "━━ W8 毎日のバックアップ ━━" -ForegroundColor Magenta
& (Join-Path $PSScriptRoot "05-backup-task.ps1") -Root $Root

Write-Host ""
Write-Host "━━ 状態 ━━" -ForegroundColor Magenta
& (Join-Path $PSScriptRoot "check.ps1") -Root $Root
Write-Host ""
Write-Host "導入が終わりました。社員 PC から https://<このサーバーの名前>/ を開いてください。" -ForegroundColor Cyan
if ($Unattended) { Write-Host "パスワードは $secretsDir にあります。管理者がログインしたら画面から変えてください。" }
