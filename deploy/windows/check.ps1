# いまの状態をまとめて出す。困ったときはこの出力を貼って相談する。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\check.ps1
#
# 管理者権限は要らない。何も変えない。
# 見るもの: 部品の版、.env の有無、サービスの状態、アプリ直（3001）と入口（443）の応答、記録の末尾、空き容量。

[CmdletBinding()]
param(
  [string]$Root = "",
  [string]$PostgresService = "postgresql-x64-16",
  [int]$LogLines = 20
)

. (Join-Path $PSScriptRoot "_common.ps1")
$ErrorActionPreference = "Continue"
if (-not $Root) { $Root = $script:ChemRoot }

Write-Step "部品"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($node) { Write-Ok "node $(& node -v)  ($node)" } else { Write-Warn2 "node が見つかりません" }
foreach ($f in @("caddy\caddy.exe", "nssm\nssm.exe", "apps\web\.next\BUILD_ID", "deploy\Caddyfile.windows")) {
  $p = Join-Path $Root $f
  if (Test-Path $p) { Write-Ok $f } else { Write-Warn2 "$f がありません" }
}
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  try { $db = Read-DatabaseUrl $envFile; Write-Ok ".env: $($db.User)@$($db.Host):$($db.Port)/$($db.Database)" }
  catch { Write-Warn2 ".env: $($_.Exception.Message)" }
} else { Write-Warn2 ".env がありません" }

Write-Step "サービス"
Get-Service chem-app, chem-caddy, $PostgresService -ErrorAction SilentlyContinue |
  Select-Object Name, Status, StartType | Format-Table -AutoSize

Write-Step "応答"
function Probe([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
    Write-Ok "$Url → $($res.StatusCode) $($res.Content)"
  } catch {
    Write-Warn2 "$Url → $($_.Exception.Message)"
  }
}
Probe "http://127.0.0.1:3001/api/health"
# 入口は内部 CA の証明書なので、ここでは証明書の検証を外して応答だけ見る。
# Windows PowerShell 5.1 では ScriptBlock のコールバックが別スレッドで動かず「送信時に予期しないエラー」になるので、.NET の型で作る
if (-not ("ChemTrustAll" -as [type])) {
  Add-Type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class ChemTrustAll : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate cert, WebRequest req, int problem) { return true; }
}
"@
}
$savedPolicy = [Net.ServicePointManager]::CertificatePolicy
[Net.ServicePointManager]::CertificatePolicy = New-Object ChemTrustAll
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
Probe "https://127.0.0.1/api/health"
[Net.ServicePointManager]::CertificatePolicy = $savedPolicy

Write-Step "記録の末尾（$LogLines 行）"
foreach ($n in @("chem-app", "chem-caddy")) {
  $log = Join-Path $Root "logs\$n.log"
  Write-Host "--- $log"
  if (Test-Path $log) { Get-Content $log -Tail $LogLines } else { Write-Warn2 "まだありません" }
}

Write-Step "空き容量"
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -eq $Root.Substring(0, 1) } |
  Select-Object Name, @{n = "FreeGB"; e = { [math]::Round($_.Free / 1GB, 1) } } | Format-Table -AutoSize

# Caddy の保存場所は 03-install-services.ps1 が C:\ProgramData\caddy に固定している（サービスの既定は systemprofile の下で分かりにくい）
$root = Join-Path $env:ProgramData "caddy\pki\authorities\local\root.crt"
if (Test-Path $root) {
  Write-Host "内部 CA のルート証明書: $root（社員 PC の「信頼されたルート証明機関」に入れると警告が消えます）"
}
