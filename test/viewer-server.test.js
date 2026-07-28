import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { startServer } = require('../src/viewer/server.cjs')

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
    server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const baseUrl = `http://127.0.0.1:${server.port}`
  const initial = await fetch(`${baseUrl}/api/tree`).then(response => response.json())
  assert.equal(initial.root, '')
  assert.deepEqual(initial.tree.children, [])

  assert.equal(server.setRoot(projectDir), true)
  const tree = await fetch(`${baseUrl}/api/tree`).then(response => response.json())
  assert.equal(tree.root, projectDir)
  assert.deepEqual(
    tree.tree.children.map(item => item.name).sort(),
    ['README.md', 'data.json', 'index.html']
  )

  const markdown = await fetch(`${baseUrl}/api/file?p=README.md`).then(response => response.json())
  assert.equal(markdown.content, '# Hello')
  const mermaidVendor = await fetch(`${baseUrl}/vendor/mermaid.min.js`)
  assert.equal(mermaidVendor.status, 200)
  assert.match(mermaidVendor.headers.get('content-type'), /javascript/)

  const html = await fetch(`${baseUrl}/api/file?p=index.html`).then(response => response.json())
  assert.match(html.content, /Hello/)

  const preview = await fetch(`${baseUrl}/api/html-preview?p=index.html`)
  assert.equal(preview.status, 200)
  assert.match(preview.headers.get('content-security-policy'), /script-src 'none'/)
  assert.match(await preview.text(), /<base href="\/api\/html-asset\/">/)

  const stylesheet = await fetch(`${baseUrl}/api/html-asset/style.css`)
  assert.equal(stylesheet.status, 200)
  assert.match(stylesheet.headers.get('content-type'), /text\/css/)

  const script = await fetch(`${baseUrl}/api/html-asset/unsafe.js`)
  assert.equal(script.status, 403)
})

test('blocks paths outside the active project', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-policy-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const response = await fetch(
    `http://127.0.0.1:${server.port}/api/file?p=${encodeURIComponent('../secret.json')}`
  )
  assert.equal(response.status, 403)
})
