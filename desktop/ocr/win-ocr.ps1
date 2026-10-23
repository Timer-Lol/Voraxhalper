# Vorax Helper: reads the cards' names with Windows' own text reader (Windows.Media.Ocr), as tli-warden reads its
# text: built into Windows, and much faster than the page's Tesseract. Started once by the app and kept running.
#
# In:  one request per line: "<id> <width> <height> <base64 of width*height grey bytes, one per pixel>"
# Out: first "ready <language>" (or "fail <reason>" and exit), then one line per request: "<id> <JSON string>" with
#      the text read (lines joined by \n), or "<id> !<error>".
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $recognize = $asTask.MakeGenericMethod([Windows.Media.Ocr.OcrResult])
  $engine = $null
  $english = [Windows.Globalization.Language]::new('en-US')
  if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($english)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english) }
  if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $engine) { [Console]::Out.WriteLine('fail no Windows OCR language is installed'); exit 1 }
  $gray8 = [Windows.Graphics.Imaging.BitmapPixelFormat]::Gray8
  $bgra8 = [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8
  [Console]::Out.WriteLine('ready ' + $engine.RecognizerLanguage.LanguageTag)
} catch {
  [Console]::Out.WriteLine('fail ' + ($_.Exception.Message -replace '\s+', ' '))
  exit 1
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Split(' ')
  if ($parts.Count -lt 4) { continue }
  $id = $parts[0]
  try {
    $w = [int]$parts[1]
    $h = [int]$parts[2]
    $bytes = [Convert]::FromBase64String($parts[3])
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)
    $grey = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer($buffer, $gray8, $w, $h)
    $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($grey, $bgra8)
    $task = $recognize.Invoke($null, @($engine.RecognizeAsync($bitmap)))
    if (-not $task.Wait(5000)) { throw 'no answer in 5 s' }
    $text = (@($task.Result.Lines) | ForEach-Object { $_.Text }) -join "`n"
    [Console]::Out.WriteLine($id + ' ' + (ConvertTo-Json -Compress -InputObject ([string]$text)))
  } catch {
    [Console]::Out.WriteLine($id + ' !' + ($_.Exception.Message -replace '\s+', ' '))
  }
}
