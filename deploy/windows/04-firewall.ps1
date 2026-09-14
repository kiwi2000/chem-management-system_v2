# 通信の入口を社内 LAN からの HTTPS だけに絞る（導入手順書 §10 W7）。
#
#   powershell -ExecutionPolicy Bypass -File C:\chem\deploy\windows\04-firewall.ps1 -LanCidr 192.168.1.0/24
#
# 管理者で実行する。何度実行しても同じ結果になる（同じ名前の規則は作り直す）。
# 開けるのは 443（HTTPS）と 80（https へ転送するだけ）。データベース（5432）と
# アプリ直（3001）は開けない。最後に、その 2 つが本当に閉じているかを表示する。

#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LanCidr
)

. (Join-Path $PSScriptRoot "_common.ps1")

Write-Step "受信の規則（$LanCidr から 443 / 80）"
$rules = @(
  @{ Name = "chem HTTPS"; Port = 443 },
  @{ Name = "chem HTTP (redirect)"; Port = 80 }
)
foreach ($r in $rules) {
  Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port `
    -RemoteAddress $LanCidr -Action Allow -Profile Any | Out-Null
  Write-Ok "$($r.Name)（TCP $($r.Port)）"
}

Write-Step "閉じているべき口（5432・3001）の確認"
$open = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow |
  Get-NetFirewallPortFilter |
  Where-Object { $_.Protocol -eq "TCP" -and ($_.LocalPort -contains "5432" -or $_.LocalPort -contains "3001") }
if ($open) {
  Write-Warn2 "5432 か 3001 を開けている規則があります。要らなければ無効にしてください:"
  $open | ForEach-Object { Get-NetFirewallRule -AssociatedNetFirewallPortFilter $_ } |
    Select-Object DisplayName, Profile, Enabled | Format-Table -AutoSize
} else {
  Write-Ok "5432 と 3001 を開けている規則はありません"
}

Write-Host "次: 社員 PC から Test-NetConnection <このサーバー> -Port 443 が True、-Port 5432 が False になること" -ForegroundColor Cyan
