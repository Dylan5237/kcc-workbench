'use strict'

// Pure workspace traversal for the Arckeep Viewer: baseline snapshot,
// cursor-based recovery sweeps, and bounded file-tree builds.
// No timers, no globals, no server state — safe to run in a worker thread.

const fs = require('node:fs')
const path = require('node:path')

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
const MAX_ARTIFACT_CONTENT_BYTES = 512 * 1024
const MAX_SCANNED_ENTRIES = 20_000
const MAX_SNAPSHOT_DOCUMENTS = 2_000
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules', 'dist', 'build', 'coverage', 'out', 'tmp'
])
const TRANSIENT_DIR_PREFIXES = ['tmp-', 'temp-', 'tmp_', 'temp_']
const TRANSIENT_FILE_SUFFIXES = ['.tmp', '.draft.md', '.draft.json', '.draft.html']
const BASELINE_YIELD_INTERVAL = 256

function isTextFileExtension(ext) {
  return WATCHED_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(ext)
}

function classifyFileKind(ext) {
  if (WATCHED_EXTENSIONS.has(ext)) return 'doc'
  if (CODE_EXTENSIONS.has(ext)) return 'code'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  return 'binary'
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

function normalizeWebPath(value) {
  return value === '.' ? '' : String(value).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function isInsidePath(root, target) {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
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

function resolveLimits(limits) {
  return {
    maxScannedEntries: limits?.maxScannedEntries ?? MAX_SCANNED_ENTRIES,
    maxSnapshotDocuments: limits?.maxSnapshotDocuments ?? MAX_SNAPSHOT_DOCUMENTS,
    maxSnapshotBytes: limits?.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES
  }
}

function createWorkspaceScan({ roots, primaryRoot }) {
  const rootEntries = (roots || []).map(root => ({
    root,
    isPrimary: path.normalize(root) === path.normalize(primaryRoot),
    canonicalRoot: '',
    exhausted: false,
    budget: { entries: 0, documents: 0, bytes: 0 }
  }))
  return {
    phase: 'baseline',
    roots: rootEntries,
    queue: rootEntries.map(rootEntry => ({
      dir: rootEntry.root,
      relDir: '',
      root: rootEntry,
      next: 0,
      entries: null
    })),
    head: 0,
    seen: new Set(),
    documents: new Map(),
    stats: { entries: 0, documents: 0, bytes: 0 },
    truncated: { entries: false, documents: false, bytes: false }
  }
}

async function readDocumentFromRoot(rootEntry, absolutePath) {
  try {
    if (!rootEntry.canonicalRoot) {
      rootEntry.canonicalRoot = await fs.promises.realpath(rootEntry.root).catch(() => rootEntry.root)
    }
    const canonicalPath = await fs.promises.realpath(absolutePath)
    if (!isInsidePath(rootEntry.canonicalRoot, canonicalPath)) return null
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

async function scanBaselineDocuments(state, { slice = null, now = () => performance.now(), limits = null, cancelled = null } = {}) {
  const resolved = resolveLimits(limits)
  const start = now()
  const deadline = slice ? start + slice.deadlineMs : Infinity
  const maxSliceEntries = slice?.maxEntries ?? Infinity
  let sliceEntries = 0
  let processedSinceYield = 0
  let stop = false
  let done = true

  while (state.head < state.queue.length) {
    if (cancelled?.()) { done = false; break }
    const item = state.queue[state.head]
    if (item.root.exhausted) { state.head += 1; continue }
    if (sliceEntries >= maxSliceEntries || now() >= deadline) { done = false; break }
    if (item.entries === null) {
      try {
        item.entries = await fs.promises.readdir(item.dir, { withFileTypes: true })
      } catch {
        item.entries = []
      }
    }
    let stopRoot = false
    while (item.next < item.entries.length) {
      if (item.root.budget.entries >= resolved.maxScannedEntries) {
        state.truncated.entries = true
        item.root.exhausted = true
        stopRoot = true
        break
      }
      if (sliceEntries >= maxSliceEntries) { done = false; stop = true; break }
      if (processedSinceYield >= BASELINE_YIELD_INTERVAL) {
        await new Promise(resolve => setImmediate(resolve))
        processedSinceYield = 0
        if (cancelled?.()) { done = false; stop = true; break }
      }
      const entry = item.entries[item.next]
      item.next += 1
      item.root.budget.entries += 1
      state.stats.entries += 1
      sliceEntries += 1
      processedSinceYield += 1
      if (entry.isSymbolicLink()) continue
      if (shouldIgnoreDirectoryEntry(entry)) continue
      const absolutePath = path.join(item.dir, entry.name)
      const relativePath = item.relDir ? `${item.relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        state.queue.push({ dir: absolutePath, relDir: relativePath, root: item.root, next: 0, entries: null })
        continue
      }
      if (!WATCHED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const budget = item.root.budget
      if (budget.documents >= resolved.maxSnapshotDocuments || budget.bytes >= resolved.maxSnapshotBytes) {
        if (budget.documents >= resolved.maxSnapshotDocuments) state.truncated.documents = true
        else state.truncated.bytes = true
        item.root.exhausted = true
        stopRoot = true
        break
      }
      const document = await readDocumentFromRoot(item.root, absolutePath)
      if (document && budget.bytes + document.size <= resolved.maxSnapshotBytes) {
        const pathKey = item.root.isPrimary
          ? normalizeWebPath(relativePath.replace(/\\/g, '/'))
          : normalizeWebPath(absolutePath)
        state.documents.set(pathKey, document)
        budget.documents += 1
        budget.bytes += document.size
        state.stats.documents += 1
        state.stats.bytes += document.size
      } else if (document) {
        state.truncated.bytes = true
      }
    }
    if (stopRoot) { state.head += 1; continue }
    if (stop) { done = false; break }
    state.head += 1
  }

  return {
    done,
    documents: state.documents,
    stats: {
      entries: state.stats.entries,
      documents: state.stats.documents,
      bytes: state.stats.bytes,
      durationMs: now() - start,
      truncated: { ...state.truncated }
    }
  }
}

function initializeSweep(state) {
  state.phase = 'sweep-active'
  state.seen = new Set()
  state.queue = state.roots.map(rootEntry => ({
    dir: rootEntry.root,
    relDir: '',
    root: rootEntry,
    next: 0,
    entries: null
  }))
  state.head = 0
  state.scanComplete = true
}

async function scanRecoverySlice(state, { maxEntries, deadlineMs, now = () => performance.now(), limits = null } = {}) {
  const resolved = resolveLimits(limits)
  if (state.phase !== 'sweep-active') initializeSweep(state)
  const start = now()
  const deadline = start + deadlineMs
  const batch = []
  const stats = { entries: 0, durationMs: 0, budgetHit: '' }

  scan: while (state.head < state.queue.length) {
    if (state.seen.size >= resolved.maxSnapshotDocuments) {
      state.scanComplete = false
      state.queue.splice(state.head)
      break
    }
    if (stats.entries >= maxEntries) { stats.budgetHit = 'entries'; break }
    if (now() >= deadline) { stats.budgetHit = 'deadline'; break }
    const item = state.queue[state.head]
    if (item.entries === null) {
      try {
        item.entries = await fs.promises.readdir(item.dir, { withFileTypes: true })
      } catch {
        state.scanComplete = false
        state.head += 1
        continue
      }
    }
    while (item.next < item.entries.length) {
      if (stats.entries >= maxEntries) { stats.budgetHit = 'entries'; break scan }
      if (state.seen.size >= resolved.maxSnapshotDocuments) {
        state.scanComplete = false
        state.queue.splice(state.head)
        break scan
      }
      const entry = item.entries[item.next]
      item.next += 1
      stats.entries += 1
      if (shouldIgnoreDirectoryEntry(entry)) continue
      const absolutePath = path.join(item.dir, entry.name)
      const relativePath = item.relDir ? `${item.relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        state.queue.push({ dir: absolutePath, relDir: relativePath, root: item.root, next: 0, entries: null })
        continue
      }
      if (!WATCHED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      const webPath = item.root.isPrimary
        ? normalizeWebPath(relativePath.replace(/\\/g, '/'))
        : normalizeWebPath(absolutePath)
      if (isIgnoredRelativePath(webPath)) continue
      state.seen.add(webPath)
      let mtime = 0
      let size = 0
      try {
        const stat = await fs.promises.stat(absolutePath)
        mtime = stat.mtimeMs
        size = stat.size
      } catch {
        // deleted between readdir and stat: report mtime 0 like the old poll
      }
      batch.push([webPath, { mtime, size }])
    }
    state.head += 1
  }

  const sweepComplete = state.head >= state.queue.length
  if (sweepComplete) state.phase = 'sweep-idle'
  stats.durationMs = now() - start
  return {
    batch,
    sweepComplete,
    scanComplete: state.scanComplete,
    seen: sweepComplete ? [...state.seen] : null,
    stats
  }
}

function createIoPool(concurrency) {
  const limit = Math.max(1, concurrency)
  let active = 0
  const waiters = []
  return {
    async run(task) {
      if (active >= limit) await new Promise(resolve => waiters.push(resolve))
      active += 1
      try {
        return await task()
      } finally {
        active -= 1
        const next = waiters.shift()
        if (next) next()
      }
    }
  }
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

async function scanTreeNode(directory, relativePath, budget, includeAll, pool, maxEntries) {
  const node = {
    name: path.basename(directory),
    path: relativePath,
    type: 'dir',
    children: []
  }
  const dirents = await pool.run(() => fs.promises.readdir(directory, { withFileTypes: true }))
  const childDirs = []
  const childFiles = []
  for (const entry of dirents) {
    if (budget.entries >= maxEntries) {
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
      childDirs.push({ absolutePath, childRelativePath })
    } else {
      const ext = path.extname(entry.name).toLowerCase()
      if (!includeAll && !WATCHED_EXTENSIONS.has(ext)) continue
      childFiles.push({ name: entry.name, childRelativePath, absolutePath, ext })
    }
  }
  const childNodes = await Promise.all(childDirs.map(child =>
    scanTreeNode(child.absolutePath, child.childRelativePath, budget, includeAll, pool, maxEntries)
      .catch(() => null)
  ))
  for (const child of childNodes) {
    if (child && child.children.length) node.children.push(child)
  }
  const fileNodes = await Promise.all(childFiles.map(async file => {
    const stat = await pool.run(() => fs.promises.stat(file.absolutePath))
    return {
      name: file.name,
      path: file.childRelativePath,
      type: 'file',
      ext: file.ext,
      kind: includeAll ? classifyFileKind(file.ext) : 'doc',
      size: stat.size,
      mtime: stat.mtimeMs
    }
  }))
  node.children.push(...fileNodes)
  node.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
  return node
}

async function buildWorkspaceTree({ roots, primaryRoot, includeAll = false, maxEntries = MAX_SCANNED_ENTRIES, concurrency = 8, limits = null } = {}) {
  const resolvedMaxEntries = limits?.maxScannedEntries ?? maxEntries
  const pool = createIoPool(concurrency)
  const budget = { entries: 0 }
  const rootList = Array.isArray(roots) ? roots : []
  if (!rootList.length) {
    return { tree: { name: '', path: '', type: 'dir', children: [] }, stats: { entries: 0, truncated: false } }
  }
  const rootNode = await scanTreeNode(primaryRoot, '', budget, includeAll, pool, resolvedMaxEntries)
  for (const extraRoot of rootList) {
    if (path.normalize(extraRoot) === path.normalize(primaryRoot)) continue
    if (budget.entries >= resolvedMaxEntries) {
      rootNode.truncated = true
      break
    }
    const extraNode = await scanTreeNode(extraRoot, '', budget, includeAll, pool, resolvedMaxEntries)
    prefixTreePaths(extraNode, normalizeWebPath(extraRoot))
    rootNode.children.push(extraNode)
  }
  rootNode.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-CN')
  })
  return { tree: rootNode, stats: { entries: budget.entries, truncated: Boolean(rootNode.truncated) } }
}

module.exports = {
  WATCHED_EXTENSIONS,
  CODE_EXTENSIONS,
  IMAGE_EXTENSIONS,
  HTML_ASSET_EXTENSIONS,
  MAX_SCANNED_ENTRIES,
  MAX_SNAPSHOT_DOCUMENTS,
  MAX_SNAPSHOT_BYTES,
  MAX_ARTIFACT_CONTENT_BYTES,
  shouldIgnoreDirectoryEntry,
  isIgnoredRelativePath,
  isIgnoredPathSegment,
  classifyFileKind,
  isTextFileExtension,
  normalizeWebPath,
  readArtifactDocument,
  createWorkspaceScan,
  scanBaselineDocuments,
  scanRecoverySlice,
  buildWorkspaceTree
}
