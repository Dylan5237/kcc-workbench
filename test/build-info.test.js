import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readBuildSourceCommit } from '../src/main/build-info.js'

const SHA = 'b'.repeat(40)

test('reads sourceCommit from the deterministic adjacent layout', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-build-info-'))
  const exeDir = path.join(dist, 'win-unpacked')
  await fs.mkdir(exeDir, { recursive: true })
  const exe = path.join(exeDir, 'Arckeep.exe')
  await fs.writeFile(exe, 'MZ fake', 'utf8')
  await fs.writeFile(
    path.join(dist, 'build-info.json'),
    JSON.stringify({ sourceBranch: 'develop/kcc-1.0', sourceCommit: SHA }),
    'utf8'
  )
  assert.equal(await readBuildSourceCommit(exe), SHA)
})

test('returns null when no adjacent build-info exists or payload is unusable', async () => {
  const dist = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-build-info-'))
  const exe = path.join(dist, 'win-unpacked', 'Arckeep.exe')
  assert.equal(await readBuildSourceCommit(exe), null)  // 文件不存在

  await fs.mkdir(path.dirname(exe), { recursive: true })
  await fs.writeFile(exe, 'MZ fake', 'utf8')
  await fs.writeFile(path.join(dist, 'build-info.json'), '{broken', 'utf8')
  assert.equal(await readBuildSourceCommit(exe), null)  // 损坏 JSON

  await fs.writeFile(
    path.join(dist, 'build-info.json'),
    JSON.stringify({ sourceCommit: 'not-a-sha' }),
    'utf8'
  )
  assert.equal(await readBuildSourceCommit(exe), null)  // 非 40 位 SHA
})

test('does not roam beyond the adjacent dist directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-build-info-'))
  // build-info.json 放在更上层: 不允许被读到。
  await fs.writeFile(
    path.join(root, 'build-info.json'),
    JSON.stringify({ sourceCommit: SHA }),
    'utf8'
  )
  const exe = path.join(root, 'dist', 'win-unpacked', 'Arckeep.exe')
  await fs.mkdir(path.dirname(exe), { recursive: true })
  await fs.writeFile(exe, 'MZ fake', 'utf8')
  assert.equal(await readBuildSourceCommit(exe), null)
})
