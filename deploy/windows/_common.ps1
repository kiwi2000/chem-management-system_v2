# deploy\windows\*.ps1 が共通で使う小さな部品。各スクリプトの先頭で . (dot-source) して読み込む。
#
#   . (Join-Path $PSScriptRoot "_common.ps1")
#
# Windows PowerShell 5.1 で動く書き方にそろえる（`&&` や `?:` は使わない。
# native コマンドに `2>&1` を付けない ― 正常終了でも失敗と判定されることがある）。
# ファイルは UTF-8（BOM 付き）で保存する。BOM が無いと 5.1 が Shift-JIS として読んで壊れる。

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

# 展開先（C:\chem）。このファイルは <展開先>\deploy\windows\ にある
$script:ChemRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Write-Step([string]$Text) {
  Write-Host ""
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
  Write-Host "    OK  $Text" -ForegroundColor Green
}

function Write-Warn2([string]$Text) {
  Write-Host "    !!  $Text" -ForegroundColor Yellow
}

# native コマンドを実行し、終了コードが 0 でなければ止める
function Invoke-Checked([string]$Exe, [string[]]$Arguments, [string]$What) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$What が失敗しました（終了コード $LASTEXITCODE）"
  }
}

# インストール直後は PATH がこの窓に届いていないので、機械の PATH を読み直してから探す
function Update-PathFromMachine {
  $m = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $u = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$m;$u"
}

# node / npm / npx の場所。見つからなければ止める
function Get-NodeCommand([string]$Name) {
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $c) { Update-PathFromMachine; $c = Get-Command $Name -ErrorAction SilentlyContinue }
  if (-not $c) { throw "$Name が見つかりません。Node.js を入れて、PowerShell を開き直してください" }
  return $c.Source
}

# .env の DATABASE_URL をばらす（scripts\backup-db.ps1 と同じ読み方）。
# パスワードに @ と / を含めないこと（この単純な読み方が壊れる）
function Read-DatabaseUrl([string]$EnvFile) {
  if (-not (Test-Path $EnvFile)) { throw ".env が見つかりません: $EnvFile" }
  $line = (Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1).Line
  if (-not $line) { throw ".env に DATABASE_URL がありません: $EnvFile" }
  if ($line -notmatch 'postgresql://([^:]+):([^@]+)@([^:/]+):(\d+)/([^?"\s]+)') {
    throw "DATABASE_URL の形が読めません。postgresql://ユーザー:パスワード@ホスト:ポート/データベース の形にしてください"
  }
  return @{
    User     = $Matches[1]
    Password = $Matches[2]
    Host     = $Matches[3]
    Port     = $Matches[4]
    Database = $Matches[5]
  }
}

# SecureString を平文に戻す（PGPASSWORD に入れる間だけ）
function ConvertTo-Plain([securestring]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# 乱数のパスワード（英数字だけ。@ / ' を含めない）。人が打たない場面（無人導入）で使う
function New-RandomPassword([int]$Length = 24) {
  $chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $bytes = New-Object byte[] $Length
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $sb = New-Object Text.StringBuilder
  foreach ($b in $bytes) { [void]$sb.Append($chars[$b % $chars.Length]) }
  return $sb.ToString()
}

# manifest.json（版・移行の最終名・組み立てた日）を読む。無ければ $null
function Read-Manifest([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  return (Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}
