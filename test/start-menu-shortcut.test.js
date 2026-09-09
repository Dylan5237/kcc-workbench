import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCRIPT = path.resolve(import.meta.dirname, '../scripts/install-start-menu-shortcut.ps1')

async function runScript(args) {
  return execFileAsync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT,
    ...args
  ], { windowsHide: true })
}

async function readShortcut(lnkPath) {
  const command = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}')`,
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "($s.TargetPath, $s.WorkingDirectory, $s.IconLocation, $s.Description) -join [char]10"
  ].join('; ')
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', command], { windowsHide: true })
  const [targetPath, workingDirectory, iconLocation, description] = stdout.trim().split(/\r?\n/)
  return { targetPath, workingDirectory, iconLocation, description }
}

test('shortcut helper creates exact .lnk in a temporary StartMenuRoot', { skip: process.platform !== 'win32' }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-shortcut-test-'))
  const fakeExe = path.join(tempRoot, 'fake-bin', 'Arckeep.exe')
  const startMenuRoot = path.join(tempRoot, 'startmenu')
  await fs.mkdir(path.dirname(fakeExe), { recursive: true })
  await fs.writeFile(fakeExe, 'MZ fake', 'utf8')

  const { stdout } = await runScript(['-ExecutablePath', fakeExe, '-StartMenuRoot', startMenuRoot])
  const lnkPath = path.join(startMenuRoot, 'Arckeep.lnk')
  await fs.stat(lnkPath)
  assert.match(stdout, /Arckeep\.lnk/)

  const link = await readShortcut(lnkPath)
  assert.equal(link.targetPath, fakeExe)
  assert.equal(link.workingDirectory, path.dirname(fakeExe))
  assert.equal(link.iconLocation, `${fakeExe},0`)
  assert.equal(link.description, 'Arckeep')

  // 更新路径: 同一 .lnk 被原地更新, 不产生第二个文件。
  const otherExe = path.join(tempRoot, 'other-bin', 'Arckeep.exe')
  await fs.mkdir(path.dirname(otherExe), { recursive: true })
  await fs.writeFile(otherExe, 'MZ fake2', 'utf8')
  await runScript(['-ExecutablePath', otherExe, '-StartMenuRoot', startMenuRoot])
  const updated = await readShortcut(lnkPath)
  assert.equal(updated.targetPath, otherExe)
  assert.deepEqual(await fs.readdir(startMenuRoot), ['Arckeep.lnk'])
})

test('shortcut helper supports a custom name and fails for a missing executable', { skip: process.platform !== 'win32' }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-shortcut-test-'))
  const fakeExe = path.join(tempRoot, 'Arckeep.exe')
  await fs.writeFile(fakeExe, 'MZ fake', 'utf8')
  await runScript([
    '-ExecutablePath', fakeExe,
    '-ShortcutName', 'Arckeep Dev',
    '-StartMenuRoot', tempRoot
  ])
  await fs.stat(path.join(tempRoot, 'Arckeep Dev.lnk'))

  await assert.rejects(
    () => runScript([
      '-ExecutablePath', path.join(tempRoot, 'missing.exe'),
      '-StartMenuRoot', tempRoot
    ]),
    /executable does not exist/
  )
})
