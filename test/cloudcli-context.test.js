import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  CloudCliContextMonitor,
  extractCloudCliSessionContext,
  findMostRecentlyActiveSession,
  parseCloudCliSessionId,
  readSessionContext
} from '../src/main/cloudcli-context.js'

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-cloudcli-context-'))
  const claudeRoot = path.join(root, '.claude', 'projects')
  const codexRoot = path.join(root, '.codex', 'sessions')
  const projectA = path.join(root, 'project-a')
  const projectB = path.join(root, 'project-b')
  await Promise.all([
    fs.mkdir(claudeRoot, { recursive: true }),
    fs.mkdir(codexRoot, { recursive: true }),
    fs.mkdir(projectA),
    fs.mkdir(projectB)
  ])
  return { root, claudeRoot, codexRoot, projectA, projectB }
}

test('selects the most recently written Claude or Codex JSONL session', async t => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const claudeFile = path.join(fixture.claudeRoot, 'claude-session.jsonl')
  const codexFile = path.join(fixture.codexRoot, '2026', 'codex-session.jsonl')
  await fs.mkdir(path.dirname(codexFile), { recursive: true })
  await fs.writeFile(claudeFile, `${JSON.stringify({ cwd: fixture.projectA })}\n`)
  await fs.writeFile(codexFile, `${JSON.stringify({ cwd: fixture.projectB })}\n`)
  const oldTime = new Date(Date.now() - 10_000)
  await fs.utimes(claudeFile, oldTime, oldTime)

  const latest = await findMostRecentlyActiveSession([
    { provider: 'claude', directory: fixture.claudeRoot },
    { provider: 'codex', directory: fixture.codexRoot }
  ])
  assert.equal(latest.provider, 'codex')
  assert.equal(latest.filePath, codexFile)
})

test('reads cwd from complete JSONL records and ignores a partial trailing write', async t => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const sessionId = '12345678-1234-4123-8123-123456789abc'
  const filePath = path.join(fixture.claudeRoot, `session-${sessionId}.jsonl`)
  await fs.writeFile(filePath, `${JSON.stringify({ message: { cwd: fixture.projectA } })}\n{"cwd":`)

  const context = await readSessionContext({ provider: 'claude', filePath })
  assert.deepEqual(context, {
    sessionId,
    provider: 'claude',
    projectDirectory: fixture.projectA,
    sourcePath: filePath
  })
})

test('monitor follows later JSONL activity and keeps the last valid workspace', async t => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const roots = [
    { provider: 'claude', directory: fixture.claudeRoot },
    { provider: 'codex', directory: fixture.codexRoot }
  ]
  const claudeFile = path.join(fixture.claudeRoot, 'claude.jsonl')
  const codexFile = path.join(fixture.codexRoot, 'codex.jsonl')
  await fs.writeFile(claudeFile, `${JSON.stringify({ cwd: fixture.projectA })}\n`)
  const monitor = new CloudCliContextMonitor({ sessionRoots: roots })
  assert.equal((await monitor.detect()).projectDirectory, fixture.projectA)

  await new Promise(resolve => setTimeout(resolve, 20))
  await fs.writeFile(codexFile, `${JSON.stringify({ cwd: fixture.projectB, session_id: 'codex-2' })}\n`)
  const switched = await monitor.detect()
  assert.equal(switched.provider, 'codex')
  assert.equal(switched.sessionId, 'codex-2')
  assert.equal(switched.projectDirectory, fixture.projectB)

  await new Promise(resolve => setTimeout(resolve, 20))
  await fs.appendFile(codexFile, '{"cwd":"missing')
  assert.equal((await monitor.detect()).projectDirectory, fixture.projectB)
})

test('finds Codex cwd in the session header when the active tail has no cwd', async t => {
  const fixture = await createFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const filePath = path.join(fixture.codexRoot, 'large-session.jsonl')
  const header = `${JSON.stringify({ type: 'session_meta', payload: { cwd: fixture.projectB } })}\n`
  const activity = `${JSON.stringify({ type: 'event_msg', payload: { text: 'x'.repeat(512) } })}\n`.repeat(20)
  await fs.writeFile(filePath, header + activity)
  const stat = await fs.stat(filePath)

  const context = await readSessionContext({
    provider: 'codex',
    filePath,
    size: stat.size
  }, 1024)
  assert.equal(context.projectDirectory, fixture.projectB)
})

test('extracts the selected CloudCLI session id from route URLs', () => {
  assert.equal(
    parseCloudCliSessionId('http://127.0.0.1:42100/session/app-session-42?tab=chat'),
    'app-session-42'
  )
  assert.equal(
    parseCloudCliSessionId('http://127.0.0.1:42100/#/session/provider%2Fsession'),
    'provider/session'
  )
  assert.equal(parseCloudCliSessionId('http://127.0.0.1:42100/projects'), null)
})

test('maps CloudCLI session details API payloads to Viewer context', () => {
  assert.deepEqual(extractCloudCliSessionContext({
    success: true,
    data: {
      sessionId: 'app-session-42',
      provider: 'codex',
      project: { fullPath: 'D:/projects/example' }
    }
  }, 'route-session'), {
    sessionId: 'app-session-42',
    provider: 'codex',
    projectDirectory: path.normalize('D:/projects/example'),
    source: 'cloudcli-route'
  })
})
