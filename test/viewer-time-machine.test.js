import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  createTimeMachine,
  ensureSafeWritePath,
  validateBranchName
} = require('../src/viewer/time-machine.cjs')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  })
}

test('persists Git-aware checkpoints and restores them into an isolated worktree', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-time-machine-'))
  const repo = path.join(tempRoot, 'project')
  const configDir = path.join(tempRoot, 'config')
  await fs.mkdir(repo, { recursive: true })
  git(repo, ['init'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'user.email', 'test@example.com'])
  await fs.writeFile(path.join(repo, 'README.md'), '# Before\n')
  git(repo, ['add', 'README.md'])
  git(repo, ['commit', '-m', 'initial'])

  const machine = createTimeMachine({ configDir, checkpointDelay: 10 })
  t.after(async () => {
    await machine.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })
  await machine.setContext({ id: 'kimi:test', label: '测试任务', root: repo })
  await fs.writeFile(path.join(repo, 'README.md'), '# After\n')
  machine.recordChange({
    artifact: {
      id: 'change-1',
      path: 'README.md',
      name: 'README.md',
      ext: '.md',
      type: 'modified',
      timestamp: Date.now(),
      stats: { added: 1, removed: 1 },
      diff: []
    },
    beforeContent: '# Before\n',
    afterContent: '# After\n'
  })
  const checkpoint = await machine.flush()
  assert.equal(machine.getState().checkpoints.length, 1)
  assert.equal(checkpoint.git.available, true, checkpoint.git.error)

  const target = path.join(tempRoot, 'fork')
  const result = await machine.forkCheckpoint({
    checkpointId: checkpoint.id,
    branchName: 'time-machine/test',
    targetPath: target
  })
  assert.equal(result.target, target)
  assert.equal(
    (await fs.readFile(path.join(target, 'README.md'), 'utf8')).replace(/\r\n/g, '\n'),
    '# After\n'
  )

  const reloaded = createTimeMachine({ configDir })
  await reloaded.setContext({ id: 'kimi:test', label: '测试任务', root: repo })
  assert.equal(reloaded.getState().checkpoints.length, 1)
  await reloaded.close()
})

test('rejects unsafe branch names', () => {
  assert.throws(() => validateBranchName('../escape'), /分支名/)
  assert.throws(() => validateBranchName('-force'), /分支名/)
  assert.equal(validateBranchName('kimi-time/step-1'), 'kimi-time/step-1')
})

test('merges checkpoint changes into a deduplicated artifact list', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-time-artifacts-'))
  const configDir = path.join(tempRoot, 'config')
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }))

  const machine = createTimeMachine({ configDir })
  await machine.setContext({ id: 'kimi:merge', label: '测试任务', root: tempRoot })
  machine.recordChange({
    artifact: {
      id: 'a1', path: 'doc.md', name: 'doc.md', ext: '.md', type: 'created',
      timestamp: 1000, size: 2, stats: { added: 2, removed: 0 },
      diff: [{ type: 'add', text: 'xx' }]
    },
    beforeContent: '',
    afterContent: 'xx'
  })
  machine.recordChange({
    artifact: {
      id: 'a2', path: 'plan.md', name: 'plan.md', ext: '.md', type: 'created',
      timestamp: 2000, size: 3, stats: { added: 3, removed: 0 }, diff: []
    },
    beforeContent: '',
    afterContent: 'yyy'
  })
  machine.recordChange({
    artifact: {
      id: 'a3', path: 'doc.md', name: 'doc.md', ext: '.md', type: 'modified',
      timestamp: 3000, size: 4, stats: { added: 2, removed: 2 }, diff: []
    },
    beforeContent: 'xx',
    afterContent: 'xxxx'
  })
  await machine.flush()

  const changes = machine.getArtifactChanges()
  assert.equal(changes.length, 2)
  const doc = changes.find(change => change.path === 'doc.md')
  // 检查点合并按本轮起始内容推导类型: 从空创建 -> created; id/timestamp 取最新一次变更
  assert.equal(doc.id, 'a3')
  assert.equal(doc.type, 'created')
  assert.equal(doc.timestamp, 3000)
  assert.equal(Object.hasOwn(doc, 'afterContent'), false)
  assert.equal(Object.hasOwn(doc, 'beforeContent'), false)

  // 重启后从磁盘重建列表仍然可用
  const reloaded = createTimeMachine({ configDir })
  await reloaded.setContext({ id: 'kimi:merge', label: '测试任务', root: tempRoot })
  assert.equal(reloaded.getArtifactChanges().length, 2)
  await reloaded.close()
  await machine.close()
})

test('rejects restore paths that traverse a directory link', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-time-link-'))
  const target = path.join(tempRoot, 'target')
  const outside = path.join(tempRoot, 'outside')
  await fs.mkdir(target)
  await fs.mkdir(outside)
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }))

  try {
    await fs.symlink(outside, path.join(target, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (error.code === 'EPERM') return
    throw error
  }
  assert.throws(
    () => ensureSafeWritePath(target, path.join(target, 'linked', 'payload.json')),
    /链接|逃逸/
  )
})
