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
  await fs.writeFile(path.join(projectDir, 'diagram.mmd'), 'flowchart LR\nA --> B')
  await fs.writeFile(path.join(projectDir, 'sequence.mermaid'), 'sequenceDiagram\nA->>B: ping')
  await fs.writeFile(
    path.join(projectDir, 'index.html'),
    '<html><head><link rel="stylesheet" href="style.css"></head><body><script>alert(1)</script>Hello</body></html>'
  )
  await fs.writeFile(path.join(projectDir, 'style.css'), 'body { color: red }')
  await fs.writeFile(path.join(projectDir, 'unsafe.js'), 'alert(1)')
  await fs.writeFile(path.join(projectDir, 'ignored.txt'), 'ignored')
  await fs.mkdir(path.join(projectDir, 'node_modules', 'dependency'), { recursive: true })
  await fs.writeFile(path.join(projectDir, 'node_modules', 'dependency', 'README.md'), '# Dependency')
  await fs.mkdir(path.join(projectDir, 'dist'), { recursive: true })
  await fs.writeFile(path.join(projectDir, 'dist', 'generated.json'), '{"generated":true}')

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
    ['README.md', 'data.json', 'diagram.mmd', 'index.html', 'sequence.mermaid']
  )

  const markdown = await viewerFetch(server, '/api/file?p=README.md').then(response => response.json())
  assert.equal(markdown.content, '# Hello')
  const mermaidFile = await viewerFetch(server, '/api/file?p=diagram.mmd').then(response => response.json())
  assert.equal(mermaidFile.content, 'flowchart LR\nA --> B')
  const mermaidAlt = await viewerFetch(server, '/api/file?p=sequence.mermaid').then(response => response.json())
  assert.equal(mermaidAlt.content, 'sequenceDiagram\nA->>B: ping')
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

test('aggregates session-touched external directories as extra roots', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-extra-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  const outsideDir = path.join(tempRoot, 'outside')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.mkdir(outsideDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Main')
  await fs.writeFile(path.join(outsideDir, 'plan.md'), '# External plan')
  await fs.writeFile(path.join(outsideDir, 'data.json'), '{"external":true}')

  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  await server.setConversationContext({
    id: 'session:extra',
    label: '测试会话',
    root: projectDir,
    extraRoots: [outsideDir]
  })

  // 补充根出现在文件树, 且其下文件带绝对路径前缀
  const tree = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(tree.root, projectDir)
  assert.deepEqual(tree.extraRoots, [outsideDir])
  const outsideTop = tree.tree.children.find(item => item.name === 'outside' && item.type === 'dir')
  assert.ok(outsideTop, '外部目录应作为补充根出现在树中')

  // 补充根文件可通过绝对路径读取
  const absPath = path.join(outsideDir, 'plan.md').replace(/\\/g, '/')
  const plan = await viewerFetch(server, `/api/file?p=${encodeURIComponent(absPath)}`)
    .then(response => response.json())
  assert.equal(plan.content, '# External plan')

  // 补充根可出现在本轮产物
  await fs.writeFile(path.join(outsideDir, 'plan.md'), '# External plan updated')
  await new Promise(resolve => setTimeout(resolve, 900))
  const session = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  const externalChange = session.changes.find(change => change.path.includes('plan.md'))
  assert.ok(externalChange, '外部目录文件变更应出现在本轮产物')
  assert.equal(externalChange.type, 'modified')

  // 主根与补充根之外任意路径仍被拒
  const otherDir = path.join(tempRoot, 'other')
  await fs.mkdir(otherDir)
  await fs.writeFile(path.join(otherDir, 'secret.md'), 'secret')
  const blocked = await viewerFetch(server, `/api/file?p=${encodeURIComponent(path.join(otherDir, 'secret.md').replace(/\\/g, '/'))}`)
  assert.equal(blocked.status, 403)
})

test('tracks document changes inside the current artifact session', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-artifacts-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Before')
  await fs.mkdir(path.join(projectDir, 'node_modules', 'dependency'), { recursive: true })
  await fs.writeFile(path.join(projectDir, 'node_modules', 'dependency', 'README.md'), '# Before dependency')
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
  await fs.writeFile(path.join(projectDir, 'node_modules', 'dependency', 'README.md'), '# After dependency')
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

test('rebuilds the current-round artifact list from persisted checkpoints', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-persist-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Before')

  const first = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  await first.setConversationContext({ id: 'session:round-1', label: '测试会话', root: projectDir })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# After\n\nNew line')
  await fs.writeFile(path.join(projectDir, 'plan.md'), '# Plan')
  // 等待 artifact 防抖(350ms)落盘, 再由 close() 冲刷时间机 checkpoint
  await new Promise(resolve => setTimeout(resolve, 900))
  await first.close()

  // 模拟应用重启: 用同一 configDir 重新拉起, 检查点从磁盘恢复
  const second = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await second.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })
  await second.setConversationContext({ id: 'session:round-1', label: '测试会话', root: projectDir })
  const session = await viewerFetch(second, '/api/artifacts').then(response => response.json())
  assert.equal(session.id, 'session:round-1')
  assert.equal(session.changes.length, 2)
  const paths = session.changes.map(change => change.path).sort()
  assert.deepEqual(paths, ['README.md', 'plan.md'])
  const readme = session.changes.find(change => change.path === 'README.md')
  const plan = session.changes.find(change => change.path === 'plan.md')
  assert.equal(readme.type, 'modified')
  assert.equal(plan.type, 'created')
  assert.ok(Object.hasOwn(readme, 'diff'))
  assert.ok(readme.stats.added > 0)
  assert.ok(Object.hasOwn(readme, 'afterContent') === false)
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

test('serves a full file tree and source previews in dev mode', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-dev-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(path.join(projectDir, 'README.md'), '# Main')
  await fs.writeFile(path.join(projectDir, 'app.ts'), 'const value: number = 42')
  await fs.writeFile(path.join(projectDir, 'style.css'), 'body { color: red }')
  await fs.writeFile(path.join(projectDir, 'logo.svg'), '<svg></svg>')
  await fs.writeFile(path.join(projectDir, 'data.bin'), Buffer.from([0, 1, 2, 3]))

  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  const runTree = await viewerFetch(server, '/api/tree').then(response => response.json())
  assert.equal(runTree.mode, 'run')
  assert.deepEqual(
    runTree.tree.children.map(item => item.name).sort(),
    ['README.md']
  )

  const devTree = await viewerFetch(server, '/api/tree?mode=dev').then(response => response.json())
  assert.equal(devTree.mode, 'dev')
  const byName = Object.fromEntries(devTree.tree.children.map(item => [item.name, item]))
  assert.equal(byName['app.ts'].kind, 'code')
  assert.equal(byName['style.css'].kind, 'code')
  assert.equal(byName['logo.svg'].kind, 'image')
  assert.equal(byName['data.bin'].kind, 'binary')
  assert.equal(byName['README.md'].kind, 'doc')

  const source = await viewerFetch(server, '/api/file?p=app.ts').then(response => response.json())
  assert.equal(source.kind, 'code')
  assert.equal(source.content, 'const value: number = 42')

  const image = await viewerFetch(server, '/api/raw-file?p=logo.svg')
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/svg+xml')
  assert.equal(await image.text(), '<svg></svg>')

  const binary = await viewerFetch(server, '/api/file?p=data.bin')
  assert.equal(binary.status, 403)

  const imageMeta = await viewerFetch(server, '/api/file-meta?p=logo.svg').then(response => response.json())
  assert.equal(imageMeta.path, 'logo.svg')
  assert.ok(imageMeta.size > 0)

  const binaryMeta = await viewerFetch(server, '/api/file-meta?p=data.bin').then(response => response.json())
  assert.equal(binaryMeta.path, 'data.bin')
  assert.ok(binaryMeta.size > 0)
})

test('excludes transient directories and process files from tree and artifacts', async t => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-viewer-transient-'))
  const configDir = path.join(tempRoot, 'config')
  const projectDir = path.join(tempRoot, 'project')
  await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true })
  await fs.mkdir(path.join(projectDir, 'tmp-distill-123'), { recursive: true })
  await fs.mkdir(path.join(projectDir, '.git'), { recursive: true })
  await fs.writeFile(path.join(projectDir, 'docs', 'real.md'), '# real')
  await fs.writeFile(path.join(projectDir, 'tmp-distill-123', 'throwaway.md'), '# throwaway')
  await fs.writeFile(path.join(projectDir, 'notes.draft.md'), '# draft')
  await fs.writeFile(path.join(projectDir, 'backup.md~'), '# backup')
  await fs.writeFile(path.join(projectDir, '.git', 'config'), 'secret')

  const server = await startServer({ port: 0, configDir, defaultRoot: projectDir })
  t.after(async () => {
    await server.close()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  // 开发模式全量树: 正式文件保留, tmp 目录/过程文件/点目录被过滤
  const tree = await viewerFetch(server, '/api/tree?mode=dev').then(response => response.json())
  const names = tree.tree.children.map(item => item.name)
  assert.ok(names.includes('docs'), '正式目录应保留')
  assert.ok(!names.includes('tmp-distill-123'), 'tmp 目录应被过滤')
  assert.ok(!names.includes('.git'), '点目录应被过滤')
  assert.ok(!names.includes('notes.draft.md'), 'draft 文件应被过滤')
  assert.ok(!names.includes('backup.md~'), '备份文件应被过滤')

  // 产物快照同样过滤
  await fs.writeFile(path.join(projectDir, 'docs', 'real.md'), '# real updated')
  await new Promise(resolve => setTimeout(resolve, 900))
  const session = await viewerFetch(server, '/api/artifacts').then(response => response.json())
  const paths = session.changes.map(change => change.path)
  assert.ok(paths.some(p => p.includes('real.md')), '正式文件变更应出现在产物')
  assert.ok(!paths.some(p => p.includes('throwaway') || p.includes('draft') || p.includes('backup')), '临时/过程文件不应出现在产物')
})