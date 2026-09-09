#requires -Version 5.1
<#
.SYNOPSIS
  Create/update the current user's Start Menu shortcut for Arckeep (K1-D0, issue #34).

.DESCRIPTION
  Writes exactly one file: <StartMenuRoot>\<ShortcutName>.lnk, pointing at the
  given Arckeep.exe. Current-user scope only (default StartMenuRoot is the user's
  own Start Menu Programs folder); no admin rights, no machine-wide locations,
  no registry changes, no other shortcuts are touched, no installer/updater.

  PR-time safety: machine-test with -StartMenuRoot <TEMP> and a disposable
  executable target. The real user Start Menu must only be pointed at the
  stable deterministic packaging worktree after merge (post-merge activation).

.EXAMPLE
  powershell -NoProfile -File scripts/install-start-menu-shortcut.ps1 `
    -ExecutablePath 'D:\...\dist-fast\win-unpacked\Arckeep.exe'
.EXAMPLE
  powershell -NoProfile -File scripts/install-start-menu-shortcut.ps1 `
    -ExecutablePath "$env:TEMP\fake\Arckeep.exe" -StartMenuRoot "$env:TEMP\startmenu"
#>
[CmdletBinding()]
param(
  # Explicit Arckeep.exe path. Must exist.
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,

  # Shortcut file name (without .lnk). Default: Arckeep.
  [string]$ShortcutName = 'Arckeep',

  # Test seam. Production default: current user's Start Menu\Programs.
  [string]$StartMenuRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "executable does not exist: $ExecutablePath"
}
$resolvedExe = [IO.Path]::GetFullPath($ExecutablePath)
$exeDir = Split-Path -Parent $resolvedExe

if ([string]::IsNullOrWhiteSpace($ShortcutName) -or $ShortcutName -match '[\\/:*?"<>|]') {
  throw "invalid shortcut name: $ShortcutName"
}

if (-not $StartMenuRoot) {
  $StartMenuRoot = [Environment]::GetFolderPath('StartMenu') + '\Programs'
}
$resolvedRoot = [IO.Path]::GetFullPath($StartMenuRoot)
$machinePrograms = [IO.Path]::GetFullPath(
  [Environment]::GetFolderPath('CommonStartMenu') + '\Programs'
)
if ($resolvedRoot.TrimEnd('\').Equals($machinePrograms.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'refusing to write the machine-wide Start Menu; use the current-user Start Menu or a test -StartMenuRoot'
}
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null
}

$shortcutPath = Join-Path $resolvedRoot "$ShortcutName.lnk"
$wsh = New-Object -ComObject WScript.Shell
try {
  $shortcut = $wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $resolvedExe
  $shortcut.WorkingDirectory = $exeDir
  $shortcut.IconLocation = "$resolvedExe,0"
  $shortcut.Description = 'Arckeep'
  $shortcut.Save()
} finally {
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wsh)
}

Write-Host "shortcut : $shortcutPath"
Write-Host "target   : $resolvedExe"
Write-Host "workdir  : $exeDir"
