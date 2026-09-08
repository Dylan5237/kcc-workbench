import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

import { createViewerSessionArm } from '../src/main/viewer-session-arm.js'

const require = createRequire(import.meta.url)
const { startServer } = require('../src/viewer/server.cjs')

function viewerFetch(server, pathname) {
  return fetch(`http://127.0.0.1:${server.port}${pathname}`, {
    headers: { Cookie: `kimi_viewer=${server.bootstrapToken}` }
  })
}

function deferred() {
  let resolve
  return { promise: new Promise(r => { resolve = r }), resolve }
}

test('serializes concurrent syncs behind one queue', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const gate = deferred()
  const arm = createViewerSessionArm({
    observe: () => ({ engine: 'kimi', url: 'u', key: 'kimi|u' }),
    detect: async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await gate.promise
      inFlight -= 1
      return { context: { projectDirectory: '/p', sessionId: 's' } }
    },
    apply: async () => {}
  })
  const first = arm.sync()
  const second = arm.sync()
  gate.resolve()
  await Promise.all([first, second])
  assert.equal(maxInFlight, 1, 'detections must never overlap')
})

test('applies the detected session context without any Viewer-visibility input', async () => {
  const applied = []
  const arm = createViewerSessionArm({
    observe: () => ({ engine: 'kimi', url: 'http://x/sessions/s1', key: 'kimi|http://x/sessions/s1' }),
    detect: async () => ({ context: { projectDirectory: '/proj', sessionId: 's1' } }),
    apply: async context => { applied.push(context) }
  })
  const result = await arm.sync()
  assert.equal(result.applied, true)
  assert.deepEqual(applied, [{ projectDirectory: '/proj', sessionId: 's1' }])
})

test('detection miss keeps the armed context untouched', async () => {
  const events = []
  let applyCalls = 0
  const arm = createViewerSessionArm({
    observe: () => ({ engine: 'kimi', url: 'http://x/', key: 'kimi|http://x/' }),
    detect: async () => ({ context: null, diagnostics: { routeSessionId: null } }),
    apply: async () => { applyCalls += 1 },
    onEvent: (event, details) => events.push({ event, details })
  })
  const result = await arm.sync()
  assert.equal(result.applied, false)
  assert.equal(applyCalls, 0, 'miss must not disarm or re-apply')
  assert.deepEqual(events.map(e => e.event), ['context-miss'])
})

test('stale detection result never overwrites a newer session (A -> B race)', async () => {
  let url = 'http://x/sessions/A'
  const detectionAStarted = deferred()
  const detectionA = deferred()
  const applied = []
  const events = []
  const arm = createViewerSessionArm({
    observe: () => ({ engine: 'kimi', url, key: `kimi|${url}` }),
    detect: async observed => {
      if (observed.url.endsWith('/A')) {
        detectionAStarted.resolve()
        await detectionA.promise
        return { context: { projectDirectory: '/pa', sessionId: 'A' } }
      }
      return { context: { projectDirectory: '/pb', sessionId: 'B' } }
    },
    apply: async context => { applied.push(context.sessionId) },
    onEvent: (event, details) => events.push({ event, details })
  })

  const staleRun = arm.sync()          // starts detecting A
  await detectionAStarted.promise      // A detection is genuinely in flight
  url = 'http://x/sessions/B'          // user switches to session B mid-flight
  const freshRun = arm.sync()          // queued behind A; must observe B
  detectionA.resolve()                 // A detection completes late
  const [staleResult, freshResult] = await Promise.all([staleRun, freshRun])

  assert.equal(staleResult.stale, true)
  assert.equal(freshResult.applied, true)
  assert.deepEqual(applied, ['B'], 'late A result must be discarded, only B applied')
  assert.deepEqual(events.map(e => e.event), ['context-stale'])
})

test('rapid A -> B -> A transitions converge on the final session', async () => {
  let url = 'http://x/sessions/A'
  const gate = deferred()
  const applied = []
  const arm = createViewerSessionArm({
    observe: () => ({ engine: 'kimi', url, key: `kimi|${url}` }),
    detect: async observed => {
      await gate.promise
      const id = observed.url.split('/').pop()
      return { context: { projectDirectory: `/p${id}`, sessionId: id } }
    },
    apply: async context => { applied.push(context.sessionId) }
  })
  const runs = [arm.sync()]
  url = 'http://x/sessions/B'
  runs.push(arm.sync())
  url = 'http://x/sessions/A2'
  runs.push(arm.sync())
  gate.resolve()
  await Promise.all(runs)
  assert.deepEqual(applied, ['A2'], 'only the final observed session may be applied')
})

test('viewer server does not reset the baseline when the same session syncs again', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-rearm-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const context = { id: 'session:same', label: '测试会话', root: projectDir }
  await server.setConversationContext(context)

  // arm 后产生一次变更并被记录
  await fs.writeFile(path.join(projectDir, 'keep.md'), '# keep')
  await new Promise(resolve => setTimeout(resolve, 900))
  const armed = await viewerFetch(server, '/api/artifacts').then(r => r.json())
  assert.equal(armed.id, 'session:same')
  assert.equal(armed.changes.length, 1)
  assert.equal(armed.changes[0].type, 'created')
  const startedAt = armed.startedAt

  // 同一 logical session/root 重复同步: 不重建基线, 不清空本轮产物
  await server.setConversationContext(context)
  const rearmed = await viewerFetch(server, '/api/artifacts').then(r => r.json())
  assert.equal(rearmed.id, 'session:same')
  assert.equal(rearmed.startedAt, startedAt, 'same session re-sync must keep startedAt')
  assert.equal(rearmed.changes.length, 1, 'same session re-sync must not drop recorded changes')

  // 继续产生的变更仍按原基线记录
  await fs.writeFile(path.join(projectDir, 'keep.md'), '# keep v2')
  await new Promise(resolve => setTimeout(resolve, 900))
  const after = await viewerFetch(server, '/api/artifacts').then(r => r.json())
  assert.equal(after.changes[0].type, 'modified')
})
