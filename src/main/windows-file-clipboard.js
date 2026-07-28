import path from 'node:path'
import { execFile } from 'node:child_process'

export async function copyPathsToWindowsClipboard(paths) {
  if (process.platform !== 'win32') {
    throw new Error('文件剪贴板目前仅支持 Windows')
  }
  const normalizedPaths = paths.map(value => path.resolve(value))
  const script = buildWindowsFileClipboardScript(normalizedPaths)
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')
  const powershellPath = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

  await new Promise((resolve, reject) => {
    execFile(
      powershellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-EncodedCommand',
        encodedCommand
      ],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        const detail = String(stderr || error.message).trim()
        reject(new Error(`写入 Windows 文件剪贴板失败：${detail}`))
      }
    )
  })
}

export function buildWindowsFileClipboardScript(paths) {
  const payload = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$paths = @(ConvertFrom-Json -InputObject $json)
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($filePath in $paths) {
  [void]$files.Add([string]$filePath)
}
$data = New-Object System.Windows.Forms.DataObject
$data.SetFileDropList($files)
$effect = New-Object System.IO.MemoryStream
$effect.Write([byte[]](1, 0, 0, 0), 0, 4)
$effect.Position = 0
$data.SetData('Preferred DropEffect', $false, $effect)
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
`.trim()
}
