const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PUBLIC_ROOT = path.join(__dirname, 'public')
const WATCHED_EXTENSIONS = new Set(['.md', '.json'])
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

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
  let watcher = null
  let debounceTimer = null

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
    startWatcher()
    broadcast({ type: 'root', root })
    return true
  }

  function startWatcher() {
    watcher?.close()
    watcher = null
    clearTimeout(debounceTimer)
    if (!root) return
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename || !WATCHED_EXTENSIONS.has(path.extname(filename).toLowerCase())) return
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          broadcast({
            type: 'change',
            file: String(filename).replace(/\\/g, '/')
          })
        }, 250)
      })
    } catch (error) {
      console.error('Viewer watcher failed:', error)
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
        close() {
          watcher?.close()
          clearTimeout(debounceTimer)
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

module.exports = { startServer }
