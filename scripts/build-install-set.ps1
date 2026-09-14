# Windows Server 用のインストールセットを作る（お客さんへ渡すもの。更新のときも同じものを渡す）。
# この開発 PC（Windows）で実行する。
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-install-set.ps1            版は package.json の version
#   powershell -ExecutionPolicy Bypass -File scripts\build-install-set.ps1 -Version 1.0.0
#
# できるもの: out\chem-install-set-<版>-win64.zip（展開すると同名のフォルダ）
#   app\          組み立て済みのアプリ（ソース＋node_modules＋.next＋prisma）。お客さん側で npm は使わない
#   installers\   Node.js / PostgreSQL / Caddy / NSSM の公式インストーラー（インターネットが無くても入る）
#   scripts\      install.ps1（初回）・update.ps1（更新）と、その部品
#   手順書.html    社内サーバー導入手順書
#   README.txt    最初に読むもの
#   SHA256SUMS.txt
#
# **コミット済みのものだけが入る**（git archive）。作業ツリーの直しかけは入らない。
# **入れないもの**: docs/（この手順書を除く）、scripts/data/ と投入スクリプト（LOLI・CHRIP 由来。契約上渡せない）、.env。
# インストーラーは out\installers-cache\ に一度だけ落として使い回す。

[CmdletBinding()]
param(
  [string]$Version = "",
  # 組み立て済みの app\ をそのまま使い、インストーラー・手順書・zip だけ作り直す（手順書を直したときなど）
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not $Version) { $Version = (Get-Content package.json -Raw | ConvertFrom-Json).version }
$commit = (& git rev-parse --short HEAD).Trim()
$name = "chem-install-set-$Version-win64"
$out = Join-Path $repo "out"
$stage = Join-Path $out "install-set\$name"
$cache = Join-Path $out "installers-cache"
$tar = Join-Path $env:SystemRoot "System32\tar.exe"

function Step([string]$t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }

# 配布物に入れるもの。package-release.sh の INCLUDE と同じ＋判定し直し
$include = @(
  "NOTICE", "package.json", "package-lock.json", "tsconfig.base.json", ".dockerignore",
  ".env.prod.example", ".env.windows.example", "Dockerfile", "compose.prod.yml",
  "deploy", "apps", "packages", "prisma",
  "scripts/backup-db.sh", "scripts/backup-db.ps1", "scripts/set-password.ts",
  "scripts/grant-permission.ts", "scripts/rejudge.ts"
)
$dirty = & git status --porcelain -- @include
if ($dirty) {
  Write-Host "注意: 配布物に入るファイルに、コミットしていない変更があります（入りません）" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "  $_" }
}

Step "準備（$stage）"
if ($SkipBuild -and -not (Test-Path (Join-Path $stage "app\manifest.json"))) { throw "-SkipBuild ですが組み立て済みの app がありません" }
if (Test-Path $stage) {
  Get-ChildItem $stage | Where-Object { -not ($SkipBuild -and $_.Name -eq "app") } | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage "app"), (Join-Path $stage "installers"), (Join-Path $stage "scripts"), $cache | Out-Null

if ($SkipBuild) {
  $manifest = Get-Content (Join-Path $stage "app\manifest.json") -Raw | ConvertFrom-Json
  Write-Host "    組み立て済みを使います: 版 $($manifest.version) / $($manifest.commit)"
} else {
Step "ソースを取り出す（git archive $commit）"
$archive = Join-Path $out "install-set\app-src.tar"
& git archive --format=tar -o $archive HEAD -- @include
if ($LASTEXITCODE -ne 0) { throw "git archive が失敗しました" }
& $tar -xf $archive -C (Join-Path $stage "app")
if ($LASTEXITCODE -ne 0) { throw "tar -x が失敗しました" }
Remove-Item $archive

Step "組み立て（npm ci → prisma generate → next build。10 分ほど）"
Push-Location (Join-Path $stage "app")
try {
  if ($env:NODE_ENV) { throw "NODE_ENV=$($env:NODE_ENV) が立っています。外してから実行してください" }
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci が失敗しました" }
  & npx prisma generate
  if ($LASTEXITCODE -ne 0) { throw "prisma generate が失敗しました" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build が失敗しました" }
  # build の作業用キャッシュは要らない（大きい）
  $nextCache = "apps\web\.next\cache"
  if (Test-Path $nextCache) { Remove-Item $nextCache -Recurse -Force }
  $lastMigration = (Get-ChildItem "prisma\migrations" -Directory | Sort-Object Name | Select-Object -Last 1).Name
  $manifest = [ordered]@{
    name          = "chem-management-system"
    version       = $Version
    commit        = $commit
    lastMigration = $lastMigration
    platform      = "win32-x64"
    node          = (& node -v).Trim()
    builtAt       = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
  }
  [IO.File]::WriteAllText((Join-Path (Get-Location) "manifest.json"), ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  Write-Host "    manifest: 版 $Version / $commit / 表の最終変更 $lastMigration"
}
finally { Pop-Location }
}

Step "インストーラー（無ければ公式サイトから out\installers-cache に落とす）"
$installers = @(
  @{ File = "node-v22.23.2-x64.msi"; Url = "https://nodejs.org/dist/v22.23.2/node-v22.23.2-x64.msi" },
  @{ File = "vc_redist.x64.exe"; Url = "https://aka.ms/vs/17/release/vc_redist.x64.exe" },
  @{ File = "postgresql-16.10-1-windows-x64-binaries.zip"; Url = "https://get.enterprisedb.com/postgresql/postgresql-16.10-1-windows-x64-binaries.zip" },
  @{ File = "caddy_2.11.4_windows_amd64.zip"; Url = "https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_windows_amd64.zip" },
  @{ File = "nssm-2.24.zip"; Url = "https://nssm.cc/release/nssm-2.24.zip" }
)
foreach ($i in $installers) {
  $f = Join-Path $cache $i.File
  if (-not (Test-Path $f)) {
    Write-Host "    落としています: $($i.Url)"
    & curl.exe -fL --retry 3 -o $f $i.Url
    if ($LASTEXITCODE -ne 0) { throw "ダウンロードが失敗しました: $($i.Url)" }
  }
  Copy-Item $f (Join-Path $stage "installers\$($i.File)")
  Write-Host "    $($i.File)  $([math]::Round((Get-Item $f).Length / 1MB, 1)) MB"
}

Step "手順書とスクリプト"
Copy-Item (Join-Path $repo "deploy\windows\*.ps1") (Join-Path $stage "scripts")
Copy-Item (Join-Path $repo "docs\社内サーバー導入手順書.html") (Join-Path $stage "手順書.html")
$readme = @"
ケミカルコンプライアンス支援システム  インストールセット（Windows Server 用）
版 $Version（$commit）  組み立て $($manifest.builtAt)

1. 手順書.html を開き、「10. Windows Server への導入」を読んでください。
2. このフォルダを C:\chem-install に置き、管理者の PowerShell で
     powershell -ExecutionPolicy Bypass -File C:\chem-install\scripts\install.ps1 -LanCidr <社内LAN> -AdminEmail <管理者のメール>
   を実行します（初回）。更新のときは scripts\update.ps1 です。
3. インターネットは要りません。必要なものは installers\ に入っています。

app\         組み立て済みのアプリ（触らないでください）
installers\  Node.js / PostgreSQL / Caddy / NSSM
scripts\     install.ps1（初回）/ update.ps1（更新）/ check.ps1（状態の確認）
SHA256SUMS.txt  ファイルの照合用
"@
[IO.File]::WriteAllText((Join-Path $stage "README.txt"), $readme, (New-Object Text.UTF8Encoding $true))

Step "SHA256SUMS.txt"
# app\ の中（数万ファイル。深い path は Get-FileHash が読めない）は数えない。
# app 全体は zip の SHA256（最後に出す）で照らし合わせる
$targets = @(Get-ChildItem $stage -File | Where-Object { $_.Name -ne "SHA256SUMS.txt" }) +
  @(Get-ChildItem (Join-Path $stage "installers"), (Join-Path $stage "scripts") -File) +
  @(Get-Item (Join-Path $stage "app\manifest.json"))
$sums = foreach ($f in $targets) {
  $rel = $f.FullName.Substring($stage.Length + 1).Replace("\", "/")
  "$((Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower())  $rel"
}
[IO.File]::WriteAllLines((Join-Path $stage "SHA256SUMS.txt"), [string[]]$sums, (New-Object Text.UTF8Encoding $false))
Write-Host "    $($sums.Count) ファイル"

Step "zip にまとめる（数分）"
$zip = Join-Path $out "$name.zip"
if (Test-Path $zip) { Remove-Item $zip }
& $tar -a -cf $zip -C (Join-Path $out "install-set") $name
if ($LASTEXITCODE -ne 0) { throw "zip の作成が失敗しました" }
$zipHash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$zip.sha256", "$zipHash  $name.zip`n", (New-Object Text.UTF8Encoding $false))
Write-Host ""
Write-Host "作りました: $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)" -ForegroundColor Green
Write-Host "SHA256: $zipHash（$zip.sha256 にも書きました）"
