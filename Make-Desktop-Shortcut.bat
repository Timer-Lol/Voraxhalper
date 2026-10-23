@echo off
rem Puts a "Vorax Helper" shortcut on your desktop (and in the Start menu) that starts the helper with one click.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))) { $l = $s.CreateShortcut((Join-Path $dir 'Vorax Helper.lnk')); $l.TargetPath = (Join-Path '%~dp0' 'Start-Vorax-Helper.bat'); $l.WorkingDirectory = '%~dp0'; $l.IconLocation = (Join-Path '%~dp0' 'desktop\build\icon.ico'); $l.WindowStyle = 7; $l.Description = 'Vorax Helper'; $l.Save() }"
echo.
echo  Done: "Vorax Helper" is on your desktop and in the Start menu.
echo  (Keep this folder where it is: the shortcut points here.)
echo.
pause
