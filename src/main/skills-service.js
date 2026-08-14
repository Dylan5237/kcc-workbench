import path from 'node:path'
import { promises as fs } from 'node:fs'
import os from 'node:os'

export const ENGINES = Object.freeze(['kimi', 'claude', 'codex'])
export const SYNC_METHODS = Object.freeze(['auto', 'symlink', 'copy'])
export const ENGINE_DIRS = Object.freeze({
  kimi: null,
  claude: ['~', '.claude', 'skills'],
  codex: ['~', '.agents', 'skills']
})

const DEFAULT_APPS = () => ({ kimi: true, claude: true, codex: true })

function normalizeApps(apps) {
  const result = { kimi: false, claude: false, codex: false }
  for (const key of ENGINES) result[key] = Boolean(apps?.[key])
  return result
}

function ensureAtLeastOneEnabled(apps) {
  const enabled = ENGINES.some(key => apps[key])
  if (!enabled) apps.kimi = true
  return apps
}

function sanitizeName(name) {
  if (!name || name.length > 120) return null
  if (name.includes('/') || name.includes('\\')) return null
  if (name === '.' || name === '..') return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

export function withMinimumOneEnabled(apps) {
  return ensureAtLeastOneEnabled(normalizeApps(apps))
}

function resolveHome(homePath) {
  return path.resolve(homePath || os.homedir())
}

function engineTargetDir(engine, homePath, override = {}) {
  const rel = override?.[engine] || ENGINE_DIRS[engine]
  if (!rel) return null
  if (Array.isArray(rel)) return path.join(resolveHome(homePath), ...rel.slice(1))
  return path.resolve(rel)
}

async function fileExists(filePath) {
  try { return (await fs.stat(filePath)).isFile() } catch { return false }
}
async function dirExists(filePath) {
  try { return (await fs.stat(filePath)).isDirectory() } catch { return false }
}
async function isSymlink(filePath) {
  try { return (await fs.lstat(filePath)).isSymbolicLink() } catch { return false }
}

async function readManifest(skillDir) {
  const manifestPath = path.join(skillDir, 'SKILL.md')
  if (!(await fileExists(manifestPath))) return null
  let text = ''
  try { text = await fs.readFile(manifestPath, 'utf8') } catch { text = '' }
  return { manifestPath, text }
}

function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { name: '', description: '' }
  const end = text.indexOf('\n---', 4)
  const block = end === -1 ? '' : text.slice(4, end)
  let name = ''
  let description = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('name:')) name = line.slice(5).trim().replace(/^["']|["']$/g, '')
    if (line.startsWith('description:')) description = line.slice(12).trim().replace(/^["']|["']$/g, '')
  }
  return { name, description }
}

/**
 * 从全局库读取管理状态与各引擎诊断。
 * override：可选 { claude, codex } 自定义投影目标目录（供测试/高级配置）。
 */
export async function loadSkillsState({ libraryPath, homePath, override, syncMethods = {} }) {
  const ssotDir = path.resolve(libraryPath)
  const managed = []
  let entries = []
  try {
    entries = await fs.readdir(ssotDir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillDir = path.join(ssotDir, entry.name)
    const manifest = await readManifest(skillDir)
    if (!manifest) continue
    const front = parseFrontmatter(manifest.text)
    managed.push({
      name: entry.name,
      nameFromManifest: front.name || entry.name,
      description: front.description || '',
      directory: skillDir,
      apps: DEFAULT_APPS()
    })
  }
  managed.sort((a, b) => a.name.localeCompare(b.name))
  return {
    libraryPath: ssotDir,
    managed,
    diagnostics: buildDiagnostics(managed, { homePath, override, syncMethods })
  }
}

function buildDiagnostics(managed, { homePath, override, syncMethods }) {
  return {
    kimi: {
      method: 'pointer',
      directory: null,
      enabled: managed.filter(s => s.apps.kimi).length,
      status: 'ok',
      error: null
    },
    claude: buildEngineDiagnostic(managed, 'claude', { homePath, override, syncMethods }),
    codex: buildEngineDiagnostic(managed, 'codex', { homePath, override, syncMethods })
  }
}

function buildEngineDiagnostic(managed, engine, { homePath, override, syncMethods }) {
  const dir = engineTargetDir(engine, homePath, override)
  const enabled = managed.filter(s => s.apps[engine]).length
  const method = syncMethods?.[engine] || 'auto'
  return {
    method: SYNC_METHODS.includes(method) ? method : 'auto',
    directory: dir,
    enabled,
    status: 'ok',
    error: null
  }
}

/**
 * 把本地 skill 目录加入全局库（仅含 SKILL.md 的目录；拒绝覆盖）。
 */
export async function addSkillToLibrary({ libraryPath, sourceDir }) {
  const ssotDir = path.resolve(libraryPath)
  const resolvedSource = path.resolve(sourceDir)
  const manifest = await readManifest(resolvedSource)
  if (!manifest) throw new Error(`不是有效 Skill：缺少 SKILL.md（${sourceDir}）`)
  const name = path.basename(resolvedSource)
  if (!sanitizeName(name)) throw new Error(`无效的 Skill 名称：${name}`)
  const destDir = path.join(ssotDir, name)
  if (await dirExists(destDir)) throw new Error(`全局库已存在同名 Skill：${name}`)
  await fs.mkdir(ssotDir, { recursive: true })
  const tmpDir = path.join(ssotDir, `.${name}.tmp-${process.pid}-${Date.now()}`)
  try {
    await fs.cp(resolvedSource, tmpDir, { recursive: true })
    if (!(await readManifest(tmpDir))) throw new Error('源 Skill 缺少 SKILL.md')
    await fs.rename(tmpDir, destDir)
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  const addedManifest = await readManifest(destDir)
  const front = parseFrontmatter(addedManifest?.text || '')
  return {
    name,
    nameFromManifest: front.name || name,
    description: front.description || '',
    directory: destDir,
    apps: DEFAULT_APPS()
  }
}

async function linkPointsTo(source, linkPath) {
  try {
    const target = await fs.readlink(linkPath)
    const absolute = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target)
    return path.resolve(absolute) === path.resolve(source)
  } catch {
    return false
  }
}

async function removePath(target) {
  if (await isSymlink(target)) {
    await fs.unlink(target)
    return
  }
  try { await fs.rm(target, { recursive: true, force: false }) } catch (e) { if (e.code !== 'ENOENT') throw e }
}

async function copyReplace(source, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const tmpDir = `${dest}.tmp-${process.pid}-${Date.now()}`
  await fs.cp(source, tmpDir, { recursive: true })
  try {
    await removePath(dest)
    await fs.rename(tmpDir, dest)
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/**
 * 投影单个 skill 到单引擎目标目录。
 * - Kimi：指针，无目录操作
 * - auto：优先 symlink，失败回退 copy
 * - 目标已有用户手工真实目录 → 不覆盖，返回 conflict
 */
export async function syncToEngine({ libraryPath, skillName, engine, homePath, override, method, force = false }) {
  const ssotDir = path.resolve(libraryPath)
  const source = path.join(ssotDir, skillName)
  if (!(await readManifest(source))) throw new Error(`Skill 源缺失：${skillName}`)

  const target = engineTargetDir(engine, homePath, override)
  if (!target) return { ok: true, method: 'pointer' }

  await fs.mkdir(target, { recursive: true })
  const dest = path.join(target, skillName)
  const existingDir = await dirExists(dest)
  const existingLink = await isSymlink(dest)
  const isSelfLink = existingLink && await linkPointsTo(source, dest)

  if (existingDir && !existingLink && !force) {
    return { ok: false, conflict: true, error: `目标已存在同名目录：${dest}` }
  }

  const resolvedMethod = SYNC_METHODS.includes(method) ? method : 'auto'
  if (resolvedMethod === 'copy') {
    await copyReplace(source, dest)
    return { ok: true, method: 'copy' }
  }

  // auto / symlink：先尝试软链
  try {
    if (existingLink) await removePath(dest)
    await fs.symlink(source, dest)
    return { ok: true, method: 'symlink' }
  } catch {
    await copyReplace(source, dest)
    return { ok: true, method: 'copy', fallback: true }
  }
}

/**
 * 同步 skill 到所有启用引擎；返回每引擎结果。
 */
export async function syncSkillToEngines({ libraryPath, skillName, apps, homePath, override, syncMethods }) {
  const results = {}
  for (const engine of ENGINES) {
    if (!apps?.[engine]) continue
    try {
      results[engine] = await syncToEngine({
        libraryPath,
        skillName,
        engine,
        homePath,
        override,
        method: syncMethods?.[engine]
      })
    } catch (error) {
      results[engine] = { ok: false, error: error.message }
    }
  }
  return results
}

export async function backupSkill({ libraryPath, skillName, backupDir }) {
  const source = path.join(path.resolve(libraryPath), skillName)
  if (!(await dirExists(source))) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(path.resolve(backupDir), `${skillName}-${stamp}`)
  await fs.mkdir(dest, { recursive: true })
  await fs.cp(source, dest, { recursive: true })
  return dest
}

/**
 * 移除 skill：先备份，再从启用引擎投影目录移除自建项，最后删除 SSOT 项。
 */
export async function removeSkill({ libraryPath, skillName, homePath, override, backupDir, apps }) {
  const backupPath = await backupSkill({ libraryPath, skillName, backupDir })
  const removal = {}
  for (const engine of ENGINES) {
    if (!apps?.[engine]) continue
    const target = engineTargetDir(engine, homePath, override)
    if (!target) continue
    const dest = path.join(target, skillName)
    try {
      if (await isSymlink(dest)) {
        await fs.unlink(dest)
        removal[engine] = 'removed'
      } else {
        const selfLink = await linkPointsTo(dest, dest)
        if (await dirExists(dest) && selfLink) await fs.rm(dest, { recursive: true, force: false })
        removal[engine] = 'removed'
      }
    } catch (error) {
      removal[engine] = `移除失败：${error.message}`
    }
  }
  await fs.rm(path.join(path.resolve(libraryPath), skillName), { recursive: true, force: true })
  return { backupPath, removal }
}

export const __testing = {
  sanitizeName,
  parseFrontmatter,
  resolveHome,
  engineTargetDir,
  linkPointsTo,
  buildDiagnostics
}
