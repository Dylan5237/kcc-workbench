import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const standalonePath = path.join(repoRoot, 'src', 'viewer', 'standalone.cjs')

async function makeProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-standalone-proj-'))
  await fs.mkdir(path.join(root, 'docs'), { recursive: true })
  await fs.writeFile(path.join(root, 'docs', 'note.md'), '# Hello Arckeep\n\n- item **bold**\n')
  await fs.writeFile(path.join(root, 'data.json'), '{"name":"arckeep","items":[1,2,3]}')
  await fs.writeFile(path.join(root, 'page.html'), '<!doctype html><html><head><title>t</title></head><body><h1>preview</h1></body></html>')
  return root
}

async function startStandalone(root) {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-standalone-cfg-'))
  const child = spawn(process.execPath, [standalonePath, '--config-dir', configDir, '--root', root], {
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const rl = readline.createInterface({ input: child.stdout })
  const pending = new Map()
  let nextId = 0
  let ready = null
  rl.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.type === 'ready') ready = message
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const deadline = Date.now() + 15000
  while (!ready && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(ready, 'standalone viewer did not print ready handshake')

  function command(payload) {
    nextId += 1
    const id = nextId
    return new Promise((resolve, reject) => {
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      setTimeout(() => reject(new Error(`command timeout: ${payload.type}`)), 10000)
    })
  }

  const base = `http://127.0.0.1:${ready.port}`
  async function api(pathname, { cookie = true } = {}) {
    return fetch(`${base}${pathname}`, {
      headers: cookie ? { Cookie: `kimi_viewer=${ready.token}` } : {}
    })
  }

  return { child, ready, base, api, command, configDir }
}

test('standalone viewer starts outside Electron and serves the real surface', async t => {
  const root = await makeProject()
  const session = await startStandalone(root)
  t.after(() => { session.child.kill('SIGTERM') })

  // V1: process entry + handshake + config ownership
  assert.equal(path.normalize(session.ready.root), path.normalize(root))
  assert.ok(session.ready.port > 0)
  assert.match(session.ready.token, /^[0-9a-f]{64}$/)

  // auth boundary: no cookie => 401; bootstrap token => 302 + cookie; bad host => 403
  assert.equal((await session.api('/api/tree', { cookie: false })).status, 401)
  const bootstrap = await fetch(`${session.base}/?token=${session.ready.token}`, { redirect: 'manual' })
  assert.equal(bootstrap.status, 302)
  assert.match(bootstrap.headers.get('set-cookie') || '', /kimi_viewer=/)
  // fetch/undici 不允许覆盖 Host 头, 用原生 http 验证 host 绑定
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port: session.ready.port,
      path: '/api/tree',
      headers: { Host: 'evil.example', Cookie: `kimi_viewer=${session.ready.token}` }
    }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
  })
  assert.equal(wrongHost, 403)

  // V4: file tree + markdown + json + html preview
  const tree = await (await session.api('/api/tree')).json()
  const names = JSON.stringify(tree.tree)
  assert.ok(names.includes('note.md'))
  assert.ok(names.includes('data.json'))
  assert.ok(names.includes('page.html'))

  const md = await (await session.api('/api/file?p=docs/note.md')).json()
  assert.ok(md.content.includes('# Hello Arckeep'))
  const json = await (await session.api('/api/file?p=data.json')).json()
  assert.deepEqual(JSON.parse(json.content), { name: 'arckeep', items: [1, 2, 3] })

  const preview = await session.api('/api/html-preview?p=page.html')
  assert.equal(preview.status, 200)
  assert.match(preview.headers.get('content-security-policy') || '', /script-src 'none'/)
  assert.ok((await preview.text()).includes('<h1>preview</h1>'))

  const index = await session.api('/')
  assert.equal(index.status, 200)
  assert.ok((await index.text()).length > 0)

  // V4: diff path — modify a watched doc, artifact session reports a line diff
  await fs.writeFile(path.join(root, 'docs', 'note.md'), '# Hello Arckeep\n\n- item **bold**\n- changed line\n')
  let artifacts = null
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    artifacts = await (await session.api('/api/artifacts')).json()
    if (artifacts.changes.some(change => change.path === 'docs/note.md' && change.type === 'modified')) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const change = artifacts.changes.find(item => item.path === 'docs/note.md' && item.type === 'modified')
  assert.ok(change, 'artifact session did not report the modification')
  assert.ok(change.diff.some(line => line.type === 'add' && line.text.includes('changed line')))

  // V3: project-root synchronization via stdin control channel
  const root2 = await makeProject()
  const response = await session.command({ type: 'set-root', root: root2 })
  assert.equal(response.type, 'root')
  assert.equal(response.ok, true)
  assert.equal(path.normalize(response.root), path.normalize(root2))
  const rootState = await (await session.api('/api/root')).json()
  assert.equal(path.normalize(rootState.root), path.normalize(root2))
  const tree2 = await (await session.api('/api/tree')).json()
  assert.ok(JSON.stringify(tree2.tree).includes('note.md'))
  // 越权根目录必须被拒绝, 不得扩大文件系统权限
  const rejected = await session.command({ type: 'set-root', root: path.join(root2, 'does-not-exist') })
  assert.equal(rejected.ok, false)

  // lifecycle: orderly shutdown via control channel
  const bye = await session.command({ type: 'shutdown' })
  assert.equal(bye.type, 'bye')
  const exitCode = await new Promise(resolve => session.child.once('exit', resolve))
  assert.equal(exitCode, 0)
})

test('standalone viewer requires --config-dir', async () => {
  const child = spawn(process.execPath, [standalonePath], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk })
  const exitCode = await new Promise(resolve => child.once('exit', resolve))
  assert.equal(exitCode, 2)
  assert.ok(out.includes('missing --config-dir'))
})
