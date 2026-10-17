# Claude アプリの内蔵ブラウザでファイルを開いたときに出る「名前を付けて保存」の画面を見張り、
# ファイル名が決まった形のときだけ自動で「保存」を押す。
# 元は voice_type プロジェクトの auto-save-gemini.ps1（2026-10-17 に教わり、このプロジェクト向けに直した）。
#
# 使い方（PowerShell ツールで run_in_background: true を付けて動かす）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\auto-save-download.ps1 -Minutes 60 `
#       -NamePattern '\.(pdf|zip|xlsx)$' -SaveDir 'C:\Users\moris\Documents\dev\chem-management-system_v2\docs\GHS分類の原典\国連GHS文書'
#
# -Minutes      何分見張るか（既定 60）。過ぎると自分で止まる。止めるときは TaskStop
# -NamePattern  自動で保存するファイル名の形（正規表現）。合わないものには触らない
# -SaveDir      保存先。指定すると、ファイル名の欄に「保存先\ファイル名」を入れてから押す（画面に最初から出ている場所でなく、ここに保存される）。
#               省くと、画面に出ている場所（ふだんは Downloads）にそのまま保存する
#
# 仕組み: 保存の画面は Claude の窓（claude という名前のプログラム）の子として出る。UI オートメーションで探し、
# ファイル名の欄（AutomationId 1001）の文字で判定する。この画面の部品は「押す」「値を書く」の口を出さないので、
# 文字は WM_SETTEXT、ボタンは BM_CLICK の Win32 メッセージで操作する。
# 決まり: Claude の窓以外には触らない。上書きの確認が出たときは押さない（人が選ぶ）。
param(
    [int]$Minutes = 60,
    [string]$NamePattern = '\.(pdf|zip|xlsx|xls|csv|tsv|docx)$',
    [string]$SaveDir = ''
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W32 {
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$BM_CLICK = 0x00F5
$WM_SETTEXT = 0x000C

function Cond($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }

if ($SaveDir -ne '' -and -not (Test-Path -LiteralPath $SaveDir)) {
    New-Item -ItemType Directory -Force -Path $SaveDir | Out-Null
}

$handled = @{}
$until = (Get-Date).AddMinutes($Minutes)
Write-Host "見張りを始めました（$Minutes 分まで）。対象: $NamePattern 保存先: $(if ($SaveDir) { $SaveDir } else { '画面に出ている場所' })"

while ((Get-Date) -lt $until) {
    try {
        $ids = @(Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
        $tops = $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($top in $tops) {
            if ($ids -notcontains $top.Current.ProcessId) { continue }
            $dialogs = $top.FindAll($TS::Children, (Cond $AE::ClassNameProperty '#32770'))
            foreach ($dlg in $dialogs) {
                # ファイル名の欄（AutomationId 1001、種類は Edit）。欄の文字は Name に出る
                $edits = $dlg.FindAll($TS::Descendants, (Cond $AE::AutomationIdProperty '1001'))
                $edit = $edits | Where-Object { $_.Current.ClassName -eq 'Edit' } | Select-Object -First 1
                if (-not $edit) { continue }
                $name = $edit.Current.Name
                $key = "$($dlg.Current.NativeWindowHandle)|$name"
                if ($handled.ContainsKey($key)) { continue }
                $handled[$key] = $true
                if ($name -notmatch $NamePattern) {
                    Write-Host "$(Get-Date -Format HH:mm:ss) 対象外のため触りません: $name"
                    continue
                }
                if ($SaveDir -ne '') {
                    $full = Join-Path $SaveDir $name
                    if (Test-Path -LiteralPath $full) {
                        Write-Host "$(Get-Date -Format HH:mm:ss) 同じ名前のファイルが既にあるので押しません: $full"
                        continue
                    }
                    [W32]::SendMessage([IntPtr]$edit.Current.NativeWindowHandle, $WM_SETTEXT, [IntPtr]::Zero, $full) | Out-Null
                    Start-Sleep -Milliseconds 200
                }
                # 「保存」ボタン（AutomationId 1、種類は Button）
                $btns = $dlg.FindAll($TS::Descendants, (Cond $AE::AutomationIdProperty '1'))
                $btn = $btns | Where-Object { $_.Current.ClassName -eq 'Button' } | Select-Object -First 1
                if (-not $btn) { Write-Host "保存ボタンが見つかりません: $name"; continue }
                [W32]::SendMessage([IntPtr]$btn.Current.NativeWindowHandle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
                Write-Host "$(Get-Date -Format HH:mm:ss) 保存を押しました: $name"
            }
        }
    } catch {
        # 画面が途中で閉じたときなどは、次の回でやり直す
    }
    Start-Sleep -Milliseconds 400
}
Write-Host '時間になったので止めました。'
