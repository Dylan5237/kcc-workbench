import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  createWorkspaceObserver,
  createWorkerAdapter,
  createInProcessAdapter
} = require('../src/viewer/workspace-observer.cjs')

const flush = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeTimers() {
  let intervalCb = null
  const intervals = []
  return {
    setInterval: (cb, ms) => { const h = { cb, ms, cleared: false }; intervals.push(h); intervalCb = cb; return h },
    clearInterval: h => { h.cleared = true },
    setTimeout: cb => { cb(); return { cleared: false } },
    clearTimeout: () => {},
    setImmediate: cb => cb(),
    tick: () => intervalCb && intervalCb(),
    intervalCount: () => intervals.filter(i => !i.cleared).length
  }
}

function baselineResult(entries) {
  return { documents: entries, stats: { entries: entries.length, documents: entries.length, bytes: 0 } }
}

function sliceResult(overrides = {}) {
  return { batch: [], sweepComplete: false, scanComplete: true, seen: null, stats: { entries: 0, durationMs: 0, budgetHit: '' }, ...overrides }
}

function makeFakeAdapter(hooks = {}) {
  const calls = { configure: 0, baseline: 0, slice: 0, tree: 0, dispose: 0 }
  const adapter = {
    calls,
    configure: async (...args) => { calls.configure += 1; await hooks.configure?.(...args) },
    baseline: async (...args) => {
      calls.baseline += 1
      if (hooks.baseline) return hooks.baseline(...args)
      return baselineResult([])
    },
    slice: async (...args) => {
      calls.slice += 1
      if (hooks.slice) return hooks.slice(...args)
      return sliceResult()
    },
    tree: async (...args) => {
      calls.tree += 1
      if (hooks.tree) return hooks.tree(...args)
      return { tree: { name: 'root', path: '', type: 'dir', children: [] }, stats: { entries: 1, truncated: false } }
    },
    dispose: async () => { calls.dispose += 1; await hooks.dispose?.() }
  }
  return adapter
}

test('re-arming the same root is a no-op resolve; a different root re-baselines', async () => {
  const adapter = makeFakeAdapter()
  const observer = createWorkspaceObserver({ adapterFactory: () => adapter, timers: fakeTimers() })
  await observer.arm({ root: 'dir-a', extraRoots: [] })
  await observer.arm({ root: 'dir-a', extraRoots: [] })
  assert.equal(adapter.calls.configure, 1)
  assert.equal(adapter.calls.baseline, 1)
  await observer.arm({ root: 'dir-b', extraRoots: [] })
  assert.equal(adapter.calls.configure, 2)
  assert.equal(adapter.calls.baseline, 2)
  await observer.close()
})

test('same-key in-flight arm shares the promise; A->B->A race fully re-arms A', async () => {
  const pending = []
  const adapter = makeFakeAdapter({
    baseline: () => { const d = deferred(); pending.push(d); return d.promise }
  })
  const appliedKeys = []
  const observer = createWorkspaceObserver({
    adapterFactory: () => adapter,
    timers: fakeTimers(),
    onBaseline: ({ documents }) => appliedKeys.push([...documents.keys()])
  })

  const armA1 = observer.arm({ root: 'dir-a' })
  const armA2 = observer.arm({ root: 'dir-a' })
  assert.strictEqual(armA1, armA2)
  await flush()
  assert.equal(adapter.calls.baseline, 1)
  pending.shift().resolve(baselineResult([['a.md', { content: '', size: 0, mtime: 1 }]]))
  await armA1

  const armB = observer.arm({ root: 'dir-b' })
  await flush()
  assert.equal(adapter.calls.baseline, 2)
  const armA3 = observer.arm({ root: 'dir-a' })
  await flush()
  assert.equal(adapter.calls.configure, 3)
  assert.equal(adapter.calls.baseline, 3)
  pending.shift().resolve(baselineResult([['b.md', { content: '', size: 0, mtime: 1 }]]))
  await flush()
  pending.shift().resolve(baselineResult([['a2.md', { content: '', size: 0, mtime: 1 }]]))
  await Promise.all([armB, armA3])
  assert.deepEqual(appliedKeys, [['a.md'], ['a2.md']])
  await observer.close()
})

test('recovery tick forwards slice budget, never overlaps slices, and skips while busy', async () => {
  const adapter = makeFakeAdapter()
  const ft = fakeTimers()
  const sliceBudget = { maxEntries: 7, deadlineMs: 9 }
  const budgets = []
  const pending = deferred()
  const recoveries = []
  const observer = createWorkspaceObserver({
    adapterFactory: () => adapter,
    timers: ft,
    sliceBudget,
    onRecovery: batch => recoveries.push(batch)
  })
  adapter.slice = async (token, budget) => { adapter.calls.slice += 1; budgets.push({ ...budget }); return pending.promise }
  await observer.arm({ root: 'dir-a' })
  ft.tick()
  ft.tick()
  await flush()
  assert.equal(adapter.calls.slice, 1)
  assert.deepEqual(budgets[0], sliceBudget)
  pending.resolve(sliceResult({ sweepComplete: true, seen: ['a.md'] }))
  await flush()
  assert.equal(recoveries.length, 1)
  assert.deepEqual(recoveries[0].seen, ['a.md'])
  ft.tick()
  await flush()
  assert.equal(adapter.calls.slice, 2)
  await observer.close()
})

test('a superseded arm drops the stale baseline result', async () => {
  const dA = deferred()
  const dB = deferred()
  const baselines = []
  const adapter = makeFakeAdapter({
    baseline: token => (token === 1 ? dA.promise : dB.promise)
  })
  const observer = createWorkspaceObserver({
    adapterFactory: () => adapter,
    timers: fakeTimers(),
    onBaseline: ({ documents }) => baselines.push(documents)
  })
  const armA = observer.arm({ root: 'dir-a' })
  await flush()
  const armB = observer.arm({ root: 'dir-b' })
  await flush()
  dA.resolve(baselineResult([['a.md', { content: 'a', size: 1, mtime: 1 }]]))
  await flush()
  assert.equal(baselines.length, 0)
  dB.resolve(baselineResult([['b.md', { content: 'b', size: 1, mtime: 2 }]]))
  await flush()
  assert.equal(baselines.length, 1)
  assert.equal(baselines[0].get('b.md').content, 'b')
  await armB
  await armA
  await observer.close()
})

test('adapter crash restarts at most twice per arm then degrades; a fresh arm retries', async () => {
  let created = 0
  const profiles = []
  const errors = []
  const factory = () => {
    created += 1
    return makeFakeAdapter({ baseline: async () => { throw new Error(`boom-${created}`) } })
  }
  const observer = createWorkspaceObserver({
    adapterFactory: factory,
    timers: fakeTimers(),
    onProfile: (label, details) => profiles.push([label, details]),
    onError: (stage, err) => errors.push([stage, err])
  })
  await assert.rejects(observer.arm({ root: 'dir-a' }), /boom-3/)
  assert.equal(created, 3)
  assert.deepEqual(profiles.filter(([label]) => label === 'viewer-worker-restart').map(() => 1).length, 2)
  assert.equal(errors.length, 1)
  assert.equal(errors[0][0], 'degraded')
  await assert.rejects(observer.arm({ root: 'dir-b' }), /boom-6/)
  assert.equal(created, 6)
  await observer.close()
})

test('close clears the interval, disposes the adapter, settles a pending arm, and is idempotent', async () => {
  const dBaseline = deferred()
  const adapter = makeFakeAdapter({ baseline: () => dBaseline.promise })
  const ft = fakeTimers()
  const observer = createWorkspaceObserver({ adapterFactory: () => adapter, timers: ft })
  const arm = observer.arm({ root: 'dir-a' })
  const settled = arm.then(() => 'resolved', () => 'rejected')
  await flush()
  const closed = Promise.race([
    observer.close(),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('close hung')), 50))
  ])
  await closed
  assert.equal(adapter.calls.dispose, 1)
  assert.equal(ft.intervalCount(), 0)
  assert.equal(await settled, 'rejected')
  await observer.close()
  assert.equal(adapter.calls.dispose, 1)
})

test('tree requests cache, single-flight concurrent misses, and re-arm invalidates', async () => {
  const adapter = makeFakeAdapter()
  const observer = createWorkspaceObserver({ adapterFactory: () => adapter, timers: fakeTimers() })
  const sentinel = { tree: { name: 'root', path: '', type: 'dir', children: [] }, stats: { entries: 1, truncated: false } }
  adapter.tree = async () => { adapter.calls.tree += 1; return sentinel }
  const first = await observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: false })
  assert.equal(first, sentinel)
  const cached = await observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: false })
  assert.equal(cached, sentinel)
  assert.equal(adapter.calls.tree, 1)
  observer.invalidateTree()
  await observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: false })
  assert.equal(adapter.calls.tree, 2)
  const [flightA, flightB] = await Promise.all([
    observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: true }),
    observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: true })
  ])
  assert.equal(adapter.calls.tree, 3)
  assert.equal(flightA, sentinel)
  assert.equal(flightB, sentinel)
  await observer.arm({ root: 'dir-a' })
  await observer.requestTree({ root: 'dir-a', extraRoots: [], includeAll: true })
  assert.equal(adapter.calls.tree, 4)
  await observer.close()
})

test('real worker adapter arms a 3-file temp dir and close terminates promptly', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-observer-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  for (const name of ['a.md', 'b.md', 'c.md']) {
    await fs.writeFile(path.join(tmp, name), `# ${name}`)
  }
  let baseline = null
  const observer = createWorkspaceObserver({
    onBaseline: ({ documents }) => { baseline = documents }
  })
  await observer.arm({ root: tmp })
  assert.ok(baseline instanceof Map)
  assert.equal(baseline.size, 3)
  assert.equal(baseline.get('a.md').content, '# a.md')
  await Promise.race([
    observer.close(),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('close hung')), 2000))
  ])
})

test('in-process adapter runs sliced baselines and rejects stale tokens after re-configure', async t => {
  const tmpA = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-inproc-a-'))
  const tmpB = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-inproc-b-'))
  t.after(() => fs.rm(tmpA, { recursive: true, force: true }))
  t.after(() => fs.rm(tmpB, { recursive: true, force: true }))
  for (let i = 0; i < 5; i += 1) await fs.writeFile(path.join(tmpA, `doc-${i}.md`), `# ${i}`)
  await fs.writeFile(path.join(tmpB, 'only.md'), '# only')
  const adapter = createInProcessAdapter({
    timers: fakeTimers(),
    sliceBudget: { maxEntries: 2, deadlineMs: Number.MAX_SAFE_INTEGER }
  })
  await adapter.configure(1, { roots: [tmpA], primaryRoot: tmpA })
  const staleBaseline = adapter.baseline(1)
  adapter.configure(2, { roots: [tmpB], primaryRoot: tmpB })
  await assert.rejects(staleBaseline, err => err.stale === true)
  const result = await adapter.baseline(2)
  assert.ok(result.stats.entries > 0)
  assert.equal(result.documents.length, 1)
  assert.equal(result.documents[0][0], 'only.md')
  await adapter.dispose()
})
