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

function viewerFetch(server, pathname, options = {}) {
  return fetch(`http://127.0.0.1:${server.port}${pathname}`, {
    ...options,
    headers: {
      ...options.headers,
      Cookie: `kimi_viewer=${server.bootstrapToken}`
    }
  })
}

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

// 假观察运行时: 捕获 server 注入的 handlers, 由用例手动驱动基线/恢复回调。
// 树返回固定哨兵树, arm/requestTree/invalidateTree/close 只计数不做事。
function makeFakeObserver() {
  const state = {
    armCalls: [],
    treeCalls: 0,
    invalidated: 0,
    closed: 0,
    handlers: null,
    armImpl: null,
    tree: {
      name: 'fake',
      path: '',
      type: 'dir',
      children: [
        { name: 'sentinel.md', path: 'sentinel.md', type: 'file', ext: '.md', kind: 'doc', size: 1, mtime: 1 }
      ]
    }
  }
  const createObserver = handlers => {
    state.handlers = handlers
    return {
      arm: async ({ root, extraRoots }) => {
        state.armCalls.push({ root, extraRoots })
        if (state.armImpl) await state.armImpl({ root, extraRoots })
      },
      requestTree: async () => {
        state.treeCalls += 1
        return { tree: state.tree, stats: { entries: 1, truncated: false } }
      },
      invalidateTree: () => { state.invalidated += 1 },
      close: async () => { state.closed += 1 }
    }
  }
  return { state, createObserver }
}

// 与既有套件一致: 强制 fs.watch 失败, 让产物记录只走恢复回调驱动, 保证确定性。
async function withForcedWatchFailure(fn) {
  const originalWatch = fsSync.watch
  fsSync.watch = () => { throw new Error('forced recovery-driven path') }
  try {
    return await fn()
  } finally {
    fsSync.watch = originalWatch
  }
}

test('同会话同根不重复 arm, 换会话同根仍不重建, 换根才重新武装 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-norebuild-'))
  const configDir = path.join(tempRoot, 'config')
  const dirA = path.join(tempRoot, 'a')
  const dirB = path.join(tempRoot, 'b')
  await fs.mkdir(dirA, { recursive: true })
  await fs.mkdir(dirB, { recursive: true })
  const { state, createObserver } = makeFakeObserver()
  const server = await startServer({ port: 0, configDir, createObserver })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  await server.setConversationContext({ id: 's1', label: '会话一', root: dirA })
  assert.equal(state.armCalls.length, 1, '首次武装应 arm 一次')

  await server.setConversationContext({ id: 's1', label: '会话一', root: dirA })
  assert.equal(state.armCalls.length, 1, '同会话同根不得重复 arm')

  await server.setConversationContext({ id: 's2', label: '会话二', root: dirA })
  assert.equal(state.armCalls.length, 1, 'resetArtifactSession 不得触发重扫/重武装')

  await server.setConversationContext({ id: 's2', label: '会话二', root: dirB })
  assert.equal(state.armCalls.length, 2, '换根必须重新 arm')
  assert.equal(state.armCalls[1].root, dirB)
})

test('A→B 切换: 过期 arm 被代际守卫丢弃, 恢复路径按当前根隔离 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-gen-'))
  const configDir = path.join(tempRoot, 'config')
  const dirA = path.join(tempRoot, 'a')
  const dirB = path.join(tempRoot, 'b')
  await fs.mkdir(dirA, { recursive: true })
  await fs.mkdir(dirB, { recursive: true })
  await fs.writeFile(path.join(dirB, 'b-doc.md'), '# B\n')
  const bDocPath = path.join(dirB, 'b-doc.md')

  const { state, createObserver } = makeFakeObserver()
  let releaseA
  const gateA = new Promise(resolve => { releaseA = resolve })
  const dirANormalized = path.normalize(dirA)
  state.armImpl = async ({ root }) => {
    if (path.normalize(root) === dirANormalized) {
      // A 的基线被门闩卡住: 随后 B 的 arm 会把 A 变成过期代际
      await gateA
      return
    }
    const stat = await fs.stat(bDocPath)
    state.handlers.onBaseline({
      documents: new Map([['b-doc.md', { content: '# B\n', size: stat.size, mtime: stat.mtimeMs }]]),
      stats: { entries: 1, documents: 1, bytes: stat.size, truncated: {} }
    })
  }

  const marks = []
  let server
  await withForcedWatchFailure(async () => {
    server = await startServer({
      port: 0,
      configDir,
      defaultRoot: dirA,
      createObserver,
      onProfile: label => marks.push(label)
    })
    // 不等 A 的后台基线, 立即切到 B: A 的 arm 解析时已被代际守卫判过期
    await server.setConversationContext({ id: 's-b', label: 'B会话', root: dirB })
  })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  releaseA()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(server.root, dirB, '当前根必须是 B')
  assert.equal(state.armCalls.length, 2)
  // A 的 arm 解析后被代际守卫整体丢弃(不装 watcher、不广播基线),
  // 因此只应有 B 的一对快照/监听就绪画像
  assert.deepEqual(marks, ['viewer-listener-ready', 'viewer-snapshot-ready', 'viewer-watcher-ready'])

  const sse = connectSse(server)
  t.after(sse.close)

  // 伪造 A 独有的恢复批次: 'a-only.md' 不在 B 的基线快照里。
  // 服务端隔离机制: 相对键经 rootForPath 解析到当前根 B, B 下不存在该文件,
  // scheduleArtifact 读到 previous=null/current=null 按"同文档"早退, 不产生产物。
  // (基于 token 的过期批次丢弃发生在观察运行时内, 由 observer 套件覆盖。)
  state.handlers.onRecovery({
    batch: [['a-only.md', { mtime: 1, size: 1 }]],
    sweepComplete: false,
    scanComplete: true,
    seen: null
  })

  // 修改 B 的真实文件并上报: 只有 B 的基线确实活在快照里, 才会出现 modified
  await fs.writeFile(bDocPath, '# B\nupdated\n')
  const bumped = new Date(Date.now() + 3000)
  await fs.utimes(bDocPath, bumped, bumped)
  const stat = await fs.stat(bDocPath)
  state.handlers.onRecovery({
    batch: [['b-doc.md', { mtime: stat.mtimeMs, size: stat.size }]],
    sweepComplete: false,
    scanComplete: true,
    seen: null
  })
  await sse.waitFor(e => e.type === 'artifact' && e.artifact.path === 'b-doc.md' && e.artifact.type === 'modified')
  await new Promise(resolve => setTimeout(resolve, 700))

  const session = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  assert.equal(session.id, 's-b', '本轮产物会话必须属于 B')
  assert.equal(session.root, dirB)
  assert.ok(
    !session.changes.some(change => change.path === 'a-only.md'),
    'A 独有路径不得在当前根下产生产物'
  )
  assert.ok(
    !sse.events.some(e => e.type === 'artifact' && e.artifact.path === 'a-only.md'),
    'A 独有路径不得广播 artifact 事件'
  )
})

test('恢复分片批次驱动 created→modified→deleted 产物语义 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-recovery-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })

  const { state, createObserver } = makeFakeObserver()
  state.armImpl = async () => {
    // 空基线: 之后所有产物都来自恢复批次驱动
    state.handlers.onBaseline({
      documents: new Map(),
      stats: { entries: 0, documents: 0, bytes: 0, truncated: {} }
    })
  }
  let server
  await withForcedWatchFailure(async () => {
    server = await startServer({ port: 0, configDir, defaultRoot: projectDir, createObserver })
    await server.setConversationContext({ id: 's-recovery', label: '恢复会话', root: projectDir })
  })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const sse = connectSse(server)
  t.after(sse.close)
  const notePath = path.join(projectDir, 'note.md')

  // created: 基线为空, 落盘文件经恢复批次上报
  await fs.writeFile(notePath, '# v1\n')
  let stat = await fs.stat(notePath)
  state.handlers.onRecovery({
    batch: [['note.md', { mtime: stat.mtimeMs, size: stat.size }]],
    sweepComplete: false,
    scanComplete: true,
    seen: null
  })
  const createdChange = await sse.waitFor(e => e.type === 'change' && e.file === 'note.md')
  assert.equal(createdChange.kind, 'document')
  const created = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'note.md' && e.artifact.type === 'created'
  )
  assert.ok(
    sse.events.indexOf(createdChange) < sse.events.indexOf(created),
    'change 必须先于 artifact 广播'
  )
  assert.ok(created.artifact.stats.added > 0)

  // modified: 重写后 utimes 抬升 mtime, 保证 prev.mtime !== stat.mtime 的调度门
  await fs.writeFile(notePath, '# v1\n\nmore\n')
  const bumped = new Date(Date.now() + 3000)
  await fs.utimes(notePath, bumped, bumped)
  stat = await fs.stat(notePath)
  state.handlers.onRecovery({
    batch: [['note.md', { mtime: stat.mtimeMs, size: stat.size }]],
    sweepComplete: false,
    scanComplete: true,
    seen: null
  })
  const modified = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'note.md' && e.artifact.type === 'modified'
  )
  assert.ok(modified.artifact.stats.added > 0)

  // deleted: 完整未截断扫描 + 空 seen 触发删除检测
  await fs.rm(notePath)
  state.handlers.onRecovery({ batch: [], sweepComplete: true, scanComplete: true, seen: [] })
  const deleted = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'note.md' && e.artifact.type === 'deleted'
  )
  assert.ok(deleted.artifact.stats.removed > 0)

  const session = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  assert.equal(session.id, 's-recovery')
  const byType = Object.fromEntries(
    session.changes.filter(change => change.path === 'note.md').map(change => [change.type, change])
  )
  assert.ok(byType.created && byType.modified && byType.deleted, '三种产物语义都必须出现')
})

test('截断扫描不得删档, 完整扫描才补记删除 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-truncated-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const victimPath = path.join(projectDir, 'victim.md')
  await fs.writeFile(victimPath, '# victim\n')

  const { state, createObserver } = makeFakeObserver()
  state.armImpl = async () => {
    const stat = await fs.stat(victimPath)
    state.handlers.onBaseline({
      documents: new Map([['victim.md', { content: '# victim\n', size: stat.size, mtime: stat.mtimeMs }]]),
      stats: { entries: 1, documents: 1, bytes: stat.size, truncated: {} }
    })
  }
  let server
  await withForcedWatchFailure(async () => {
    server = await startServer({ port: 0, configDir, defaultRoot: projectDir, createObserver })
    await server.setConversationContext({ id: 's-truncated', label: '截断会话', root: projectDir })
  })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const sse = connectSse(server)
  t.after(sse.close)

  await fs.rm(victimPath)
  // 扫描截断(scanComplete=false): 即使扫尾完成也禁止删除检测
  state.handlers.onRecovery({
    batch: [],
    sweepComplete: true,
    scanComplete: false,
    seen: [],
    stats: { entries: 4000, durationMs: 1200, budgetHit: 'entries' }
  })
  await new Promise(resolve => setTimeout(resolve, 700))
  const afterTruncated = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  assert.ok(
    !afterTruncated.changes.some(change => change.path === 'victim.md'),
    '截断扫描不得产生删除产物'
  )
  assert.ok(
    !sse.events.some(e => e.type === 'artifact' && e.artifact.path === 'victim.md'),
    '截断扫描不得广播 victim.md 的 artifact 事件'
  )

  // 完整未截断扫描 + 空 seen: 删除检测补记 deleted
  state.handlers.onRecovery({
    batch: [],
    sweepComplete: true,
    scanComplete: true,
    seen: [],
    stats: { entries: 1, durationMs: 5, budgetHit: '' }
  })
  const deleted = await sse.waitFor(
    e => e.type === 'artifact' && e.artifact.path === 'victim.md' && e.artifact.type === 'deleted'
  )
  assert.ok(deleted.artifact.stats.removed > 0)
  const session = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  assert.equal(session.changes.find(change => change.path === 'victim.md')?.type, 'deleted')
})

test('/api/tree 委托观察运行时并按 mode 映射 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-tree-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const { state, createObserver } = makeFakeObserver()
  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir, createObserver })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })
  await server.whenWatcherReady()

  const runTree = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(runTree.mode, 'run')
  assert.equal(runTree.root, projectDir)
  assert.equal(runTree.tree.name, 'fake')
  assert.deepEqual(runTree.tree.children.map(item => item.name), ['sentinel.md'])

  const devTree = await viewerFetch(server, '/api/tree?mode=dev').then(response => response.json())
  assert.equal(devTree.mode, 'dev')
  assert.equal(devTree.tree.name, 'fake')

  // 树缓存只存在于真实 observer 内; 假实现每次调用都应被服务到
  const again = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(again.tree.name, 'fake')
  assert.equal(again.mode, 'run')
  assert.ok(state.treeCalls >= 3, '每次 /api/tree 都应委托观察运行时')
})

test('observer arm 失败被隔离, 服务器控制面保持可用 (#40)', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rt-armfail-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const { state, createObserver } = makeFakeObserver()
  state.armImpl = async () => { throw new Error('arm exploded') }

  // 无 defaultRoot: 启动不触发 arm, 由 setConversationContext 承担失败
  const server = await startServer({ port: 0, configDir, createObserver })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  await assert.rejects(
    server.setConversationContext({ id: 's-fail', label: '失败会话', root: projectDir }),
    /arm exploded/
  )
  assert.equal(server.root, projectDir, 'root 在 arm 前已设置, 失败不应回滚')

  const rootInfo = await viewerFetch(server, '/api/root')
  assert.equal(rootInfo.status, 200)
  await rootInfo.json()

  const sse = connectSse(server)
  t.after(sse.close)

  const treeResponse = await viewerFetch(server, '/api/tree')
  assert.equal(treeResponse.status, 200)
  const treeBody = await treeResponse.json()
  assert.equal(treeBody.tree.name, 'fake', '树委托不受 arm 失败影响')

  assert.equal(state.closed, 0, '失败不应提前关闭 observer')
})
