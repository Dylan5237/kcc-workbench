'use strict'

// Worker-thread entry for the Arckeep Viewer workspace runtime.
// Hosts workspace-scan.cjs behind a token-tagged request/response protocol.
// Every incoming message bumps the module-level generation token
// synchronously; long ops observe it through a cancellation callback (and a
// post-op check) so a superseded arm aborts and reports `{stale:true}`
// instead of writing results for an old generation.

const { parentPort } = require('node:worker_threads')
const {
  createWorkspaceScan,
  scanBaselineDocuments,
  scanRecoverySlice,
  buildWorkspaceTree
} = require('./workspace-scan.cjs')

let latestToken = 0
let scanState = null
let queue = Promise.resolve()

function enqueue(task) {
  const result = queue.then(task)
  queue = result.catch(() => {})
  return result
}

function staleOutcome() {
  return { stale: true }
}

async function runOp(op, token, payload) {
  switch (op) {
    case 'configure':
      scanState = createWorkspaceScan({
        roots: Array.isArray(payload.roots) ? payload.roots : [],
        primaryRoot: payload.primaryRoot || ''
      })
      if (token !== latestToken) return staleOutcome()
      return { result: null }
    case 'baseline': {
      if (!scanState) throw new Error('workspace not configured')
      const cancelled = () => token !== latestToken
      const outcome = await scanBaselineDocuments(scanState, { cancelled })
      if (token !== latestToken || !outcome.done) return staleOutcome()
      return { result: { documents: [...outcome.documents], stats: outcome.stats } }
    }
    case 'slice': {
      if (!scanState) throw new Error('workspace not configured')
      const outcome = await scanRecoverySlice(scanState, {
        maxEntries: payload.maxEntries,
        deadlineMs: payload.deadlineMs
      })
      if (token !== latestToken) return staleOutcome()
      return { result: outcome }
    }
    case 'tree': {
      const outcome = await buildWorkspaceTree({
        roots: Array.isArray(payload.roots) ? payload.roots : [],
        primaryRoot: payload.primaryRoot || '',
        includeAll: Boolean(payload.includeAll)
      })
      if (token !== latestToken) return staleOutcome()
      return { result: outcome }
    }
    default:
      throw new Error(`unknown op: ${String(op)}`)
  }
}

parentPort.on('message', message => {
  if (!message || typeof message !== 'object') return
  const { id, op, token, payload } = message
  if (typeof id !== 'number' || typeof token !== 'number') return
  latestToken = Math.max(latestToken, token)
  enqueue(() => runOp(op, token, payload || {})).then(
    outcome => {
      if (outcome && outcome.stale) {
        parentPort.postMessage({ id, token, ok: false, stale: true })
        return
      }
      parentPort.postMessage({ id, token, ok: true, result: outcome ? outcome.result : null })
    },
    err => {
      const text = err && err.message ? String(err.message) : String(err)
      parentPort.postMessage({ id, token, ok: false, error: text })
    }
  )
})
