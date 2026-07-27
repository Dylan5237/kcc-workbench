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
    ['README.md', 'data.json']
  )

  const markdown = await fetch(`${baseUrl}/api/file?p=README.md`).then(response => response.json())
  assert.equal(markdown.content, '# Hello')
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
