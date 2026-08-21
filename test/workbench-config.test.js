import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorkbenchConfigService, resolveStartupEngine } from '../src/main/workbench-config.js'


test('resolves startup engine from workbench config', () => {
  assert.equal(resolveStartupEngine(null), 'kimi')
  assert.equal(resolveStartupEngine({}), 'kimi')
  assert.equal(resolveStartupEngine({ defaultEngine: 'cloudcli' }), 'cloudcli')
  assert.equal(resolveStartupEngine({ defaultEngine: 'bogus' }), 'kimi')
  assert.equal(
    resolveStartupEngine({ defaultEngine: 'cloudcli', rememberEngine: true, lastEngine: 'kimi' }),
    'kimi'
  )
  assert.equal(
    resolveStartupEngine({ defaultEngine: 'cloudcli', rememberEngine: true, lastEngine: 'bogus' }),
    'cloudcli'
  )
})

test('persists config beside the exe when the exe dir is writable', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-workbench-config-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const exeDir = path.join(temp, 'exe')
  const fallbackDir = path.join(temp, 'userData')
  await fs.mkdir(exeDir, { recursive: true })

  const service = new WorkbenchConfigService({ exeDir, fallbackDir })
  const info = await service.initialize()

  assert.equal(info.storage, 'exe')
  assert.equal(info.configPath, path.join(exeDir, 'config', 'workbench-config.json'))
  assert.deepEqual(await service.get(), {})

  await service.save({ defaultEngine: 'kimi', viewerMode: 'auto' })
  const saved = JSON.parse(await fs.readFile(info.configPath, 'utf8'))
  assert.equal(saved.defaultEngine, 'kimi')
  assert.equal(saved.viewerMode, 'auto')

  const reloaded = new WorkbenchConfigService({ exeDir, fallbackDir })
  await reloaded.initialize()
  assert.equal((await reloaded.get()).defaultEngine, 'kimi')
})

test('falls back to userData when the exe dir cannot be written', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-workbench-config-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  const exeDir = path.join(temp, 'readonly-exe')
  const fallbackDir = path.join(temp, 'userData')
  await fs.mkdir(exeDir, { recursive: true })
  // 模拟只读：把 exe 目录设为不可写目录。Windows 上无法可靠 chmod 目录，
  // 这里用一个“exe 目录本身是一个文件”的路径来触发 mkdir 失败。
  const blockingFile = path.join(temp, 'blocked')
  await fs.writeFile(blockingFile, '')
  const blockedExeDir = path.join(blockingFile, 'config')

  const service = new WorkbenchConfigService({ exeDir: path.join(blockingFile), fallbackDir })
  const info = await service.initialize()

  assert.equal(info.storage, 'userData')
  assert.equal(info.configPath, path.join(fallbackDir, 'workbench-config.json'))
})
