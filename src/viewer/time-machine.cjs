const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
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

  function setContext(context = {}) {
    flush()
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
      trimAndSave()
    } else if (context.label) {
      activeSession.label = String(context.label)
      activeSession.updatedAt = Date.now()
      trimAndSave()
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
    checkpointTimer = setTimeout(flush, checkpointDelay)
  }

  function flush() {
    clearTimeout(checkpointTimer)
    checkpointTimer = null
    if (!activeSession || !pendingChanges.length) return null
    const changes = coalesceChanges(pendingChanges)
    pendingChanges = []
    const git = captureGitState(activeSession.root)
    const checkpoint = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      title: checkpointTitle(changes),
      changes,
      git
    }
    activeSession.checkpoints.unshift(checkpoint)
    activeSession.checkpoints = activeSession.checkpoints.slice(0, MAX_CHECKPOINTS)
    activeSession.updatedAt = checkpoint.timestamp
    trimAndSave()
    onChange({
      type: 'time-machine-checkpoint',
      checkpoint: summarizeCheckpoint(checkpoint),
      state: getState()
    })
    return checkpoint
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

    execGit(repoRoot, ['worktree', 'add', '-b', branch, target, checkpoint.git.head])
    try {
      if (checkpoint.git.patch) {
        execGit(target, ['apply', '--binary', '-'], {
          input: Buffer.from(checkpoint.git.patch, 'base64')
        })
      }
      restoreUntrackedFiles(target, checkpoint.git.untracked || [])
    } catch (error) {
      throw new Error(`隔离工作区已创建于 ${target}，但恢复改动失败：${error.message}`)
    }
    return { branch, target, checkpointId }
  }

  function close() {
    flush()
  }

  function trimAndSave() {
    sessions = sessions
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS)
    fs.mkdirSync(storageDir, { recursive: true })
    const temporaryPath = `${storagePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, sessions }, null, 2))
    fs.renameSync(temporaryPath, storagePath)
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

function captureGitState(root) {
  try {
    const repoRoot = execGit(root, ['rev-parse', '--show-toplevel']).trim()
    const scope = normalizeGitPath(path.relative(repoRoot, root)) || '.'
    const head = execGit(repoRoot, ['rev-parse', 'HEAD']).trim()
    const branch = execGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    const statusText = execGit(repoRoot, ['status', '--porcelain=v1', '--', scope])
    const patch = execGitBuffer(repoRoot, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--', scope])
    if (patch.length > MAX_PATCH_BYTES) throw new Error('Git 差异超过 8 MB，未保存可分叉快照')
    const untracked = captureUntrackedFiles(repoRoot, scope)
    return {
      available: true,
      repoRoot,
      branch,
      head,
      status: statusText.split(/\r?\n/).filter(Boolean),
      patch: patch.toString('base64'),
      untracked
    }
  } catch (error) {
    return {
      available: false,
      error: cleanGitError(error)
    }
  }
}

function captureUntrackedFiles(repoRoot, scope) {
  const output = execGitBuffer(
    repoRoot,
    ['ls-files', '--others', '--exclude-standard', '-z', '--', scope]
  )
  const files = []
  let totalBytes = 0
  for (const relativePath of output.toString('utf8').split('\0').filter(Boolean)) {
    const absolutePath = path.resolve(repoRoot, relativePath)
    if (!isInside(repoRoot, absolutePath)) continue
    const stat = fs.statSync(absolutePath)
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) continue
    totalBytes += stat.size
    if (totalBytes > MAX_UNTRACKED_BYTES) break
    files.push({
      path: normalizeGitPath(relativePath),
      content: fs.readFileSync(absolutePath).toString('base64')
    })
  }
  return files
}

function restoreUntrackedFiles(target, files) {
  for (const file of files) {
    const absolutePath = path.resolve(target, file.path)
    if (!isInside(target, absolutePath)) throw new Error(`非法快照路径：${file.path}`)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, Buffer.from(file.content, 'base64'))
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
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: options.input ? undefined : 'utf8',
    input: options.input,
    maxBuffer: MAX_PATCH_BYTES + MAX_UNTRACKED_BYTES + 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
}

function execGitBuffer(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'buffer',
    maxBuffer: MAX_PATCH_BYTES + MAX_UNTRACKED_BYTES + 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
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
  validateBranchName
}
