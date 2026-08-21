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
const PROJECTION_MARKER = '.kcc-workbench-projection.json'

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

/**
 * 合并配置中的 managed 条目与一次性 UI 覆盖。
 * managed 兼容两种形状：{ apps: { ... } } 和扁平引擎矩阵。
 */
export function mergeSkillApps(managedEntry, override = {}) {
  const storedApps = managedEntry?.apps && typeof managedEntry.apps === 'object'
    ? managedEntry.apps
    : managedEntry
  return withMinimumOneEnabled({ ...(storedApps || {}), ...(override || {}) })
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

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath)
    return true
  } catch {
    return false
  }
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
export async function loadSkillsState({ libraryPath, homePath, override, syncMethods = {}, managedConfig = {} }) {
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
      apps: withMinimumOneEnabled(managedConfig?.[entry.name]?.apps || DEFAULT_APPS())
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
    await fs.writeFile(path.join(tmpDir, PROJECTION_MARKER), JSON.stringify({
      source: path.resolve(source),
      skillName: path.basename(source),
      version: 1
    }), 'utf8')
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
  if (!sanitizeName(skillName)) throw new Error(`无效的 Skill 名称：${skillName}`)
  const ssotDir = path.resolve(libraryPath)
  const source = path.join(ssotDir, skillName)
  if (!(await readManifest(source))) throw new Error(`Skill 源缺失：${skillName}`)

  const target = engineTargetDir(engine, homePath, override)
  if (!target) return { ok: true, method: 'pointer' }

  await fs.mkdir(target, { recursive: true })
  const dest = path.join(target, skillName)
  const resolvedMethod = SYNC_METHODS.includes(method) ? method : 'auto'
  const existingPath = await pathExists(dest)
  const existingDir = await dirExists(dest)
  const existingLink = await isSymlink(dest)
  const isSelfLink = existingLink && await linkPointsTo(source, dest)
  const isOwnedCopy = existingDir && await projectionMarkerMatches(dest, source, skillName)

  if (existingPath && !force && !existingLink && !isOwnedCopy) {
    return { ok: false, conflict: true, error: `目标已存在同名路径：${dest}` }
  }
  if (existingLink && !isSelfLink && !force) {
    return { ok: false, conflict: true, error: `目标是非 Workbench 链接：${dest}` }
  }
  if (existingLink && isSelfLink && resolvedMethod !== 'copy') {
    return { ok: true, method: 'symlink', reused: true }
  }

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
 * 按启用矩阵同步 skill；停用引擎也会清理 Workbench 自有投影。
 */
export async function syncSkillToEngines({ libraryPath, skillName, apps, homePath, override, syncMethods }) {
  const results = {}
  for (const engine of ENGINES) {
    try {
      if (apps?.[engine]) {
        results[engine] = await syncToEngine({
          libraryPath,
          skillName,
          engine,
          homePath,
          override,
          method: syncMethods?.[engine]
        })
      } else {
        results[engine] = await removeOwnedProjection({
          libraryPath,
          skillName,
          engine,
          homePath,
          override
        })
      }
    } catch (error) {
      results[engine] = { ok: false, error: error.message }
    }
  }
  return results
}

export async function backupSkill({ libraryPath, skillName, backupDir }) {
  if (!sanitizeName(skillName)) throw new Error(`无效的 Skill 名称：${skillName}`)
  const source = path.join(path.resolve(libraryPath), skillName)
  if (!(await dirExists(source))) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(path.resolve(backupDir), `${skillName}-${stamp}`)
  await fs.mkdir(dest, { recursive: true })
  await fs.cp(source, dest, { recursive: true })
  return dest
}

async function projectionMarkerMatches(dest, source, skillName) {
  try {
    const marker = JSON.parse(await fs.readFile(path.join(dest, PROJECTION_MARKER), 'utf8'))
    return marker?.version === 1
      && marker.skillName === skillName
      && path.resolve(marker.source || '') === path.resolve(source)
  } catch {
    return false
  }
}

/**
 * 删除指定引擎中由 Workbench 创建的投影；用户自有路径一律冲突返回。
 */
async function removeOwnedProjection({ libraryPath, skillName, engine, homePath, override }) {
  if (!sanitizeName(skillName)) throw new Error(`无效的 Skill 名称：${skillName}`)
  const source = path.join(path.resolve(libraryPath), skillName)
  const target = engineTargetDir(engine, homePath, override)
  if (!target) return { ok: true, method: 'pointer', removed: false }
  const dest = path.join(target, skillName)
  if (!(await pathExists(dest))) return { ok: true, method: 'none', removed: false }
  if (await isSymlink(dest)) {
    if (!(await linkPointsTo(source, dest))) {
      return { ok: false, conflict: true, error: `未删除非 Workbench 链接：${dest}` }
    }
    await fs.unlink(dest)
    return { ok: true, method: 'symlink', removed: true }
  }
  if (await dirExists(dest)) {
    if (!(await projectionMarkerMatches(dest, source, skillName))) {
      return { ok: false, conflict: true, error: `未删除用户目录：${dest}` }
    }
    await fs.rm(dest, { recursive: true, force: false })
    return { ok: true, method: 'copy', removed: true }
  }
  return { ok: false, conflict: true, error: `未删除用户路径：${dest}` }
}

export async function restoreSkill({ libraryPath, skillName, backupDir, backupPath }) {
  if (!sanitizeName(skillName)) throw new Error(`无效的 Skill 名称：${skillName}`)
  const root = path.resolve(backupDir)
  const source = path.resolve(backupPath)
  if (source !== root && !source.startsWith(`${root}${path.sep}`)) {
    throw new Error('备份路径不在 Skill 备份目录中')
  }
  if (!(await readManifest(source))) throw new Error('备份不是有效 Skill：缺少 SKILL.md')
  const destination = path.join(path.resolve(libraryPath), skillName)
  if (await dirExists(destination)) throw new Error(`全局库已存在同名 Skill：${skillName}`)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.restore-${process.pid}-${Date.now()}`
  try {
    await fs.cp(source, temporary, { recursive: true })
    await fs.rename(temporary, destination)
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  const manifest = await readManifest(destination)
  const front = parseFrontmatter(manifest?.text || '')
  return {
    name: skillName,
    nameFromManifest: front.name || skillName,
    description: front.description || '',
    directory: destination,
    apps: DEFAULT_APPS()
  }
}

/**
 * 移除 skill：先备份，再从所有引擎投影目录移除自建项，最后删除 SSOT 项。
 * apps 参数保留用于兼容旧调用；投影归属校验决定实际可删除范围。
 */
export async function removeSkill({ libraryPath, skillName, homePath, override, backupDir, apps }) {
  if (!sanitizeName(skillName)) throw new Error(`无效的 Skill 名称：${skillName}`)
  const backupPath = await backupSkill({ libraryPath, skillName, backupDir })
  if (!backupPath) throw new Error(`Skill 不存在：${skillName}`)
  const removal = {}
  for (const engine of ENGINES) {
    try {
      const result = await removeOwnedProjection({ libraryPath, skillName, engine, homePath, override })
      removal[engine] = result.ok
        ? (result.removed ? 'removed' : 'skipped')
        : { status: 'conflict', error: result.error }
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
  projectionMarkerMatches,
  buildDiagnostics
}
