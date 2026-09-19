# このリポジトリの控えを Google ドライブ（H:）へ置く。
#
# 作業の実体は C: のまま。ドライブには控えだけを置く。
#   履歴  … git bundle 1ファイル（25MB ほど・完全な履歴が入る）
#   ファイル … robocopy のミラー（git に入っていない .env / docs をここで拾う）
#
# **ドライブのフォルダを作業場所にしない。**Google ドライブはフォルダ単位の除外を持たないので
# node_modules（2.7GB・約4万ファイル）まで同期対象になり、workspace の symlink は絶対パスなので
# 移すと壊れる。2026-09-19 に検討して見送った。
#
# タスクスケジューラへの登録（毎日12時・本人の権限で。ドライブは本人にしか見えない）:
#   schtasks /Create /TN "chem-backup-to-drive" /SC DAILY /ST 12:00 ^
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\moris\Documents\dev\chem-management-system_v2\scripts\backup-to-drive.ps1"
#
# 戻しかた:
#   git clone "<Dest>\chem-v2.bundle" chem-management-system_v2
#   cd chem-management-system_v2
#   git remote set-url origin https://github.com/kiwi2000/chem-management-system_v2.git
#   （<Dest>\files から .env などを戻して）npm ci; npx prisma generate
#   bundle には origin のURL・stash・.git/hooks が入らないので、そこは手当てする
[CmdletBinding()]
param(
  [string]$Dest = "H:\マイドライブ\dev\_backup\chem-management-system_v2",
  # 購入した LOLI のデータフィード（scripts\data・219MB）も控える。
  # 中身は変わらないので、普段は付けない
  [switch]$WithData
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$drive = Split-Path -Qualifier $Dest
if (-not (Test-Path "$drive\")) {
  throw "$drive が見えません。Google ドライブが動いているか確かめてください"
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# ── 1. 履歴 ──────────────────────────────────────────────
# C: の一時領域で作って、中身を確かめてから置き換える。
# ドライブへ直接書くと、書きかけを同期に拾われる
$tmp = Join-Path $env:TEMP "chem-v2.bundle"
Push-Location $repo
try {
  & git bundle create $tmp --all
  if ($LASTEXITCODE -ne 0) { throw "git bundle create が失敗しました（終了コード $LASTEXITCODE）" }
  $verify = & git bundle verify $tmp
  if ($LASTEXITCODE -ne 0) { throw "できた bundle が壊れています" }
  if (-not ($verify -match "complete history")) {
    throw "bundle に履歴が全部入っていません: $verify"
  }
} finally {
  Pop-Location
}
Copy-Item $tmp (Join-Path $Dest "chem-v2.bundle") -Force
Remove-Item $tmp -Force
$bundleMB = [math]::Round((Get-Item (Join-Path $Dest "chem-v2.bundle")).Length / 1MB, 1)

# ── 2. ファイル ──────────────────────────────────────────
# 重いものは外す。node_modules は npm ci、.next はビルド、out は組み直しで戻る。
# .cache（1.3GB）と data / scripts\data（購入データ）は別扱い。
#
# **out と data は絶対パスで外す。**名前で書くと深さを問わず一致してしまい、
# `docs\out`（できあがったPDF・docx 15MB）や `apps\web\data`（追跡している
# ip-country.bin）まで落ちる。node_modules と .next は各所にあるので名前で外す
$files = Join-Path $Dest "files"
$excludeDirs = @(
  "node_modules", ".next", ".git", ".turbo",
  (Join-Path $repo "out"),
  (Join-Path $repo ".cache"),
  (Join-Path $repo "data"),
  (Join-Path $repo "scripts\data")
)
& robocopy $repo $files /MIR /XD @excludeDirs /XF *.tsbuildinfo *.log /R:1 /W:1 /NP /NFL /NDL
# robocopy は 0〜7 が正常（8以上が失敗）。何もコピーしなかった 0 も正常
if ($LASTEXITCODE -ge 8) { throw "robocopy が失敗しました（終了コード $LASTEXITCODE）" }

# ── 3. 購入データ（任意）────────────────────────────────
if ($WithData) {
  & robocopy (Join-Path $repo "scripts\data") (Join-Path $Dest "scripts-data") /MIR /R:1 /W:1 /NP /NFL /NDL
  if ($LASTEXITCODE -ge 8) { throw "robocopy（scripts\data）が失敗しました（終了コード $LASTEXITCODE）" }
}

$filesMB = [math]::Round(((Get-ChildItem $files -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
$count = (Get-ChildItem $files -Recurse -File).Count
Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  backup done: $Dest"
Write-Output "  chem-v2.bundle  $bundleMB MB"
Write-Output "  files           $count files / $filesMB MB"
