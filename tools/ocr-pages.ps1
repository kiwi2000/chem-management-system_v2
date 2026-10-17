# Windows 標準の OCR（Windows.Media.Ocr、日本語）で、フォルダの PNG を 1 枚ずつ文字に起こす（2026-10-17。調査の下請けが作ったものを取り込んだ）。
# 画像のページだけの PDF（スキャンした資料）を読むときに使う。PNG は pymupdf で作る:
#   pymupdf.open(pdf)[n].get_pixmap(dpi=200).save(f"{n+1:04d}.png")
# 使い方: powershell -NoProfile -ExecutionPolicy Bypass -File tools\ocr-pages.ps1 <画像フォルダ> <出力.txt>
# 出力はページごと（=== page N ===。N は PNG の名前の数字）。英語や細かい表は崩れるので、数値は原典で確かめる
param([string]$Dir, [string]$Out)
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null
$lang = New-Object Windows.Globalization.Language "ja"
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
$sb = New-Object System.Text.StringBuilder
Get-ChildItem -Path $Dir -Filter *.png | Sort-Object Name | ForEach-Object {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($_.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $page = [int]($_.BaseName)
  [void]$sb.AppendLine("=== page $page ===")
  foreach ($line in $result.Lines) { [void]$sb.AppendLine($line.Text) }
  $stream.Dispose()
}
[System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
