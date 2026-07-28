const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { createLineDiff } = require('./diff.cjs')
const { createTimeMachine } = require('./time-machine.cjs')

const PUBLIC_ROOT = path.join(__dirname, 'public')
const WATCHED_EXTENSIONS = new Set(['.md', '.json', '.html', '.htm'])
const HTML_ASSET_EXTENSIONS = new Set([
  '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf'
])
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_ARTIFACT_CONTENT_BYTES = 512 * 1024
const MAX_ARTIFACTS = 100
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}
const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'self'"
].join('; ')

function startServer({ port = 0, configDir, defaultRoot = '' }) {
  const configPath = path.join(configDir, 'viewer-config.json')
  const stored = readJson(configPath)
  let root = validDirectory(defaultRoot)
    || validDirectory(stored.root)
    || ''
  let recentRoots = Array.isArray(stored.recentRoots)
    ? stored.recentRoots.filter(validDirectory).slice(0, 10)
    : []
  const clients = new Set()
  const timeMachine = createTimeMachine({
    configDir,
    onChange(message) {
      broadcast(message)
    }
  })
  let watcher = null
  let debounceTimer = null
  const artifactTimers = new Map()
  let artifactSnapshot = new Map()
  let artifactSession = createArtifactSession({ root })

  function saveState() {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ root, recentRoots }, null, 2))
  }

  function setRoot(nextRoot) {
    const resolved = validDirectory(nextRoot)
    if (!resolved) return false
    if (resolved === root) return true
    root = resolved
    recentRoots = [root, ...recentRoots.filter(item => item !== root)].slice(0, 10)
    saveState()
    resetArtifactSession({
      id: `workspace:${root.toLowerCase()}`,
      label: '当前工作区',
      root
    })
    startWatcher()
    broadcast({ type: 'root', root })
    return true
  }

  function startWatcher() {
    watcher?.close()
    watcher = null
    clearTimeout(debounceTimer)
    for (const timer of artifactTimers.values()) clearTimeout(timer)
    artifactTimers.clear()
    if (!root) return
    artifactSnapshot = snapshotDocuments(root)
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const extension = path.extname(filename).toLowerCase()
        if (!WATCHED_EXTENSIONS.has(extension) && !HTML_ASSET_EXTENSIONS.has(extension)) return
        const normalizedFile = String(filename).replace(/\\/g, '/')
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          broadcast({
            type: 'change',
            file: normalizedFile,
            kind: WATCHED_EXTENSIONS.has(extension) ? 'document' : 'asset'
          })
        }, 250)
        if (WATCHED_EXTENSIONS.has(extension)) scheduleArtifact(normalizedFile)
      })
    } catch (error) {
      console.error('Viewer watcher failed:', error)
    }
  }

  function scheduleArtifact(relativePath) {
    clearTimeout(artifactTimers.get(relativePath))
    artifactTimers.set(relativePath, setTimeout(() => {
      artifactTimers.delete(relativePath)
      const previous = artifactSnapshot.get(relativePath) || null
      const current = readArtifactDocument(root, relativePath)
      if (sameArtifactDocument(previous, current)) return
      if (current) artifactSnapshot.set(relativePath, current)
      else artifactSnapshot.delete(relativePath)
      const type = !previous ? 'created' : (!current ? 'deleted' : 'modified')
      const diff = createLineDiff(previous?.content || '', current?.content || '')
      const artifact = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        path: relativePath,
        name: path.basename(relativePath),
        ext: path.extname(relativePath).toLowerCase(),
        type,
        timestamp: Date.now(),
        size: current?.size || previous?.size || 0,
        diff: diff.lines,
        stats: diff.stats
      }
      artifactSession.changes.unshift(artifact)
      artifactSession.changes = artifactSession.changes.slice(0, MAX_ARTIFACTS)
      timeMachine.recordChange({
        artifact,
        beforeContent: previous?.content || '',
        afterContent: current?.content || ''
      })
      broadcast({ type: 'artifact', artifact, session: publicArtifactSession() })
    }, 350))
  }

  function resetArtifactSession(context = {}) {
    if (context.root && validDirectory(context.root) && path.normalize(context.root) !== root) {
      return setRoot(context.root)
    }
    artifactSession = createArtifactSession({
      id: context.id,
      label: context.label,
      root
    })
    artifactSnapshot = snapshotDocuments(root)
    timeMachine.setContext({
      id: artifactSession.id,
      label: artifactSession.label,
      root
    })
    broadcast({ type: 'artifact-session', session: publicArtifactSession() })
    return true
  }

  function publicArtifactSession() {
    return {
      id: artifactSession.id,
      label: artifactSession.label,
      root: artifactSession.root,
      startedAt: artifactSession.startedAt,
      changes: artifactSession.changes
    }
  }

  function broadcast(message) {
    const payload = `data: ${JSON.stringify(message)}\n\n`
    for (const response of clients) response.write(payload)
  }

  function safeResolve(relativePath) {
    if (!root) return null
    const resolved = path.resolve(root, relativePath)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
      ? resolved
      : null
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')

    if (url.pathname === '/api/root') {
      return sendJson(response, 200, { root, recentRoots })
    }

    if (url.pathname === '/api/tree') {
      if (!root) return sendJson(response, 200, { root: '', tree: emptyTree() })
      try {
        return sendJson(response, 200, { root, tree: scanTree(root, '') })
      } catch (error) {
        return sendJson(response, 500, { error: error.message })
      }
    }

    if (url.pathname === '/api/artifacts') {
      return sendJson(response, 200, publicArtifactSession())
    }

    if (url.pathname === '/api/time-machine') {
      return sendJson(response, 200, timeMachine.getState())
    }

    if (url.pathname === '/api/time-machine/checkpoint') {
      const checkpoint = timeMachine.getCheckpoint(url.searchParams.get('id') || '')
      return checkpoint
        ? sendJson(response, 200, checkpoint)
        : sendJson(response, 404, { error: '时间点不存在' })
    }

    if (url.pathname === '/api/time-machine/fork' && request.method === 'POST') {
      return readJsonBody(request)
        .then(body => sendJson(response, 200, timeMachine.forkCheckpoint(body)))
        .catch(error => sendJson(response, 400, { error: error.message }))
    }

    if (url.pathname === '/api/set-root') {
      const nextRoot = url.searchParams.get('p')?.trim() || ''
      return setRoot(nextRoot)
        ? sendJson(response, 200, { root, recentRoots })
        : sendJson(response, 400, { error: `目录不存在：${nextRoot}` })
    }

    if (url.pathname === '/api/browse') {
      return browseDirectory(response, url.searchParams.get('p')?.trim() || '')
    }

    if (url.pathname === '/api/file') {
      const relativePath = url.searchParams.get('p') || ''
      const absolutePath = safeResolve(relativePath)
      if (!absolutePath) return sendJson(response, 403, { error: '非法文件路径' })
      if (!WATCHED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
        return sendJson(response, 403, { error: '不支持的文件类型' })
      }
      try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是文件')
        if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 10 MB')
        return sendJson(response, 200, {
          path: relativePath,
          name: path.basename(absolutePath),
          ext: path.extname(absolutePath).toLowerCase(),
          content: fs.readFileSync(absolutePath, 'utf8'),
          mtime: stat.mtimeMs,
          size: stat.size
        })
      } catch (error) {
        return sendJson(response, 404, { error: error.message })
      }
    }

    if (url.pathname === '/api/html-preview') {
      const relativePath = url.searchParams.get('p') || ''
      const absolutePath = safeResolve(relativePath)
      const extension = absolutePath ? path.extname(absolutePath).toLowerCase() : ''
      if (!absolutePath) return sendText(response, 403, '非法文件路径')
      if (!['.html', '.htm'].includes(extension)) {
        return sendText(response, 403, '不支持的预览类型')
      }
      try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是文件')
        if (stat.size > MAX_FILE_BYTES) throw new Error('文件超过 10 MB')
        const baseDirectory = normalizeWebPath(path.dirname(relativePath))
        const baseHref = `/api/html-asset/${encodePathSegments(baseDirectory)}${baseDirectory ? '/' : ''}`
        const html = injectPreviewBase(fs.readFileSync(absolutePath, 'utf8'), baseHref)
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': HTML_PREVIEW_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        })
        response.end(html)
      } catch (error) {
        return sendText(response, 404, error.message)
      }
      return
    }

    if (url.pathname.startsWith('/api/html-asset/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/api/html-asset/'.length))
      const absolutePath = safeResolve(relativePath)
      const extension = absolutePath ? path.extname(absolutePath).toLowerCase() : ''
      if (!absolutePath) return sendText(response, 403, '非法资源路径')
      if (!HTML_ASSET_EXTENSIONS.has(extension)) {
        return sendText(response, 403, '不支持的资源类型')
      }
      try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是文件')
        if (stat.size > MAX_ASSET_BYTES) throw new Error('资源超过 20 MB')
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache'
        })
        return fs.createReadStream(absolutePath).pipe(response)
      } catch (error) {
        return sendText(response, 404, error.message)
      }
    }

    if (url.pathname === '/api/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      response.write('retry: 2000\n\n')
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }

    if (url.pathname === '/vendor/marked.min.js') {
      const markedPath = path.join(path.dirname(require.resolve('marked')), 'marked.umd.js')
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return fs.createReadStream(markedPath).pipe(response)
    }

    if (url.pathname === '/vendor/mermaid.min.js') {
      const mermaidPath = path.join(
        path.dirname(require.resolve('mermaid/package.json')),
        'dist',
        'mermaid.min.js'
      )
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return fs.createReadStream(mermaidPath).pipe(response)
    }

    serveStatic(response, url.pathname)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      startWatcher()
      resolve({
        port: server.address().port,
        get root() {
          return root
        },
        setRoot,
        setConversationContext(context) {
          if (context?.root && path.normalize(context.root) !== root) setRoot(context.root)
          const nextId = context?.id || (root ? `workspace:${root.toLowerCase()}` : 'workspace:empty')
          if (artifactSession.id === nextId && artifactSession.root === root) return true
          return resetArtifactSession(context)
        },
        close() {
          watcher?.close()
          clearTimeout(debounceTimer)
          for (const timer of artifactTimers.values()) clearTimeout(timer)
          timeMachine.close()
          for (const client of clients) client.end()
          clients.clear()
          server.close()
        }
      })
    })
  })

  function serveStatic(response, pathname) {
    const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    const absolutePath = path.resolve(PUBLIC_ROOT, requested)
    if (absolutePath !== PUBLIC_ROOT && !absolutePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      response.writeHead(403)
      response.end('forbidden')
      return
    }
    fs.readFile(absolutePath, (error, data) => {
      if (error) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(absolutePath).toLowerCase()]
          || 'application/octet-stream'
      })
      response.end(data)
    })
  }
}

function scanTree(directory, relativePath) {
  const node = {
    name: path.basename(directory),
    path: relativePath,
    type: 'dir',
    children: []
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      try {
        const child = scanTree(absolutePath, childRelativePath)
        if (child.children.length) node.children.push(child)
      } catch {
        // Skip folders that cannot be read.
      }
    } else if (WATCHED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const stat = fs.statSync(absolutePath)
      node.children.push({
        name: entry.name,
        path: childRelativePath,
        type: 'file',
        ext: path.extname(entry.name).toLowerCase(),
        size: stat.size,
        mtime: stat.mtimeMs
      })
    }
  }
  node.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
  return node
}

function emptyTree() {
  return { name: '', path: '', type: 'dir', children: [] }
}

function createArtifactSession({ id, label, root } = {}) {
  return {
    id: id || (root ? `workspace:${root.toLowerCase()}` : 'workspace:empty'),
    label: label || '当前工作区',
    root: root || '',
    startedAt: Date.now(),
    changes: []
  }
}

function snapshotDocuments(root) {
  const snapshot = new Map()
  if (!root) return snapshot
  const visit = (directory, relativeDirectory = '') => {
    let entries = []
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolutePath, relativePath)
      else if (WATCHED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const document = readArtifactDocument(root, relativePath)
        if (document) snapshot.set(relativePath, document)
      }
    }
  }
  visit(root)
  return snapshot
}

function readArtifactDocument(root, relativePath) {
  try {
    const absolutePath = path.resolve(root, relativePath)
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) return null
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_CONTENT_BYTES) return null
    return {
      content: fs.readFileSync(absolutePath, 'utf8'),
      size: stat.size,
      mtime: stat.mtimeMs
    }
  } catch {
    return null
  }
}

function sameArtifactDocument(left, right) {
  if (!left || !right) return left === right
  return left.content === right.content
}

function browseDirectory(response, inputPath) {
  try {
    if (!inputPath) {
      const drives = []
      for (let code = 67; code <= 90; code += 1) {
        const drive = `${String.fromCharCode(code)}:/`
        if (fs.existsSync(drive)) drives.push({ name: drive, path: drive })
      }
      return sendJson(response, 200, { path: '', parent: null, dirs: drives })
    }
    const absolutePath = validDirectory(inputPath)
    if (!absolutePath) throw new Error('目录不存在')
    const dirs = fs.readdirSync(absolutePath, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$'))
      .map(entry => ({ name: entry.name, path: path.join(absolutePath, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    const parent = path.dirname(absolutePath)
    return sendJson(response, 200, {
      path: absolutePath,
      parent: parent === absolutePath ? null : parent,
      dirs
    })
  } catch (error) {
    return sendJson(response, 400, { error: error.message })
  }
}

function validDirectory(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    const resolved = path.resolve(value)
    return fs.statSync(resolved).isDirectory() ? resolved : ''
  } catch {
    return ''
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function sendText(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(String(value))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求内容过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('请求格式无效'))
      }
    })
    request.on('error', reject)
  })
}

function normalizeWebPath(value) {
  return value === '.' ? '' : String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function encodePathSegments(value) {
  return value.split('/').filter(Boolean).map(encodeURIComponent).join('/')
}

function injectPreviewBase(source, baseHref) {
  const withoutBase = source.replace(/<base\b[^>]*>/gi, '')
  const baseTag = `<base href="${baseHref}">`
  if (/<head\b[^>]*>/i.test(withoutBase)) {
    return withoutBase.replace(/<head\b([^>]*)>/i, `<head$1>${baseTag}`)
  }
  return `<!doctype html><html><head>${baseTag}</head><body>${withoutBase}</body></html>`
}

module.exports = { startServer }
