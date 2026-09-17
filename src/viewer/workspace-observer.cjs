'use strict'

// Main-thread owner of the workspace observation runtime.
// Owns the scan adapter (worker thread by default, in-process fallback),
// the single lazy recovery interval, the file-tree cache, and generation
// tokens. The adapter seam is token-tagged and promise-based; stale-token
// rejections are dropped, non-stale failures engage the crash policy
// (<= 2 restarts per arm token, then degraded mode).

const path = require('node:path')
const { Worker } = require('node:worker_threads')
const {
  createWorkspaceScan,
  scanBaselineDocuments,
  scanRecoverySlice,
  buildWorkspaceTree
} = require('./workspace-scan.cjs')

const DEFAULT_RECOVERY_INTERVAL_MS = 3000
const DEFAULT_SLICE_BUDGET = { maxEntries: 4000, deadlineMs: 1200 }
const MAX_CRASH_RESTARTS_PER_TOKEN = 2

function staleError() {
  const err = new Error('stale workspace token')
  err.stale = true
  return err
}

function closedError() {
  const err = new Error('workspace observer closed')
  err.closed = true
  return err
}

function createWorkspaceObserver(options = {}) {
  const {
    onBaseline = () => {},
    onRecovery = () => {},
    onError = () => {},
    onProfile = () => {},
    adapterFactory = defaultAdapterFactory,
    timers = globalThis,
    recoveryIntervalMs = DEFAULT_RECOVERY_INTERVAL_MS,
    sliceBudget = DEFAULT_SLICE_BUDGET
  } = options

  let token = 0
  let adapter = null
  let adapterPromise = null
  let armed = null
  let lastCompletedKey = null
  let restartsThisToken = 0
  let degraded = false
  let recoveryTimer = null
  let sliceInFlight = false
  let armPromise = null
  let armReject = null
  let closed = false
  let closePromise = null
  const treeCache = new Map()
  const treeInflight = new Map()

  function keyFor(root, extraRoots) {
    return JSON.stringify([path.normalize(root), ...extraRoots.map(entry => path.normalize(entry))])
  }

  function throwIfClosed() {
    if (closed) throw closedError()
  }

  function ensureAdapter() {
    if (adapter) return Promise.resolve(adapter)
    if (!adapterPromise) {
      adapterPromise = Promise.resolve()
        .then(() => adapterFactory({ onProfile, timers, sliceBudget }))
        .then(created => { adapter = created; return created })
        .catch(err => { adapterPromise = null; throw err })
    }
    return adapterPromise
  }

  async function disposeAdapter() {
    const current = adapter
    adapter = null
    adapterPromise = null
    if (current) await current.dispose().catch(() => {})
  }

  async function performArmSteps(root, extraRoots, myToken) {
    const instance = await ensureAdapter()
    throwIfClosed()
    await instance.configure(myToken, { roots: [root, ...extraRoots], primaryRoot: root })
    throwIfClosed()
    if (myToken !== token) return
    const result = await instance.baseline(myToken)
    throwIfClosed()
    if (myToken !== token) return
    invalidateTree()
    lastCompletedKey = keyFor(root, extraRoots)
    onBaseline({ documents: new Map(result.documents), stats: result.stats })
  }

  async function handleAdapterCrash(err, myToken) {
    if (closed || myToken !== token) return 'stale'
    await disposeAdapter()
    if (restartsThisToken >= MAX_CRASH_RESTARTS_PER_TOKEN) {
      degraded = true
      stopRecoveryTimer()
      onError('degraded', err)
      return 'degraded'
    }
    restartsThisToken += 1
    onProfile('viewer-worker-restart', `attempt=${restartsThisToken}`)
    return 'restarted'
  }

  async function executeWithPolicy(stepFn, myToken) {
    while (true) {
      throwIfClosed()
      if (myToken !== token) return
      try {
        await stepFn()
        return
      } catch (err) {
        if (err && err.closed) throw err
        if (err && err.stale) return
        const outcome = await handleAdapterCrash(err, myToken)
        if (outcome === 'stale') return
        if (outcome === 'degraded') throw err
      }
    }
  }

  function startRecoveryTimer() {
    if (recoveryTimer || closed || !armed) return
    recoveryTimer = timers.setInterval(() => { void tickRecovery() }, recoveryIntervalMs)
  }

  function stopRecoveryTimer() {
    if (recoveryTimer) {
      timers.clearInterval(recoveryTimer)
      recoveryTimer = null
    }
  }

  async function rebaselineAfterCrash(myToken) {
    if (!armed || closed || myToken !== token) return
    try {
      await executeWithPolicy(() => performArmSteps(armed.root, armed.extraRoots, token), token)
    } catch {
      // degradation (or close) is already reported inside executeWithPolicy
    }
  }

  async function tickRecovery() {
    if (closed || !armed || armPromise || sliceInFlight || degraded) return
    sliceInFlight = true
    const myToken = token
    try {
      const instance = await ensureAdapter()
      const result = await instance.slice(myToken, sliceBudget)
      if (closed || myToken !== token) return
      onRecovery(result)
    } catch (err) {
      if (closed || myToken !== token || (err && err.stale)) return
      await rebaselineAfterCrash(myToken)
    } finally {
      sliceInFlight = false
    }
  }

  function arm({ root, extraRoots = [] } = {}) {
    if (!root) return Promise.resolve()
    const extras = Array.isArray(extraRoots) ? extraRoots : []
    const requestedKey = keyFor(root, extras)
    const armedKey = armed ? keyFor(armed.root, armed.extraRoots) : null
    // 同键在途: 共享在途 promise, 不重启基线 (同逻辑根/会话不重复重建)。
    // 两个空转判定都先于 token 递增, 否则无谓作废在途基线;
    // A→B→A 竞态下 armed 指向 B, 对 A 的 arm 必须走完整流程。
    if (!degraded && armedKey === requestedKey && armPromise) return armPromise
    if (!degraded && adapter && armedKey === requestedKey && lastCompletedKey === requestedKey) {
      return Promise.resolve()
    }
    token += 1
    const myToken = token
    degraded = false
    restartsThisToken = 0
    armed = { root, extraRoots: extras }
    startRecoveryTimer()
    const promise = new Promise((resolve, reject) => {
      armReject = reject
      executeWithPolicy(() => performArmSteps(root, extras, myToken), myToken)
        .then(
          value => {
            if (armPromise === promise) armPromise = null
            if (armReject === reject) armReject = null
            resolve(value)
          },
          err => {
            if (armPromise === promise) armPromise = null
            if (armReject === reject) armReject = null
            reject(err)
          }
        )
    })
    armPromise = promise
    return promise
  }

  async function runTreeRequest(key, root, extras, includeAll, retries) {
    const myToken = token
    const promise = (async () => {
      const instance = await ensureAdapter()
      throwIfClosed()
      const result = await instance.tree(myToken, { roots: [root, ...extras], primaryRoot: root, includeAll })
      throwIfClosed()
      if (myToken !== token) throw staleError()
      treeCache.set(key, result)
      return result
    })()
    treeInflight.set(key, promise)
    try {
      return await promise
    } catch (err) {
      if (err && err.closed) throw err
      if (err && err.stale) {
        if (retries < 3) return runTreeRequest(key, root, extras, includeAll, retries + 1)
        throw err
      }
      const outcome = await handleAdapterCrash(err, myToken)
      if (outcome === 'stale') {
        if (retries < 3) return runTreeRequest(key, root, extras, includeAll, retries + 1)
        throw staleError()
      }
      if (outcome === 'degraded') throw err
      if (armed) {
        try {
          await executeWithPolicy(() => performArmSteps(armed.root, armed.extraRoots, token), token)
        } catch (rebaselineErr) {
          throw rebaselineErr && rebaselineErr.closed ? rebaselineErr : err
        }
      }
      if (retries < 3) return runTreeRequest(key, root, extras, includeAll, retries + 1)
      throw err
    } finally {
      if (treeInflight.get(key) === promise) treeInflight.delete(key)
    }
  }

  function requestTree({ root, extraRoots = [], includeAll = false } = {}) {
    const extras = Array.isArray(extraRoots) ? extraRoots : []
    const key = JSON.stringify([root, ...extras, includeAll])
    if (treeCache.has(key)) return Promise.resolve(treeCache.get(key))
    if (treeInflight.has(key)) return treeInflight.get(key)
    return runTreeRequest(key, root, extras, includeAll, 0)
  }

  function invalidateTree() {
    treeCache.clear()
  }

  function close() {
    if (closePromise) return closePromise
    closed = true
    stopRecoveryTimer()
    if (armReject) {
      const reject = armReject
      queueMicrotask(() => reject(closedError()))
    }
    closePromise = disposeAdapter().then(() => undefined)
    return closePromise
  }

  return { arm, requestTree, invalidateTree, close }
}

function createWorkerAdapter() {
  const worker = new Worker(path.join(__dirname, 'workspace-worker.cjs'))
  let nextId = 1
  const pending = new Map()
  let fatalError = null

  function failPending(err) {
    if (!fatalError) fatalError = err
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) entry.reject(err)
  }

  worker.on('message', message => {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) {
      entry.resolve(message.result)
      return
    }
    const err = new Error(message.error || 'workspace worker stale token')
    if (message.stale) err.stale = true
    entry.reject(err)
  })
  worker.on('error', err => failPending(err))
  worker.on('exit', code => {
    if (code !== 0) failPending(new Error(`workspace worker exited with code ${code}`))
  })

  function request(op, token, payload) {
    if (fatalError) return Promise.reject(fatalError)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ id, op, token, payload })
      } catch (err) {
        pending.delete(id)
        reject(err)
      }
    })
  }

  async function dispose() {
    const err = new Error('workspace worker disposed')
    err.disposed = true
    failPending(err)
    await worker.terminate()
  }

  return {
    configure: (token, payload) => request('configure', token, payload),
    baseline: token => request('baseline', token, {}),
    slice: (token, budget) => request('slice', token, budget),
    tree: (token, payload) => request('tree', token, payload),
    dispose
  }
}

function createInProcessAdapter({ timers = globalThis, sliceBudget = null } = {}) {
  const budget = { ...DEFAULT_SLICE_BUDGET, ...(sliceBudget || {}) }
  let scanState = null
  let latestToken = 0
  let disposed = false
  let queue = Promise.resolve()

  function enqueue(task) {
    const result = queue.then(task)
    queue = result.catch(() => {})
    return result
  }

  function stale() {
    return staleError()
  }

  function disposedError() {
    const err = new Error('in-process workspace adapter disposed')
    err.disposed = true
    return err
  }

  function immediate() {
    return new Promise(resolve => timers.setImmediate(resolve))
  }

  return {
    configure(token, { roots, primaryRoot } = {}) {
      latestToken = Math.max(latestToken, token)
      return enqueue(async () => {
        if (disposed) throw disposedError()
        scanState = createWorkspaceScan({ roots: roots || [], primaryRoot: primaryRoot || '' })
        if (token !== latestToken) throw stale()
      })
    },
    baseline(token) {
      latestToken = Math.max(latestToken, token)
      return enqueue(async () => {
        if (disposed) throw disposedError()
        if (!scanState) throw new Error('workspace not configured')
        let outcome
        do {
          const cancelled = () => token !== latestToken
          outcome = await scanBaselineDocuments(scanState, { slice: budget, cancelled })
          if (token !== latestToken) throw stale()
          if (!outcome.done) await immediate()
        } while (!outcome.done)
        return { documents: [...outcome.documents], stats: outcome.stats }
      })
    },
    slice(token, { maxEntries, deadlineMs } = {}) {
      latestToken = Math.max(latestToken, token)
      return enqueue(async () => {
        if (disposed) throw disposedError()
        if (!scanState) throw new Error('workspace not configured')
        const outcome = await scanRecoverySlice(scanState, { maxEntries, deadlineMs })
        if (token !== latestToken) throw stale()
        return outcome
      })
    },
    tree(token, { roots, primaryRoot, includeAll } = {}) {
      latestToken = Math.max(latestToken, token)
      return enqueue(async () => {
        if (disposed) throw disposedError()
        const outcome = await buildWorkspaceTree({
          roots: roots || [],
          primaryRoot: primaryRoot || '',
          includeAll: Boolean(includeAll)
        })
        if (token !== latestToken) throw stale()
        return outcome
      })
    },
    async dispose() {
      disposed = true
      latestToken += 1
    }
  }
}

async function defaultAdapterFactory({ onProfile = () => {}, timers = globalThis, sliceBudget = null } = {}) {
  let adapter = null
  try {
    adapter = createWorkerAdapter()
    await adapter.configure(0, { roots: [], primaryRoot: '' })
    return adapter
  } catch (err) {
    if (adapter) await adapter.dispose().catch(() => {})
    const reason = err && err.message ? String(err.message).slice(0, 120) : String(err)
    onProfile('viewer-worker-fallback', `reason=${reason}`)
    return createInProcessAdapter({ timers, sliceBudget })
  }
}

module.exports = {
  createWorkspaceObserver,
  createWorkerAdapter,
  createInProcessAdapter,
  defaultAdapterFactory
}
