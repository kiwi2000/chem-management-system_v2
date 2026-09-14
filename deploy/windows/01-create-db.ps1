# 業務用のデータベースとユーザーを作る（導入手順書 §10 W2）。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\01-create-db.ps1
#
# PostgreSQL 16 をインストールしたあと、一度だけ実行する。管理者権限は要らない。
# パスワードは画面で打つ（引数にも履歴にも残さない）。
#   1. インストール時に決めた postgres のパスワード
#   2. これから作る業務用ユーザー chem のパスワード（.env の DATABASE_URL に書くもの）
#
# **文字コードは UTF-8、照合順序は C** で作る。Windows のインストーラーの既定（日本語ロケール）の
# まま作ると日本語が化けることがある。C にしておくと並び順が機械によって変わらない
# （アプリはコード・CAS 番号の突合を自前で正規化しているので、照合順序に頼っていない）。

[CmdletBinding()]
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$DbName = "chem",
  [string]$DbUser = "chem",
  [string]$PgHost = "127.0.0.1",
  [int]$PgPort = 5432
)

. (Join-Path $PSScriptRoot "_common.ps1")

$psql = Join-Path $PgBin "psql.exe"
if (-not (Test-Path $psql)) { throw "psql.exe が見つかりません: $psql（-PgBin で場所を指定してください）" }

Write-Step "postgres（管理ユーザー）のパスワード"
$adminPw = Read-Host -AsSecureString "postgres のパスワード"
Write-Step "業務用ユーザー $DbUser のパスワード（.env に書くもの。@ と / は使わない）"
$userPw = Read-Host -AsSecureString "$DbUser のパスワード"
$userPwPlain = ConvertTo-Plain $userPw
if ($userPwPlain -match '[@/'']' -or $userPwPlain.Length -lt 12) {
  throw "パスワードは 12 文字以上で、@ / ' を含めないでください"
}

$env:PGPASSWORD = ConvertTo-Plain $adminPw
try {
  $base = @("-h", $PgHost, "-p", $PgPort, "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-tA")

  Write-Step "接続の確認"
  $ver = & $psql @base -c "select version();"
  if ($LASTEXITCODE -ne 0) { throw "postgres として接続できません。パスワードとサービスの起動を確かめてください" }
  Write-Ok $ver

  Write-Step "ユーザー $DbUser"
  $exists = & $psql @base -c "select 1 from pg_roles where rolname = '$DbUser';"
  if ($exists -eq "1") {
    Write-Warn2 "すでにあります。パスワードだけ入れ直します"
    Invoke-Checked $psql ($base + @("-c", "ALTER USER $DbUser WITH PASSWORD '$userPwPlain';")) "ALTER USER"
  } else {
    Invoke-Checked $psql ($base + @("-c", "CREATE USER $DbUser WITH PASSWORD '$userPwPlain';")) "CREATE USER"
    Write-Ok "作りました"
  }

  Write-Step "データベース $DbName（UTF-8 / 照合順序 C）"
  $dbExists = & $psql @base -c "select 1 from pg_database where datname = '$DbName';"
  if ($dbExists -eq "1") {
    Write-Warn2 "すでにあります。作り直しません（中身を消したいときは手で DROP DATABASE してから）"
  } else {
    $sql = "CREATE DATABASE $DbName OWNER $DbUser ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
    Invoke-Checked $psql ($base + @("-c", $sql)) "CREATE DATABASE"
    Write-Ok "作りました"
  }

  Write-Step "確認（文字コードが UTF8 であること）"
  & $psql @base -c "select datname, pg_encoding_to_char(encoding), datcollate from pg_database where datname = '$DbName';"
}
finally {
  $env:PGPASSWORD = $null
  $userPwPlain = $null
}

Write-Host ""
Write-Host "次: C:\chem\.env に次の1行を書きます（.env.windows.example を写す）" -ForegroundColor Cyan
Write-Host "  DATABASE_URL=""postgresql://$DbUser`:<いま決めたパスワード>@$PgHost`:$PgPort/$DbName`?schema=public"""
