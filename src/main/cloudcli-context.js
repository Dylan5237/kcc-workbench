import os from 'node:os'
import path from 'node:path'
import { promises as fs, statSync } from 'node:fs'

const SESSION_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig
const MAX_TAIL_BYTES = 256 * 1024
const MAX_TOUCHED_BYTES = 2 * 1024 * 1024
const MAX_TOUCHED_PATHS = 30
const TOUCH_PATH_KEYS = new Set(['file_path', 'file_path_with_numeric_suffix', 'filePath'])
const WRITE_TOOL_NAMES = new Set([
  'Edit', 'Write', 'NotebookEdit', 'MultiEdit',
  'create_file', 'write_file', 'apply_patch', 'str_replace_editor'
])

export class CloudCliContextMonitor {
  constructor({ homeDirectory = os.homedir(), sessionRoots, maxTailBytes = MAX_TAIL_BYTES } = {}) {
    this.sessionRoots = sessionRoots || [
      { provider: 'claude', directory: path.join(homeDirectory, '.claude', 'projects') },
      { provider: 'codex', directory: path.join(homeDirectory, '.codex', 'sessions') }
    ]
    this.maxTailBytes = maxTailBytes
    this.lastSignature = ''
    this.lastContext = null
  }

  async detect() {
    const candidate = await findMostRecentlyActiveSession(this.sessionRoots)
    if (!candidate) return this.lastContext

    const signature = `${candidate.filePath}\0${candidate.mtimeMs}\0${candidate.size}`
    if (signature === this.lastSignature) return this.lastContext

    const context = await readSessionContext(candidate, this.maxTailBytes)
    this.lastSignature = signature
    if (context?.projectDirectory) this.lastContext = context
    return this.lastContext
  }
}

const defaultMonitor = new CloudCliContextMonitor()

export function detectCloudCliContext() {
  return defaultMonitor.detect()
}

export function parseCloudCliSessionId(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    const match = `${url.pathname}${url.hash}`.match(/(?:^|\/)session\/([^/?#]+)/i)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

export function extractCloudCliSessionContext(payload, routeSessionId) {
  const details = payload?.data?.session || payload?.data || payload?.session || payload
  if (!details || typeof details !== 'object') return null
  const project = details.project && typeof details.project === 'object' ? details.project : null
  const projectDirectory = project?.fullPath
    || project?.path
    || details.projectPath
    || details.project_path
  if (typeof projectDirectory !== 'string' || !projectDirectory.trim()) return null
  return {
    sessionId: details.sessionId || details.session_id || routeSessionId || null,
    provider: details.provider || null,
    projectDirectory: path.normalize(projectDirectory.trim()),
    source: 'cloudcli-route'
  }
}

export async function findMostRecentlyActiveSession(sessionRoots) {
  let latest = null
  for (const root of sessionRoots) {
    for (const filePath of await listJsonlFiles(root.directory)) {
      try {
        const stat = await fs.stat(filePath)
        if (!latest || stat.mtimeMs > latest.mtimeMs || (
          stat.mtimeMs === latest.mtimeMs && stat.size > latest.size
        )) {
          latest = { provider: root.provider, filePath, mtimeMs: stat.mtimeMs, size: stat.size }
        }
      } catch {
        // Session files can disappear while CloudCLI rotates or deletes them.
      }
    }
  }
  return latest
}

export async function readSessionContext(candidate, maxTailBytes = MAX_TAIL_BYTES) {
  let sessionId = sessionIdFromPath(candidate.filePath)
  const parse = async text => {
    for (const line of text.split(/\r?\n/).reverse()) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        const cwd = findStringField(record, new Set(['cwd', 'work_dir', 'project_path']))
        sessionId ||= findStringField(record, new Set(['sessionid', 'session_id']))
        if (!cwd) continue
        const projectDirectory = await existingDirectory(cwd)
        if (!projectDirectory) continue
        return {
          sessionId: sessionId || path.basename(candidate.filePath, path.extname(candidate.filePath)),
          provider: candidate.provider,
          projectDirectory,
          sourcePath: candidate.filePath
        }
      } catch {
        // An actively written JSONL can contain a partial record at a read boundary.
      }
    }
    return null
  }

  const tailContext = await parse(await readFileTail(candidate.filePath, maxTailBytes))
  if (tailContext) return withTouchedPaths(tailContext, candidate.filePath)
  if ((candidate.size || 0) <= maxTailBytes) return null
  const headContext = await parse(await readFileHead(candidate.filePath, maxTailBytes))
  return headContext ? withTouchedPaths(headContext, candidate.filePath) : null
}

async function withTouchedPaths(context, filePath) {
  if (!context?.projectDirectory) return context
  const touchedPaths = await collectTouchedPaths(filePath, context.projectDirectory)
  return touchedPaths.length ? { ...context, touchedPaths } : context
}

async function collectTouchedPaths(filePath, projectDirectory, maxBytes = MAX_TOUCHED_BYTES) {
  const paths = []
  const seenObjects = new Set()
  const seenPaths = new Set()
  const addCandidate = raw => {
    if (typeof raw !== 'string' || !raw.trim()) return
    const candidate = raw.trim()
    if (!path.isAbsolute(candidate)) return
    const key = candidate.toLowerCase()
    if (seenPaths.has(key)) return
    seenPaths.add(key)
    try {
      const stat = statSync(candidate)
      if (!stat.isFile() && !stat.isDirectory()) return
    } catch {
      return
    }
    if (projectDirectory && isInside(projectDirectory, candidate)) return
    if (paths.length >= MAX_TOUCHED_PATHS) return
    paths.push(path.normalize(candidate))
  }
  const collect = value => {
    if (!value || typeof value !== 'object' || seenObjects.has(value)) return
    seenObjects.add(value)
    if (Array.isArray(value)) {
      for (const item of value) collect(item)
      return
    }
    if (
      value?.type === 'tool_use'
      && WRITE_TOOL_NAMES.has(value.name)
      && typeof value.input?.file_path === 'string'
    ) {
      addCandidate(value.input.file_path)
    }
    for (const key of TOUCH_PATH_KEYS) {
      if (typeof value[key] === 'string') addCandidate(value[key])
    }
    for (const item of Object.values(value)) collect(item)
  }
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    for (const line of buffer.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        collect(JSON.parse(line))
      } catch {
        // A session can end with a partial record at a read boundary.
      }
    }
  } finally {
    await handle.close()
  }
  return paths
}

async function listJsonlFiles(directory) {
  const files = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(filePath)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) files.push(filePath)
    }
  }
  return files
}

async function readFileTail(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, stat.size - length)
    let text = buffer.toString('utf8')
    if (stat.size > length) {
      const firstBreak = text.indexOf('\n')
      text = firstBreak >= 0 ? text.slice(firstBreak + 1) : ''
    }
    return text
  } finally {
    await handle.close()
  }
}

async function readFileHead(filePath, maxBytes) {
  const handle = await fs.open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

function findStringField(value, names, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringField(item, names, seen)
      if (found) return found
    }
    return null
  }
  for (const [key, item] of Object.entries(value)) {
    if (names.has(key.toLowerCase()) && typeof item === 'string' && item.trim()) return item.trim()
  }
  for (const item of Object.values(value)) {
    const found = findStringField(item, names, seen)
    if (found) return found
  }
  return null
}

function sessionIdFromPath(filePath) {
  const matches = path.basename(filePath).match(SESSION_ID_PATTERN)
  return matches?.at(-1) || null
}

function isInside(root, target) {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot
    || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

async function existingDirectory(value) {
  try {
    const stat = await fs.stat(value)
    if (stat.isDirectory()) return path.normalize(value)
    if (stat.isFile()) return path.dirname(path.normalize(value))
  } catch {
    // Stale sessions can point at deleted workspaces.
  }
  return null
}
