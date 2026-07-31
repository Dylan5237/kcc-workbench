const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { createLineDiff } = require('./diff.cjs')

const MAX_SESSIONS = 20
const MAX_CHECKPOINTS = 40
const MAX_PATCH_BYTES = 8 * 1024 * 1024
const MAX_UNTRACKED_BYTES = 10 * 1024 * 1024
const MAX_UNTRACKED_FILE_BYTES = 2 * 1024 * 1024

function createTimeMachine({ configDir, onChange = () => {}, checkpointDelay = 1800 }) {
  const storageDir = path.join(configDir, 'time-machine')
  const storagePath = path.join(storageDir, 'sessions.json')
  let sessions = loadSessions(storagePath)
  let activeSession = null
  let checkpointTimer = null
  let pendingChanges = []
  let operationQueue = Promise.resolve()

  async function setContext(context = {}) {
    await flush()
    const root = validDirectory(context.root)
    if (!root) {
      activeSession = null
      return null
    }
    const id = String(context.id || `workspace:${root.toLowerCase()}`)
    activeSession = sessions.find(session => session.id === id && session.root === root)
    if (!activeSession) {
      activeSession = {
        id,
        label: String(context.label || '当前工作区'),
        root,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        checkpoints: []
      }
      sessions.unshift(activeSession)
      await trimAndSave()
    } else if (context.label) {
      activeSession.label = String(context.label)
      activeSession.updatedAt = Date.now()
      await trimAndSave()
    }
    onChange({ type: 'time-machine-session', state: getState() })
    return getState()
  }

  function recordChange({ artifact, beforeContent = '', afterContent = '' }) {
    if (!activeSession || !artifact) return
    pendingChanges.push({
      ...artifact,
      beforeContent,
      afterContent
    })
    clearTimeout(checkpointTimer)
      checkpointTimer = setTimeout(() => {
        flush().catch(error => console.error('Time machine checkpoint failed:', error))
      }, checkpointDelay)
  }

  function flush() {
    clearTimeout(checkpointTimer)
    checkpointTimer = null
    if (!activeSession || !pendingChanges.length) return Promise.resolve(null)
    const session = activeSession
    const changes = coalesceChanges(pendingChanges)
    pendingChanges = []
    return enqueue(async () => {
      const git = await captureGitState(session.root)
      const checkpoint = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: Date.now(),
        title: checkpointTitle(changes),
        changes,
        git
      }
      session.checkpoints.unshift(checkpoint)
      session.checkpoints = session.checkpoints.slice(0, MAX_CHECKPOINTS)
      session.updatedAt = checkpoint.timestamp
      await trimAndSave()
      onChange({
        type: 'time-machine-checkpoint',
        checkpoint: summarizeCheckpoint(checkpoint),
        state: getState()
      })
      return checkpoint
    })
  }

  function getState() {
    if (!activeSession) {
      return { session: null, checkpoints: [], canFork: false }
    }
    return {
      session: {
        id: activeSession.id,
        label: activeSession.label,
        root: activeSession.root,
        startedAt: activeSession.startedAt,
        updatedAt: activeSession.updatedAt
      },
      checkpoints: activeSession.checkpoints.map(summarizeCheckpoint),
      canFork: activeSession.checkpoints.some(checkpoint => checkpoint.git?.available)
    }
  }

  function getCheckpoint(checkpointId) {
    if (!activeSession) return null
    const checkpoint = activeSession.checkpoints.find(item => item.id === checkpointId)
    if (!checkpoint) return null
    return {
      ...checkpoint,
      git: checkpoint.git
        ? {
            available: checkpoint.git.available,
            repoRoot: checkpoint.git.repoRoot,
            branch: checkpoint.git.branch,
            head: checkpoint.git.head,
            status: checkpoint.git.status,
            error: checkpoint.git.error
          }
        : { available: false }
    }
  }

  function forkCheckpoint({ checkpointId, branchName, targetPath = '' }) {
    const checkpoint = activeSession?.checkpoints.find(item => item.id === checkpointId)
    if (!checkpoint) throw new Error('时间点不存在或不属于当前任务')
    if (!checkpoint.git?.available || !checkpoint.git.head) {
      throw new Error('当前项目不是 Git 仓库，无法创建隔离分支')
    }
    const branch = validateBranchName(branchName)
    const repoRoot = checkpoint.git.repoRoot
    const target = resolveForkTarget(repoRoot, branch, targetPath)
    if (fs.existsSync(target)) throw new Error(`目标目录已存在：${target}`)

    return enqueue(async () => {
      await execGit(repoRoot, ['worktree', 'add', '-b', branch, target, checkpoint.git.head])
      try {
        if (checkpoint.git.patch) {
          await execGit(target, ['apply', '--binary', '-'], {
            input: Buffer.from(checkpoint.git.patch, 'base64')
          })
        }
        restoreUntrackedFiles(target, checkpoint.git.untracked || [])
      } catch (error) {
        throw new Error(`隔离工作区已创建于 ${target}，但恢复改动失败：${error.message}`)
      }
      return { branch, target, checkpointId }
    })
  }

  async function close() {
    await flush()
    await operationQueue
  }

  function enqueue(operation) {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.catch(() => {})
    return result
  }

  async function trimAndSave() {
    sessions = sessions
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS)
    await fs.promises.mkdir(storageDir, { recursive: true })
    const temporaryPath = `${storagePath}.tmp`
    await fs.promises.writeFile(temporaryPath, JSON.stringify({ version: 1, sessions }, null, 2))
    await fs.promises.rename(temporaryPath, storagePath)
  }

  return {
    setContext,
    recordChange,
    flush,
    getState,
    getCheckpoint,
    forkCheckpoint,
    close
  }
}

function coalesceChanges(changes) {
  const byPath = new Map()
  for (const change of changes) {
    const existing = byPath.get(change.path)
    if (!existing) {
      byPath.set(change.path, { ...change })
      continue
    }
    const beforeContent = existing.beforeContent
    const afterContent = change.afterContent
    const diff = createLineDiff(beforeContent, afterContent)
    byPath.set(change.path, {
      ...change,
      beforeContent,
      afterContent,
      diff: diff.lines,
      stats: diff.stats,
      type: deriveChangeType(beforeContent, afterContent)
    })
  }
  return [...byPath.values()].filter(change => change.beforeContent !== change.afterContent)
}

function deriveChangeType(beforeContent, afterContent) {
  if (!beforeContent && afterContent) return 'created'
  if (beforeContent && !afterContent) return 'deleted'
  return 'modified'
}

function checkpointTitle(changes) {
  if (changes.length === 1) {
    const change = changes[0]
    const action = change.type === 'created' ? '新增' : (change.type === 'deleted' ? '删除' : '修改')
    return `${action} ${change.name}`
  }
  return `更新 ${changes.length} 个产物`
}

function summarizeCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    timestamp: checkpoint.timestamp,
    title: checkpoint.title,
    changeCount: checkpoint.changes.length,
    files: checkpoint.changes.map(change => ({
      path: change.path,
      name: change.name,
      type: change.type,
      ext: change.ext,
      stats: change.stats
    })),
    git: {
      available: Boolean(checkpoint.git?.available),
      branch: checkpoint.git?.branch || '',
      head: checkpoint.git?.head || '',
      statusCount: checkpoint.git?.status?.length || 0,
      error: checkpoint.git?.error || ''
    }
  }
}

async function captureGitState(root) {
  let stage = '发现 Git 仓库'
  try {
    const canonicalRoot = canonicalDirectory(root)
    const repoRoot = canonicalDirectory((await execGit(root, ['rev-parse', '--show-toplevel'])).trim())
    const relativeScope = path.relative(repoRoot, canonicalRoot)
    if (relativeScope === '..' || relativeScope.startsWith(`..${path.sep}`) || path.isAbsolute(relativeScope)) {
      throw new Error(`项目目录不在 Git 仓库内：${canonicalRoot}`)
    }
    const scope = normalizeGitPath(relativeScope) || '.'
    stage = '读取 Git HEAD'
    const head = (await execGit(repoRoot, ['rev-parse', 'HEAD'])).trim()
    stage = '读取 Git 分支'
    const branch = (await execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const warnings = []
    let status = []
    try {
      const statusText = await execGit(repoRoot, ['status', '--porcelain=v1', '--', scope])
      status = statusText.split(/\r?\n/).filter(Boolean)
    } catch (error) {
      warnings.push(`读取工作区状态失败：${cleanGitError(error)}`)
    }
    stage = '生成 Git patch'
    const patch = await execGitBuffer(repoRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', scope])
    if (patch.length > MAX_PATCH_BYTES) throw new Error('Git 差异超过 8 MB，未保存可分叉快照')
    let untracked = []
    try {
      untracked = await captureUntrackedFiles(repoRoot, scope)
    } catch (error) {
      warnings.push(`读取未跟踪文件失败：${cleanGitError(error)}`)
    }
    return {
      available: true,
      repoRoot,
      branch,
      head,
      status,
      patch: patch.toString('base64'),
      untracked,
      warnings
    }
  } catch (error) {
    return {
      available: false,
      error: `${stage}失败：${cleanGitError(error)}`
    }
  }
}

async function captureUntrackedFiles(repoRoot, scope) {
  const output = await execGitBuffer(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z', '--', scope]
  )
  const files = []
  let totalBytes = 0
  for (const relativePath of output.toString('utf8').split('\0').filter(Boolean)) {
    const absolutePath = path.resolve(repoRoot, relativePath)
    if (!isInside(repoRoot, absolutePath)) continue
    const stat = await fs.promises.stat(absolutePath)
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) continue
    totalBytes += stat.size
    if (totalBytes > MAX_UNTRACKED_BYTES) break
    const content = await fs.promises.readFile(absolutePath)
    files.push({
      path: normalizeGitPath(relativePath),
      content: content.toString('base64')
    })
  }
  return files
}

function restoreUntrackedFiles(target, files) {
  for (const file of files) {
    const absolutePath = path.resolve(target, file.path)
    if (!isInside(target, absolutePath)) throw new Error(`非法快照路径：${file.path}`)
    ensureSafeWritePath(target, absolutePath)
    fs.writeFileSync(absolutePath, Buffer.from(file.content, 'base64'))
  }
}

function ensureSafeWritePath(root, target) {
  const canonicalRoot = fs.realpathSync(root)
  const relativeDirectory = path.relative(canonicalRoot, path.dirname(target))
  if (relativeDirectory === '..' || relativeDirectory.startsWith(`..${path.sep}`)) {
    throw new Error(`非法快照路径：${target}`)
  }
  let current = canonicalRoot
  for (const segment of relativeDirectory.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`快照路径经过链接或非目录：${current}`)
      }
      if (!isInside(canonicalRoot, fs.realpathSync(current))) {
        throw new Error(`快照路径逃逸目标目录：${current}`)
      }
    } else {
      fs.mkdirSync(current)
    }
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`拒绝覆盖符号链接：${target}`)
  }
}

function resolveForkTarget(repoRoot, branchName, requestedTarget) {
  if (requestedTarget) return path.resolve(requestedTarget)
  const leaf = branchName.split('/').filter(Boolean).pop()
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${leaf}`)
}

function validateBranchName(value) {
  const branch = String(value || '').trim()
  if (
    !branch
    || branch.length > 120
    || branch.startsWith('-')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.includes('..')
    || !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw new Error('分支名仅支持字母、数字、点、横线、下划线和斜杠')
  }
  return branch
}

function execGit(cwd, args, options = {}) {
  return runGit(cwd, args, { ...options, encoding: options.input ? 'buffer' : 'utf8' })
}

function execGitBuffer(cwd, args) {
  return runGit(cwd, args, { encoding: 'buffer' })
}

function runGit(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', cwd, ...args], {
      encoding: options.encoding || 'utf8',
      maxBuffer: MAX_PATCH_BYTES + MAX_UNTRACKED_BYTES + 1024 * 1024,
      windowsHide: true
    }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
    child.stdin.end(options.input)
  })
}

function cleanGitError(error) {
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString('utf8')
    : String(error?.stderr || '')
  return (stderr || error?.message || 'Git 状态不可用').trim().split(/\r?\n/).pop()
}

function normalizeGitPath(value) {
  return String(value || '').replace(/\\/g, '/')
}

function isInside(root, target) {
  const normalizedRoot = path.resolve(root)
  const normalizedTarget = path.resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)
}

function validDirectory(value) {
  try {
    const resolved = path.resolve(String(value || ''))
    return fs.statSync(resolved).isDirectory() ? resolved : ''
  } catch {
    return ''
  }
}

function canonicalDirectory(value) {
  const resolved = path.resolve(String(value || ''))
  return fs.realpathSync.native(resolved)
}

function loadSessions(storagePath) {
  try {
    const stored = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
    return Array.isArray(stored.sessions) ? stored.sessions : []
  } catch {
    return []
  }
}

module.exports = {
  createTimeMachine,
  captureGitState,
  ensureSafeWritePath,
  validateBranchName
}
