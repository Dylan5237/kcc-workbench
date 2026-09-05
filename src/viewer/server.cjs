const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createLineDiff } = require('./diff.cjs')
const { createTimeMachine } = require('./time-machine.cjs')

const PUBLIC_ROOT = path.join(__dirname, 'public')
const WATCHED_EXTENSIONS = new Set(['.md', '.json', '.html', '.htm', '.mmd', '.mermaid'])
const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh', '.ps1', '.yml', '.yaml', '.toml', '.xml', '.sql',
  '.java', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.rb', '.php', '.vue',
  '.txt', '.log', '.ini', '.conf'
])
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'
])
const HTML_ASSET_EXTENSIONS = new Set([
  '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf'
])
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_ARTIFACT_CONTENT_BYTES = 512 * 1024
const MAX_ARTIFACTS = 100
const MAX_SCANNED_ENTRIES = 20_000
const MAX_SNAPSHOT_DOCUMENTS = 2_000
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out', 'tmp'
])
const TRANSIENT_DIR_PREFIXES = ['tmp-', 'temp-', 'tmp_', 'temp_']
const TRANSIENT_FILE_SUFFIXES = ['.tmp', '.draft.md', '.draft.json', '.draft.html']
const RESTRICTED_BROWSER_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080
])
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

function startServer({ port = 0, configDir, defaultRoot = '', authToken = crypto.randomBytes(32).toString('hex') }) {
  const configPath = path.join(configDir, 'viewer-config.json')
  const stored = readJson(configPath)
  let root = validDirectory(defaultRoot)
    || validDirectory(stored.root)
    || ''
  let extraRoots = Array.isArray(stored.extraRoots)
    ? stored.extraRoots.filter(validDirectory).slice(0, 20)
    : []
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
  let pollingTimer = null
  let debounceTimer = null
  const artifactTimers = new Map()
  let artifactSnapshot = new Map()
  let artifactSession = createArtifactSession({ root })

  function saveState() {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ root, extraRoots, recentRoots }, null, 2))
  }

  async function setRoot(nextRoot) {
    const resolved = validDirectory(nextRoot)
    if (!resolved) return false
    if (resolved === root) return true
    root = resolved
    recentRoots = [root, ...recentRoots.filter(item => item !== root)].slice(0, 10)
    extraRoots = []
    saveState()
    await resetArtifactSession({
      id: `workspace:${root.toLowerCase()}`,
      label: '当前工作区',
      root
    })
    await startWatcher()
    broadcast({ type: 'root', root })
    return true
  }

  async function startWatcher() {
    watcher?.close()
    watcher = null
    clearInterval(pollingTimer)
    pollingTimer = null
    clearTimeout(debounceTimer)
    for (const timer of artifactTimers.values()) clearTimeout(timer)
    artifactTimers.clear()
    if (!root) return
    artifactSnapshot = await snapshotAllDocuments(root, extraRoots)
    const watchRoots = [root, ...extraRoots]
    const watchers = []
    for (const watchRoot of watchRoots) {
      try {
        const handle = fs.watch(watchRoot, { recursive: true }, (_event, filename) => {
          if (!filename) return
          const raw = String(filename)
          const isMain = path.normalize(watchRoot) === path.normalize(root)
          const openPath = isMain
            ? normalizeWebPath(raw.replace(/\\/g, '/'))
            : normalizeWebPath(path.join(watchRoot, raw))
          if (isIgnoredRelativePath(openPath)) return
          const extension = path.extname(raw).toLowerCase()
          if (WATCHED_EXTENSIONS.has(extension)) {
            // 文档类变更由 scheduleArtifact 确认内容后统一广播 change + artifact,
            // 保证 fs.watch 与轮询兜底两条路径走同一出口。
            scheduleArtifact(openPath)
            return
          }
          const isCode = CODE_EXTENSIONS.has(extension)
          const isAsset = HTML_ASSET_EXTENSIONS.has(extension)
          if (!isCode && !isAsset) return
          clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            broadcast({
              type: 'change',
              file: openPath,
              // asset 优先保持既有语义: html 预览的 css/图片资源变化仍刷新预览
              kind: isAsset ? 'asset' : 'code'
            })
          }, 250)
        })
        watchers.push(handle)
      } catch (error) {
        console.error('Viewer watcher failed:', error)
      }
    }
    watcher = {
      close() {
        for (const handle of watchers) handle.close()
      }
    }
    pollingTimer = setInterval(() => pollArtifactSnapshot(), 3000)
  }

  function scheduleArtifact(relativePath) {
    clearTimeout(artifactTimers.get(relativePath))
    artifactTimers.set(relativePath, setTimeout(async () => {
      artifactTimers.delete(relativePath)
      const previous = artifactSnapshot.get(relativePath) || null
      const artifactRoot = rootForPath(relativePath)
      const current = artifactRoot
        ? await readArtifactDocument(artifactRoot, relativePath)
        : null
      if (sameArtifactDocument(previous, current)) {
        // 内容未变时仍刷新 mtime 基线, 否则轮询兜底会因 mtime 差异每 3s 重复调度
        if (previous && current) artifactSnapshot.set(relativePath, current)
        return
      }
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
      // 先广播 change 驱动文件树/预览刷新, 再广播 artifact 驱动本轮产物;
      // 轮询兜底路径也经由此处, 两条链路对前端表现一致。
      broadcast({ type: 'change', file: relativePath, kind: 'document' })
      broadcast({ type: 'artifact', artifact, session: publicArtifactSession() })
    }, 350))
  }

  async function resetArtifactSession(context = {}) {
    if (context.root && validDirectory(context.root) && path.normalize(context.root) !== root) {
      return setRoot(context.root)
    }
    artifactSession = createArtifactSession({
      id: context.id,
      label: context.label,
      root
    })
    artifactSnapshot = await snapshotAllDocuments(root, extraRoots)
    const sessionState = await timeMachine.setContext({
      id: artifactSession.id,
      label: artifactSession.label,
      root
    })
    // 用持久化检查点回填"本轮产物", 避免应用重启或上下文切换后数量归零;
    // startedAt 对齐时间机器会话, 让界面显示本轮的原始起始时刻。
    if (sessionState?.session?.startedAt) {
      artifactSession.startedAt = sessionState.session.startedAt
    }
    artifactSession.changes = timeMachine.getArtifactChanges(MAX_ARTIFACTS)
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
    const base = rootForPath(relativePath)
    if (!base) return null
    const resolved = path.resolve(base, relativePath)
    if (!isInsidePath(base, resolved)) return null
    try {
      const canonicalBase = fs.realpathSync(base)
      const canonicalTarget = fs.realpathSync(resolved)
      return isInsidePath(canonicalBase, canonicalTarget) ? canonicalTarget : null
    } catch {
      return null
    }
  }

  function pathInScope(relativePath) {
    if (!root) return false
    const base = rootForPath(relativePath)
    if (!base) return false
    const resolved = path.resolve(base, relativePath)
    if (!isInsidePath(base, resolved)) return false
    try {
      const canonicalBase = fs.realpathSync(base)
      const canonicalTarget = fs.realpathSync(resolved)
      return isInsidePath(canonicalBase, canonicalTarget)
    } catch {
      return true
    }
  }

  async function pollArtifactSnapshot() {
    if (!root) return
    const watchRoots = [root, ...extraRoots]
    const seen = new Set()
    let scanComplete = true
    for (const watchRoot of watchRoots) {
      try {
        const scan = (dir, relDir = '') => {
          if (seen.size >= MAX_SNAPSHOT_DOCUMENTS) {
            scanComplete = false
            return
          }
          let entries = []
          try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch {
            scanComplete = false
            return
          }
          for (const entry of entries) {
            if (seen.size >= MAX_SNAPSHOT_DOCUMENTS) {
              scanComplete = false
              return
            }
            if (shouldIgnoreDirectoryEntry(entry)) continue
            const abs = path.join(dir, entry.name)
            const rel = relDir ? `${relDir}/${entry.name}` : entry.name
            if (entry.isDirectory()) { scan(abs, rel); continue }
            const ext = path.extname(entry.name).toLowerCase()
            if (!WATCHED_EXTENSIONS.has(ext)) continue
            const isMain = path.normalize(watchRoot) === path.normalize(root)
            const webPath = isMain ? normalizeWebPath(rel.replace(/\\/g, '/')) : normalizeWebPath(abs)
            if (isIgnoredRelativePath(webPath)) continue
            seen.add(webPath)
            const prev = artifactSnapshot.get(webPath)
            let mtime = 0
            try { mtime = fs.statSync(abs).mtimeMs } catch {}
            if (!prev || prev.mtime !== mtime) scheduleArtifact(webPath)
          }
        }
        scan(watchRoot)
      } catch { /* polling root silent */ }
    }
    if (!scanComplete) return
    for (const previousPath of artifactSnapshot.keys()) {
      if (!seen.has(previousPath) && rootForPath(previousPath)) scheduleArtifact(previousPath)
    }
  }

  function rootForPath(relativePath) {
    if (!root) return null
    if (path.isAbsolute(relativePath)) {
      const normalized = path.normalize(relativePath)
      for (const candidate of [root, ...extraRoots]) {
        if (isInsidePath(candidate, normalized)) return candidate
      }
      return null
    }
    return root
  }

  const server = http.createServer((request, response) => {
    Promise.resolve()
      .then(() => handleRequest(request, response))
      .catch(error => {
        console.error('Viewer request failed:', error)
        if (response.headersSent) response.destroy(error)
        else sendJson(response, 500, { error: 'Viewer 请求处理失败' })
      })
  })

  async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1')
    const expectedHost = `127.0.0.1:${server.address()?.port || port}`
    if (request.headers.host !== expectedHost) {
      return sendJson(response, 403, { error: '非法 Viewer 主机' })
    }
    if (url.pathname === '/' && url.searchParams.get('token')) {
      if (!safeTokenEqual(url.searchParams.get('token'), authToken)) {
        return sendJson(response, 403, { error: 'Viewer 启动凭证无效' })
      }
      response.writeHead(302, {
        Location: '/',
        'Set-Cookie': viewerCookie(authToken)
      })
      return response.end()
    }
    if (url.pathname.startsWith('/api/') && !hasViewerSession(request, authToken)) {
      return sendJson(response, 401, { error: 'Viewer 会话未授权' })
    }

    if (url.pathname === '/api/root') {
      return sendJson(response, 200, { root, extraRoots, recentRoots })
    }

    if (url.pathname === '/api/tree') {
      if (!root) return sendJson(response, 200, { root: '', tree: emptyTree() })
      try {
        const includeAll = url.searchParams.get('mode') === 'dev'
        const tree = await scanAllRoots(root, extraRoots, includeAll)
        return sendJson(response, 200, { root, extraRoots, mode: includeAll ? 'dev' : 'run', tree })
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

    if (url.pathname === '/api/file') {
      const relativePath = url.searchParams.get('p') || ''
      const absolutePath = safeResolve(relativePath)
      if (!absolutePath) {
        if (pathInScope(relativePath)) return sendJson(response, 404, { error: '文件不存在或已被删除' })
        return sendJson(response, 403, { error: '非法文件路径' })
      }
      if (!isTextFileExtension(path.extname(absolutePath).toLowerCase())) {
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
          kind: classifyFileKind(path.extname(absolutePath).toLowerCase()),
          content: fs.readFileSync(absolutePath, 'utf8'),
          mtime: stat.mtimeMs,
          size: stat.size
        })
      } catch (error) {
        return sendJson(response, 404, { error: error.message })
      }
    }

    if (url.pathname === '/api/file-meta') {
      const relativePath = url.searchParams.get('p') || ''
      const absolutePath = safeResolve(relativePath)
      if (!absolutePath) {
        if (pathInScope(relativePath)) return sendJson(response, 404, { error: '文件不存在或已被删除' })
        return sendJson(response, 403, { error: '非法文件路径' })
      }
      try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是文件')
        return sendJson(response, 200, {
          path: relativePath,
          mtime: stat.mtimeMs,
          size: stat.size
        })
      } catch (error) {
        return sendJson(response, 404, { error: error.message })
      }
    }

    if (url.pathname === '/api/raw-file') {
      const relativePath = url.searchParams.get('p') || ''
      const absolutePath = safeResolve(relativePath)
      const extension = absolutePath ? path.extname(absolutePath).toLowerCase() : ''
      if (!absolutePath) return sendText(response, 403, '非法文件路径')
      if (!IMAGE_EXTENSIONS.has(extension)) {
        return sendText(response, 403, '不支持的图片类型')
      }
      try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile()) throw new Error('目标不是文件')
        if (stat.size > MAX_ASSET_BYTES) throw new Error('图片超过 20 MB')
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache'
        })
        return pipeFile(response, absolutePath)
      } catch (error) {
        return sendText(response, 404, error.message)
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
        return pipeFile(response, absolutePath)
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
      return pipeFile(response, markedPath)
    }

    if (url.pathname === '/vendor/mermaid.min.js') {
      const mermaidPath = path.join(
        path.dirname(require.resolve('mermaid/package.json')),
        'dist',
        'mermaid.min.js'
      )
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return pipeFile(response, mermaidPath)
    }

    if (url.pathname === '/vendor/highlight.min.js') {
      const highlightPath = path.join(PUBLIC_ROOT, 'vendor', 'highlight.min.js')
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return pipeFile(response, highlightPath)
    }

    if (url.pathname === '/vendor/purify.min.js') {
      const purifyPath = path.join(
        path.dirname(require.resolve('dompurify')),
        'purify.min.js'
      )
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      return pipeFile(response, purifyPath)
    }

    serveStatic(response, url.pathname)
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    const onListening = async () => {
      if (RESTRICTED_BROWSER_PORTS.has(server.address().port)) {
        server.close(error => {
          if (error) reject(error)
          else server.listen(0, '127.0.0.1', onListening)
        })
        return
      }
      await startWatcher()
      resolve({
        port: server.address().port,
        bootstrapToken: authToken,
        get root() {
          return root
        },
        setRoot,
        forkCheckpoint(input) {
          return timeMachine.forkCheckpoint(input)
        },
        async setConversationContext(context) {
          const nextExtraRoots = Array.isArray(context.extraRoots)
            ? context.extraRoots.filter(validDirectory).slice(0, 20)
            : []
          const rootChanged = context?.root && path.normalize(context.root) !== root
          const extraChanged = JSON.stringify(nextExtraRoots) !== JSON.stringify(extraRoots)
          if (rootChanged) {
            root = path.normalize(context.root)
            recentRoots = [root, ...recentRoots.filter(item => item !== root)].slice(0, 10)
          }
          extraRoots = nextExtraRoots
          if (rootChanged || extraChanged) {
            saveState()
            await startWatcher()
            broadcast({ type: 'root', root })
          }
          const nextId = context?.id || (root ? `workspace:${root.toLowerCase()}` : 'workspace:empty')
          if (artifactSession.id === nextId && artifactSession.root === root) return true
          return resetArtifactSession(context)
        },
        async close() {
          watcher?.close()
          clearTimeout(debounceTimer)
          clearInterval(pollingTimer)
          for (const timer of artifactTimers.values()) clearTimeout(timer)
          await timeMachine.close()
          for (const client of clients) client.end()
          clients.clear()
          server.close()
        }
      })
    }
    server.listen(port, '127.0.0.1', onListening)
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

function isTextFileExtension(ext) {
  return WATCHED_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(ext)
}

function classifyFileKind(ext) {
  if (WATCHED_EXTENSIONS.has(ext)) return 'doc'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'binary'
}

async function scanTree(directory, relativePath, budget = { entries: 0 }, includeAll = false) {
  const node = {
    name: path.basename(directory),
    path: relativePath,
    type: 'dir',
    children: []
  }
  for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
    if (budget.entries >= MAX_SCANNED_ENTRIES) {
      node.truncated = true
      break
    }
    budget.entries += 1
    if (shouldIgnoreDirectoryEntry(entry)) continue
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      try {
        const child = await scanTree(absolutePath, childRelativePath, budget, includeAll)
        if (child.children.length) node.children.push(child)
      } catch {
        // Skip folders that cannot be read.
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (!includeAll && !WATCHED_EXTENSIONS.has(ext)) continue
      const kind = includeAll ? classifyFileKind(ext) : 'doc'
      const stat = await fs.promises.stat(absolutePath)
      node.children.push({
        name: entry.name,
        path: childRelativePath,
        type: 'file',
        ext,
        kind,
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

async function scanAllRoots(primaryRoot, extraRootList, includeAll = false) {
  const budget = { entries: 0 }
  const rootNode = await scanTree(primaryRoot, '', budget, includeAll)
  for (const extraRoot of extraRootList) {
    if (path.normalize(extraRoot) === path.normalize(primaryRoot)) continue
    if (budget.entries >= MAX_SCANNED_ENTRIES) {
      rootNode.truncated = true
      break
    }
    const extraPrefix = normalizeWebPath(extraRoot)
    const extraNode = await scanTree(extraRoot, '', budget, includeAll)
    prefixTreePaths(extraNode, extraPrefix)
    rootNode.children.push(extraNode)
  }
  rootNode.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
  return rootNode
}

function prefixTreePaths(node, prefix) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'file') {
    node.path = node.path ? `${prefix}/${node.path}` : prefix
    return
  }
  if (node.type === 'dir' && node.path !== prefix) {
    node.path = node.path ? `${prefix}/${node.path}` : prefix
  }
  for (const child of node.children || []) prefixTreePaths(child, prefix)
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

async function snapshotAllDocuments(primaryRoot, extraRootsParam = []) {
  const snapshot = new Map()
  const allRoots = [primaryRoot, ...extraRootsParam]
  if (!allRoots.length) return snapshot
  for (const snapshotRoot of allRoots) {
    await snapshotRootDocuments(snapshot, snapshotRoot, path.normalize(snapshotRoot) === path.normalize(primaryRoot))
  }
  return snapshot
}

async function snapshotRootDocuments(snapshot, snapshotRoot, isPrimary) {
  const budget = { entries: 0, documents: 0, bytes: 0 }
  const visit = async (directory, relativeDirectory = '') => {
    let entries = []
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (budget.entries >= MAX_SCANNED_ENTRIES) return
      budget.entries += 1
      if (shouldIgnoreDirectoryEntry(entry)) continue
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolutePath, relativePath)
      else if (WATCHED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (budget.documents >= MAX_SNAPSHOT_DOCUMENTS || budget.bytes >= MAX_SNAPSHOT_BYTES) return
        const document = isPrimary
          ? await readArtifactDocument(snapshotRoot, relativePath)
          : await readArtifactDocument(snapshotRoot, absolutePath)
        if (document && budget.bytes + document.size <= MAX_SNAPSHOT_BYTES) {
          const pathKey = isPrimary ? relativePath : normalizeWebPath(absolutePath)
          snapshot.set(pathKey, document)
          budget.documents += 1
          budget.bytes += document.size
        }
      }
    }
  }
  await visit(snapshotRoot)
}

async function readArtifactDocument(root, relativePath) {
  try {
    const absolutePath = path.isAbsolute(relativePath)
      ? path.normalize(relativePath)
      : path.resolve(root, relativePath)
    if (!isInsidePath(root, absolutePath)) return null
    const canonicalRoot = await fs.promises.realpath(root)
    const canonicalPath = await fs.promises.realpath(absolutePath)
    if (!isInsidePath(canonicalRoot, canonicalPath)) return null
    const stat = await fs.promises.stat(canonicalPath)
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_CONTENT_BYTES) return null
    return {
      content: await fs.promises.readFile(canonicalPath, 'utf8'),
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

function shouldIgnoreDirectoryEntry(entry) {
  const name = entry.name.toLowerCase()
  if (name.startsWith('.')) return true
  if (entry.isDirectory()) {
    return IGNORED_DIRECTORY_NAMES.has(name)
      || TRANSIENT_DIR_PREFIXES.some(prefix => name.startsWith(prefix))
  }
  return isIgnoredPathSegment(name)
}

function isIgnoredRelativePath(relativePath) {
  return normalizeWebPath(relativePath)
    .split('/')
    .some(segment => isIgnoredPathSegment(segment))
}

function isIgnoredPathSegment(segment) {
  const lower = segment.toLowerCase()
  if (lower.startsWith('.')) return true
  if (IGNORED_DIRECTORY_NAMES.has(lower)) return true
  if (TRANSIENT_DIR_PREFIXES.some(prefix => lower.startsWith(prefix))) return true
  if (TRANSIENT_FILE_SUFFIXES.some(suffix => lower.endsWith(suffix))) return true
  if (lower.endsWith('~')) return true
  return false
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

function pipeFile(response, filePath) {
  const stream = fs.createReadStream(filePath)
  stream.once('error', error => {
    if (response.headersSent) response.destroy(error)
    else sendText(response, 404, error.message)
  })
  stream.pipe(response)
}

function isInsidePath(root, target) {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function viewerCookie(token) {
  return `kimi_viewer=${token}; HttpOnly; SameSite=Strict; Path=/`
}

function hasViewerSession(request, token) {
  const cookies = String(request.headers.cookie || '').split(';')
  const value = cookies
    .map(cookie => cookie.trim().split('='))
    .find(([name]) => name === 'kimi_viewer')?.[1]
  return safeTokenEqual(value, token)
}

function safeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer)
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
