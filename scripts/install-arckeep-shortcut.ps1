# Create/update the Arckeep Start Menu shortcut.
# The shortcut targets a stable build path, so every rebuild is picked up automatically.
# Usage: powershell -NoProfile -File scripts/install-arckeep-shortcut.ps1
$exe = Join-Path $PSScriptRoot '..\arckeep\shell\bin\Release\net7.0-windows\Arckeep.exe'
$exe = [System.IO.Path]::GetFullPath($exe)
$lnkPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Arckeep.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = [System.IO.Path]::GetDirectoryName($exe)
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'Arckeep - long-term work environment'
$lnk.Save()
Write-Output $lnkPath
