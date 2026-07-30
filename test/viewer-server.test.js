import assert from 'node:assert/strict'
import http from 'node:http'
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

function requestWithHost(server, host) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1',
      port: server.port,
      path: '/api/root',
      headers: {
        Host: host,
        Cookie: `kimi_viewer=${server.bootstrapToken}`
      }
    }, response => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    })
    request.on('error', reject)
  })
}

test('starts empty and accepts a project directory injection', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Hello')
  await fs.writeFile(path.join(projectDir, 'data.json'), '{"ok":true}')
  await fs.writeFile(
    path.join(projectDir, 'index.html'),
    '<html><head><link rel="stylesheet" href="style.css"></head><body><script>alert(1)</script>Hello</body></html>'
  )
  await fs.writeFile(path.join(projectDir, 'style.css'), 'body { color: red }')
  await fs.writeFile(path.join(projectDir, 'unsafe.js'), 'alert(1)')
  await fs.writeFile(path.join(projectDir, 'ignored.txt'), 'ignored')

  const server = await startServer({ port: 0, configDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const initial = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(initial.root, '')
  assert.deepEqual(initial.tree.children, [])

  assert.equal(await server.setRoot(projectDir), true)
  const tree = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(tree.root, projectDir)
  assert.deepEqual(
    tree.tree.children.map(item => item.name).sort(),
    ['README.md', 'data.json', 'index.html']
  )

  const markdown = await viewerFetch(server, '/api/file?p=README.md').then(response => response.json())
  assert.equal(markdown.content, '# Hello')
  const metadata = await viewerFetch(server, '/api/file-meta?p=README.md').then(response => response.json())
  assert.equal(metadata.path, 'README.md')
  assert.equal(metadata.size, Buffer.byteLength('# Hello'))
  assert.equal(typeof metadata.mtime, 'number')
  assert.equal(Object.hasOwn(metadata, 'content'), false)
  const mermaidVendor = await viewerFetch(server, '/vendor/mermaid.min.js')
  assert.equal(mermaidVendor.status, 200)
  assert.match(mermaidVendor.headers.get('content-type'), /javascript/)
  const purifyVendor = await viewerFetch(server, '/vendor/purify.min.js')
  assert.equal(purifyVendor.status, 200)
  assert.match(purifyVendor.headers.get('content-type'), /javascript/)

  const html = await viewerFetch(server, '/api/file?p=index.html').then(response => response.json())
  assert.match(html.content, /Hello/)

  const preview = await viewerFetch(server, '/api/html-preview?p=index.html')
  assert.equal(preview.status, 200)
  assert.match(preview.headers.get('content-security-policy'), /script-src 'none'/)
  assert.match(await preview.text(), /<base href="\/api\/html-asset\/">/)

  const stylesheet = await viewerFetch(server, '/api/html-asset/style.css')
  assert.equal(stylesheet.status, 200)
  assert.match(stylesheet.headers.get('content-type'), /text\/css/)

  const script = await viewerFetch(server, '/api/html-asset/unsafe.js')
  assert.equal(script.status, 403)
})

test('blocks paths outside the active project', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-policy-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const response = await viewerFetch(server, `/api/file?p=${encodeURIComponent('../secret.json')}`)
  assert.equal(response.status, 403)

  const outsideDir = path.join(tempRoot, 'outside')
  const linkPath = path.join(projectDir, 'linked')
  await fs.mkdir(outsideDir)
  await fs.writeFile(path.join(outsideDir, 'secret.json'), '{"secret":true}')
  try {
    await fs.symlink(outsideDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    const linked = await viewerFetch(server, '/api/file?p=linked%2Fsecret.json')
    assert.equal(linked.status, 403)
  } catch (error) {
    if (error.code !== 'EPERM') throw error
  }
})

test('tracks document changes inside the current artifact session', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-artifacts-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Before')
  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })
  await server.setConversationContext({
    id: 'session:test',
    label: '测试会话',
    root: projectDir
  })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# After\n\nNew line')
  await new Promise(resolve => setTimeout(resolve, 900))
  const session = await viewerFetch(server, '/api/artifacts')
    .then(response => response.json())
  assert.equal(session.id, 'session:test')
  assert.equal(session.label, '测试会话')
  assert.equal(session.changes.length, 1)
  assert.equal(session.changes[0].type, 'modified')
  assert.ok(session.changes[0].stats.added > 0)
  assert.ok(session.changes[0].stats.removed > 0)
})

test('rejects unauthenticated API calls and forged hosts', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-auth-'))
  const server = await startServer({ port: 0, configDir: path.join(tempRoot, 'config') })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const baseUrl = `http://127.0.0.1:${server.port}`
  assert.equal((await fetch(`${baseUrl}/api/root`)).status, 401)
  assert.equal(await requestWithHost(server, 'attacker.example'), 403)
  assert.equal((await viewerFetch(server, '/api/set-root?p=C%3A%2F')).status, 404)
  assert.equal((await viewerFetch(server, '/api/time-machine/fork', {
    method: 'POST',
    body: '{}'
  })).status, 404)
})

test('contains synchronous request failures without terminating the server', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-errors-'))
  const server = await startServer({ port: 0, configDir: path.join(tempRoot, 'config') })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const malformed = await fetch(`http://127.0.0.1:${server.port}/%E0%A4%A`)
  assert.equal(malformed.status, 500)
  assert.equal((await viewerFetch(server, '/api/root')).status, 200)
})
