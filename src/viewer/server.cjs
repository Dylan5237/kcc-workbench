const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createLineDiff } = require('./diff.cjs')
const { createTimeMachine } = require('./time-machine.cjs')
const { createWorkspaceObserver } = require('./workspace-observer.cjs')
const {
  WATCHED_EXTENSIONS,
  CODE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  HTML_ASSET_EXTENSIONS,
  isIgnoredRelativePath,
  classifyFileKind,
  isTextFileExtension,
  normalizeWebPath,
  readArtifactDocument
} = require('./workspace-scan.cjs')

const PUBLIC_ROOT = path.join(__dirname, 'public')
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_ARTIFACTS = 100
const MAX_PENDING_ARTIFACT_PATHS = 1000
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

function startServer({ port = 0, configDir, defaultRoot = '', authToken = crypto.randomBytes(32).toString('hex'), onProfile = null, createObserver = null }) {
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
  let debounceTimer = null
  let closed = false
  let watcherGeneration = 0
  let pendingWatcher = null
  const artifactTimers = new Map()
  let artifactSnapshot = new Map()
  let artifactSession = createArtifactSession({ root })
  let burstOverflowed = false
  let currentArmStart = 0
  // 工作区级遍历(基线/恢复/树)全部委托观察运行时: 生产为 worker 线程适配,
  // 测试可经 createObserver 注入假实现并捕获下列 handlers 驱动回调。
  const observerHandlers = {
    onBaseline: applyBaseline,
    onRecovery: handleRecoveryBatch,
    onError: (stage, error) => console.error(`Viewer observation ${stage}:`, error),
    onProfile: onProfile || undefined
  }
  const observer = createObserver
    ? createObserver(observerHandlers)
    : createWorkspaceObserver(observerHandlers)

  function saveState() {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ root, extraRoots, recentRoots }, null, 2))
  }

  // 跟踪在途的 watcher 启动, 使调用方能等待基线就绪; 完成/失败都会清理引用,
  // 错误仍抛给显式 await 的调用方, 后台路径只记录日志, 不会 unhandled rejection。
  function launchWatcher() {
    const run = startWatcher()
    pendingWatcher = run
    run.then(
      () => { if (pendingWatcher === run) pendingWatcher = null },
      error => {
        if (pendingWatcher === run) pendingWatcher = null
        console.error('Viewer watcher startup failed:', error)
      }
    )
    return run
  }

  async function setRoot(nextRoot) {
    const resolved = validDirectory(nextRoot)
    if (!resolved) return false
    if (resolved === root) {
      // 根未变也要保证初始后台扫描的基线已就绪, 否则变更可能静默丢失 (#23)
      if (pendingWatcher) await pendingWatcher
      return true
    }
    root = resolved
    recentRoots = [root, ...recentRoots.filter(item => item !== root)].slice(0, 10)
    extraRoots = []
    saveState()
    // 先武装新根的观察基线(arm 内应用 onBaseline), 再重建产物会话,
    // 保证 resetArtifactSession 读到的 artifactSnapshot 就是新根基线。
    await launchWatcher()
    await resetArtifactSession({
      id: `workspace:${root.toLowerCase()}`,
      label: '当前工作区',
      root
    })
    broadcast({ type: 'root', root })
    return true
  }

  async function startWatcher() {
    const generation = ++watcherGeneration
    watcher?.close()
    watcher = null
    clearTimeout(debounceTimer)
    for (const timer of artifactTimers.values()) clearTimeout(timer)
    artifactTimers.clear()
    burstOverflowed = false
    if (!root) return
    const snapshotStart = performance.now()
    currentArmStart = snapshotStart
    // 基线全量遍历在观察运行时(worker)内完成; arm 解析时 onBaseline 已应用,
    // artifactSnapshot 即为本轮基线 (#19/#23 的等待语义由此保证)。
    await observer.arm({ root, extraRoots })
    if (closed || generation !== watcherGeneration) return  // 扫描期间已被关闭或被更新的 watcher 取代
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
          observer.invalidateTree()
          const extension = path.extname(raw).toLowerCase()
          if (WATCHED_EXTENSIONS.has(extension)) {
            // 文档类变更由 scheduleArtifact 确认内容后统一广播 change + artifact,
            // 保证 fs.watch 与恢复兜底两条路径走同一出口。
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
    onProfile?.('viewer-watcher-ready', `duration=${(performance.now() - snapshotStart).toFixed(1)}ms`)
  }

  function scheduleArtifact(relativePath) {
    if (!artifactTimers.has(relativePath) && artifactTimers.size >= MAX_PENDING_ARTIFACT_PATHS) {
      // 突发溢出路径直接丢弃, 由恢复扫描兜底覆盖并在仅首次记录画像。
      if (!burstOverflowed) {
        burstOverflowed = true
        onProfile?.('viewer-artifact-overflow', `pending=${MAX_PENDING_ARTIFACT_PATHS}`)
      }
      return
    }
    clearTimeout(artifactTimers.get(relativePath))
    artifactTimers.set(relativePath, setTimeout(async () => {
      artifactTimers.delete(relativePath)
      const previous = artifactSnapshot.get(relativePath) || null
      const artifactRoot = rootForPath(relativePath)
      const current = artifactRoot
        ? await readArtifactDocument(artifactRoot, relativePath)
        : null
      if (sameArtifactDocument(previous, current)) {
        // 内容未变时仍刷新 mtime 基线, 否则恢复兜底会因 mtime 差异重复调度
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
      // 恢复兜底路径也经由此处, 两条链路对前端表现一致。
      broadcast({ type: 'change', file: relativePath, kind: 'document' })
      broadcast({ type: 'artifact', artifact, session: publicArtifactSession() })
      observer.invalidateTree()
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

  // 观察运行时(worker)完成一次 arm 的基线后应用: 代际/latest-token 守卫由
  // observer 保证, 这里只挡关闭态; 画像时长从当前 arm 的起点算起。
  function applyBaseline({ documents, stats }) {
    if (closed) return
    artifactSnapshot = documents
    onProfile?.(
      'viewer-snapshot-ready',
      `duration=${(performance.now() - currentArmStart).toFixed(1)}ms entries=${stats.entries} documents=${stats.documents} bytes=${stats.bytes}`
    )
    const truncated = stats.truncated || {}
    if (truncated.entries || truncated.documents || truncated.bytes) {
      const caps = []
      if (truncated.entries) caps.push('entries')
      if (truncated.documents) caps.push('documents')
      if (truncated.bytes) caps.push('bytes')
      onProfile?.('viewer-baseline-truncated', `caps=${caps.join(',')}`)
    }
  }

  // 恢复扫描分片结果: mtime 比对调度确认; 仅完整未截断的扫描才做删除检测;
  // 有实际调度时作废树缓存, 交给 scheduleArtifact 统一出口广播。
  function handleRecoveryBatch({ batch, sweepComplete, scanComplete, seen, stats }) {
    if (!root || closed) return
    let scheduled = 0
    for (const [webPath, stat] of batch) {
      const prev = artifactSnapshot.get(webPath)
      if (!prev || prev.mtime !== stat.mtime) { scheduleArtifact(webPath); scheduled += 1 }
    }
    if (sweepComplete && scanComplete && seen) {
      const seenSet = new Set(seen)
      for (const previousPath of artifactSnapshot.keys()) {
        if (!seenSet.has(previousPath) && rootForPath(previousPath)) { scheduleArtifact(previousPath); scheduled += 1 }
      }
    }
    if (stats && (stats.budgetHit || sweepComplete || stats.durationMs > 500)) {
      onProfile?.(
        'viewer-recovery-slice',
        `duration=${stats.durationMs}ms entries=${stats.entries} budgetHit=${stats.budgetHit || 'none'} sweepComplete=${sweepComplete}`
      )
    }
    if (scheduled > 0) observer.invalidateTree()
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
        const treeStart = performance.now()
        const { tree } = await observer.requestTree({ root, extraRoots, includeAll })
        const treeDuration = performance.now() - treeStart
        if (treeDuration > 500) {
          onProfile?.('viewer-tree-build', `duration=${treeDuration.toFixed(1)}ms`)
        }
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
      onProfile?.('viewer-listener-ready')
      // #19: 服务器就绪不再等待初始快照/监听就绪。HTTP/控制面立即可用,
      // 存储根的初始扫描在后台完成; setRoot/setConversationContext 仍会
      // await 各自 watcher 基线, 正向应用会话根之前不会静默丢变更 (#23)。
      launchWatcher()
      resolve({
        port: server.address().port,
        bootstrapToken: authToken,
        get root() {
          return root
        },
        setRoot,
        // 初始后台 watcher 的就绪句柄: HTTP 面先可用, 需要基线保证的调用方显式等待 (#19)
        whenWatcherReady() {
          return pendingWatcher || Promise.resolve()
        },
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
            await launchWatcher()
            broadcast({ type: 'root', root })
          } else if (pendingWatcher) {
            // 根未变: 等待初始后台扫描的基线就绪后再视为会话已武装 (#23)
            await pendingWatcher
          }
          const nextId = context?.id || (root ? `workspace:${root.toLowerCase()}` : 'workspace:empty')
          if (artifactSession.id === nextId && artifactSession.root === root) return true
          return resetArtifactSession(context)
        },
        async close() {
          closed = true
          watcher?.close()
          clearTimeout(debounceTimer)
          for (const timer of artifactTimers.values()) clearTimeout(timer)
          await observer.close()
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

function sameArtifactDocument(left, right) {
  if (!left || !right) return left === right
  return left.content === right.content
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
