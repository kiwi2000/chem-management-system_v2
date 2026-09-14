# データベースの表を用意する／足りない変更を足す（導入手順書 §10）。install.ps1 と update.ps1 から呼ばれる。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\02-migrate.ps1
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\02-migrate.ps1 -DumpFile C:\chem\chem.dump
#
# アプリは組み立て済み（node_modules と .next 同梱）で届くので、ここでは npm を使わない。
# 先に C:\chem\.env（DATABASE_URL）があること。管理者権限は要らない。
#
# -DumpFile を渡すと、別の機械で取った pg_dump -Fc のファイルを **空の** データベースに流し込む。
# 流し込みは `prisma migrate deploy` より **先**（先に表を作ってから流し込むと二重になる）。
#
# やること:
#   1. .env の確認
#   2. prisma migrate status   いまの表と、届いた版の差を表示（何が変わるかを先に見る）
#   3. pg_restore              -DumpFile のときだけ
#   4. prisma migrate deploy   表を作る／足りない変更を足す（変わっていなければ何もしない）
#   5. 利用者の一覧を出して、繋がっていることを確かめる

[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$DumpFile = "",
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin"
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $Root) { $Root = $script:ChemRoot }
Set-Location $Root

$npx = Get-NodeCommand "npx.cmd"

Write-Step "環境の確認（$Root）"
Write-Ok "node $(& node -v)"
$envFile = Join-Path $Root ".env"
$db = Read-DatabaseUrl $envFile
Write-Ok ".env: $($db.User)@$($db.Host):$($db.Port)/$($db.Database)"
if ($db.Host -ne "127.0.0.1") { Write-Warn2 "ホストは 127.0.0.1 を勧めます（localhost は IPv6 に解決されて繋がらないことがある）" }
if ($DumpFile -and -not (Test-Path $DumpFile)) { throw "ダンプが見つかりません: $DumpFile" }
if (-not (Test-Path (Join-Path $Root "node_modules\.bin\prisma.cmd"))) { throw "node_modules がありません。組み立て済みのセットを C:\chem に置いてください" }

if ($DumpFile) {
  Write-Step "pg_restore（$DumpFile → $($db.Database)）"
  $pgRestore = Join-Path $PgBin "pg_restore.exe"
  $psql = Join-Path $PgBin "psql.exe"
  if (-not (Test-Path $pgRestore)) { throw "pg_restore.exe が見つかりません: $pgRestore" }
  $env:PGPASSWORD = $db.Password
  try {
    $conn = @("-h", $db.Host, "-p", $db.Port, "-U", $db.User, "-d", $db.Database)
    $n = & $psql @conn -tA -c "select count(*) from pg_tables where schemaname = 'public';"
    if ($LASTEXITCODE -ne 0) { throw "データベースに繋がりません（.env の DATABASE_URL を確かめてください）" }
    if ([int]$n -gt 0) {
      throw "データベースに表が $n 個あります。流し込みは空のデータベースにだけ行います（残す場合は -DumpFile を外す）"
    }
    # 所有者は .env のユーザーにそろえる。持ち込み元の拡張のコメントなどで警告が出ることがあるので、
    # 終了コードではなく、流し込んだ後の表の数で確かめる
    & $pgRestore @conn --no-owner --no-privileges --role=$($db.User) $DumpFile
    if ($LASTEXITCODE -ne 0) { Write-Warn2 "pg_restore が終了コード $LASTEXITCODE を返しました。上の警告を確かめてください" }
    $n = & $psql @conn -tA -c "select count(*) from pg_tables where schemaname = 'public';"
    $m = & $psql @conn -tA -c "select count(*) from _prisma_migrations where finished_at is not null;"
    Write-Ok "表 $n 個、適用済みの移行 $m 件"
  }
  finally { $env:PGPASSWORD = $null }
}

Write-Step "prisma migrate status（表の変更の有無）"
& $npx prisma migrate status
# status は「未適用あり」のとき終了コード 1 を返す。それは次で当てるので止めない

Write-Step "prisma migrate deploy（表を作る／足りない変更を足す）"
Invoke-Checked $npx @("prisma", "migrate", "deploy") "prisma migrate deploy"

Write-Step "利用者の一覧（繋がっていることの確認）"
$env:DATABASE_URL = Get-DatabaseUrlValue $envFile
try {
  & $npx tsx scripts/set-password.ts --list
  if ($LASTEXITCODE -ne 0) { throw "set-password.ts --list が失敗しました" }
} finally { $env:DATABASE_URL = $null }
