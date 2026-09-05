import assert from 'node:assert/strict'
import http from 'node:http'
import fsSync from 'node:fs'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { startServer } = require('../src/viewer/server.cjs')

function connectSse(server) {
  const events = []
  const waiters = []
  const request = http.get({
    host: '127.0.0.1',
    port: server.port,
    path: '/api/events',
    headers: { Cookie: `kimi_viewer=${server.bootstrapToken}` }
  }, response => {
    response.setEncoding('utf8')
    let buffer = ''
    response.on('data', chunk => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const dataLine = frame.split('\n').find(line => line.startsWith('data: '))
        if (!dataLine) continue
        let event
        try { event = JSON.parse(dataLine.slice(6)) } catch { continue }
        events.push(event)
        for (const waiter of [...waiters]) {
          if (waiter.predicate(event)) {
            waiters.splice(waiters.indexOf(waiter), 1)
            waiter.resolve(event)
          }
        }
      }
    })
  })
  const close = () => request.destroy()
  const waitFor = (predicate, timeoutMs = 5000) => {
    const existing = events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve }
      waiters.push(waiter)
      setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`SSE 事件等待超时, 已收到: ${JSON.stringify(events.map(e => e.type + ':' + (e.file || e.artifact?.path || '')))}`))
      }, timeoutMs)
    })
  }
  return { events, waitFor, close }
}

async function makeServer(t, { watchFails = false } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-realtime-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  let server
  if (watchFails) {
    const originalWatch = fsSync.watch
    fsSync.watch = () => { throw new Error('forced polling fallback') }
    try {
      server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
    } finally {
      fsSync.watch = originalWatch
    }
  } else {
    server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  }
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })
  return { server, projectDir, tempRoot }
}

test('SSE 实时链路覆盖 md 新建/修改/删除', async t => {
  const { server, projectDir } = await makeServer(t)
  const sse = connectSse(server)
  t.after(sse.close)

  // 新建
  await fs.writeFile(path.join(projectDir, 'note.md'), '# v1\n')
  const createdChange = await sse.waitFor(e => e.type === 'change' && e.file === 'note.md')
  assert.equal(createdChange.kind, 'document')
  const created = await sse.waitFor(e => e.type === 'artifact' && e.artifact.path === 'note.md')
  assert.equal(created.artifact.type, 'created')
  assert.ok(created.artifact.stats.added > 0)

  // 修改
  await fs.writeFile(path.join(projectDir, 'note.md'), '# v1\n\nmore\n')
  const modified = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'note.md' && e.artifact.type === 'modified'
  )
  assert.ok(modified.artifact.stats.added > 0)

  // 删除
  await fs.rm(path.join(projectDir, 'note.md'))
  const deleted = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'note.md' && e.artifact.type === 'deleted'
  )
  assert.ok(deleted.artifact.stats.removed > 0)
})

test('dev 模式代码文件变更产生实时 change 事件', async t => {
  const { server, projectDir } = await makeServer(t)
  const sse = connectSse(server)
  t.after(sse.close)

  await fs.writeFile(path.join(projectDir, 'app.ts'), 'const x = 1\n')
  const created = await sse.waitFor(e => e.type === 'change' && e.file === 'app.ts')
  assert.equal(created.kind, 'code')

  await fs.writeFile(path.join(projectDir, 'app.ts'), 'const x = 2\n')
  await sse.waitFor(
    e => e.type === 'change' && e.file === 'app.ts' && e !== created
  )

  // 代码文件不进入产物会话(产物范围仍是 MD/JSON/HTML/Mermaid)
  await new Promise(resolve => setTimeout(resolve, 900))
  assert.ok(
    !sse.events.some(e => e.type === 'artifact' && e.artifact.path === 'app.ts'),
    '代码文件不应进入本轮产物'
  )
})

test('轮询兜底路径同时广播 change 与 artifact', async t => {
  const { server, projectDir } = await makeServer(t, { watchFails: true })
  const sse = connectSse(server)
  t.after(sse.close)

  await fs.writeFile(path.join(projectDir, 'polled.md'), '# via polling\n')
  // 轮询周期 3s + 防抖 350ms, 留足余量
  const change = await sse.waitFor(e => e.type === 'change' && e.file === 'polled.md', 8000)
  assert.equal(change.kind, 'document')
  const artifact = await sse.waitFor(e => e.type === 'artifact' && e.artifact.path === 'polled.md')
  assert.equal(artifact.artifact.type, 'created')
})

test('切换会话上下文后 watcher 跟随新根目录', async t => {
  const { server, projectDir, tempRoot } = await makeServer(t)
  const otherDir = path.join(tempRoot, 'other-project')
  await fs.mkdir(otherDir, { recursive: true })
  const sse = connectSse(server)
  t.after(sse.close)

  await server.setConversationContext({
    id: 'cloudcli:sess-1',
    label: 'CloudCLI 会话',
    root: otherDir
  })
  assert.equal(server.root, otherDir)

  // 新根目录的变更应产生实时事件
  await fs.writeFile(path.join(otherDir, 'b.md'), '# in B\n')
  await sse.waitFor(e => e.type === 'change' && e.file === 'b.md')

  // 旧根目录的变更不应再产生事件
  const beforeCount = sse.events.length
  await fs.writeFile(path.join(projectDir, 'stale.md'), '# in old root\n')
  await new Promise(resolve => setTimeout(resolve, 900))
  assert.ok(
    !sse.events.slice(beforeCount).some(e => e.type === 'change' && e.file === 'stale.md'),
    '旧根目录变更不应再广播'
  )
})
