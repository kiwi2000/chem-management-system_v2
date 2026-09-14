# アプリを組み立てて、データベースの表を用意する（導入手順書 §10 W4）。10〜20 分かかる。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\02-build.ps1
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\02-build.ps1 -DumpFile C:\chem\chem_v2.dump
#
# 先に C:\chem\.env（DATABASE_URL）を作っておく。管理者権限は要らない。
# 更新のときも同じ（先に nssm stop chem-app で止める。動かしたまま組み直すと壊れる）。
#
# -DumpFile を渡すと、別の機械で取った pg_dump -Fc のファイルを **空の** データベースに流し込む。
# 流し込みは `prisma migrate deploy` より **先**（先に表を作ってから流し込むと二重になる）。
#
# やること:
#   1. Node.js の版と、NODE_ENV が立っていないことの確認（立っていると開発用の部品が入らず build が落ちる）
#   2. npm ci                 部品をそろえる（インターネットが要る）
#   3. npx prisma generate    データベース用の部品を作る
#   4. npm run build          画面を組み立てる
#   5. pg_restore             -DumpFile のときだけ
#   6. npx prisma migrate deploy   表を作る／足りない変更を足す（流し込んだ後なら「適用なし」で終わる）
#   7. 利用者の一覧を出して、繋がっていることを確かめる

[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$DumpFile = "",
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin"
)

. (Join-Path $PSScriptRoot "_common.ps1")
if (-not $Root) { $Root = $script:ChemRoot }
Set-Location $Root

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm が見つかりません。Node.js 22 LTS を入れて、PowerShell を開き直してください" }
$npx = Join-Path (Split-Path -Parent $npm) "npx.cmd"

Write-Step "環境の確認（$Root）"
$nodeVer = & node -v
Write-Ok "node $nodeVer / npm $(& $npm -v)"
if ($nodeVer -notmatch '^v(2[2-9]|[3-9]\d)\.') { Write-Warn2 "Node.js は 22 以上を想定しています" }
if ($env:NODE_ENV) {
  throw "NODE_ENV=$($env:NODE_ENV) が設定されています。組み立ての間は外してください（`$env:NODE_ENV = `$null）。サービスにだけ付けます"
}
$envFile = Join-Path $Root ".env"
$db = Read-DatabaseUrl $envFile
Write-Ok ".env: $($db.User)@$($db.Host):$($db.Port)/$($db.Database)"
if ($db.Host -ne "127.0.0.1") { Write-Warn2 "ホストは 127.0.0.1 を勧めます（localhost は IPv6 に解決されて繋がらないことがある）" }
if ($DumpFile -and -not (Test-Path $DumpFile)) { throw "ダンプが見つかりません: $DumpFile" }

Write-Step "npm ci（部品をそろえる。数分）"
Invoke-Checked $npm @("ci", "--no-audit", "--no-fund") "npm ci"

Write-Step "prisma generate"
Invoke-Checked $npx @("prisma", "generate") "prisma generate"

Write-Step "npm run build（画面の組み立て。5〜15 分）"
Invoke-Checked $npm @("run", "build") "npm run build"

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

Write-Step "prisma migrate deploy（表を作る／足りない変更を足す）"
Invoke-Checked $npx @("prisma", "migrate", "deploy") "prisma migrate deploy"

Write-Step "利用者の一覧（繋がっていることの確認）"
& $npx tsx scripts/set-password.ts --list
if ($LASTEXITCODE -ne 0) { throw "set-password.ts --list が失敗しました" }

Write-Host ""
Write-Host "組み立て完了。次は 03-install-services.ps1（管理者で）" -ForegroundColor Cyan
