import path from 'node:path'
import { promises as fs } from 'node:fs'

const PERMISSION_MODES = new Set(['manual', 'yolo', 'auto'])
const INTEGER_FIELDS = new Set([
  'loop_control.max_steps_per_turn',
  'loop_control.max_retries_per_step',
  'loop_control.reserved_context_size',
  'background.max_running_tasks',
  'background.kill_grace_period_ms',
  'background.bash_task_timeout_s',
  'subagent.timeout_ms',
  'mcp.startup_timeout_ms',
  'mcp.tool_timeout_ms',
  'image.max_edge_px',
  'image.read_byte_budget'
])

const MANAGED_FIELDS = [
  ['default_model', 'string'],
  ['default_permission_mode', 'string'],
  ['default_plan_mode', 'boolean'],
  ['merge_all_available_skills', 'boolean'],
  ['extra_skill_dirs', 'array'],
  ['extra_agent_dirs', 'array'],
  ['telemetry', 'boolean'],
  ['thinking.enabled', 'boolean'],
  ['thinking.effort', 'string'],
  ['thinking.keep', 'string'],
  ['loop_control.max_steps_per_turn', 'integer'],
  ['loop_control.max_retries_per_step', 'integer'],
  ['loop_control.reserved_context_size', 'integer'],
  ['background.max_running_tasks', 'integer'],
  ['background.keep_alive_on_exit', 'boolean'],
  ['background.kill_grace_period_ms', 'integer'],
  ['background.bash_auto_background_on_timeout', 'boolean'],
  ['background.bash_task_timeout_s', 'integer'],
  ['subagent.timeout_ms', 'integer'],
  ['mcp.startup_timeout_ms', 'integer'],
  ['mcp.tool_timeout_ms', 'integer'],
  ['tools.enabled', 'array'],
  ['tools.disabled', 'array'],
  ['image.max_edge_px', 'integer'],
  ['image.read_byte_budget', 'integer']
]

export class SettingsService {
  constructor({ kimiCodeHome, sandboxed = false }) {
    this.kimiCodeHome = path.resolve(kimiCodeHome)
    this.sandboxed = sandboxed
    this.projectDirectory = null
  }

  setProjectDirectory(projectDirectory) {
    this.projectDirectory = projectDirectory ? path.resolve(projectDirectory) : null
  }

  async getState() {
    const configPath = path.join(this.kimiCodeHome, 'config.toml')
    const tuiPath = path.join(this.kimiCodeHome, 'tui.toml')
    const mcpPath = path.join(this.kimiCodeHome, 'mcp.json')
    const systemPromptPath = path.join(this.kimiCodeHome, 'SYSTEM.md')
    const agentsInstructionsPath = path.join(this.kimiCodeHome, 'AGENTS.md')
    const [configText, tuiText, mcpText, systemPrompt, agentsInstructions] = await Promise.all([
      readText(configPath),
      readText(tuiPath),
      readText(mcpPath),
      readText(systemPromptPath),
      readText(agentsInstructionsPath)
    ])

    const config = parseManagedConfig(configText)
    const [systemPromptExists, agentsInstructionsExists, skills, projectInstructions] =
      await Promise.all([
        fileExists(systemPromptPath),
        fileExists(agentsInstructionsPath),
        discoverSkills(this.kimiCodeHome, config.extra_skill_dirs || []),
        readProjectInstructions(this.projectDirectory)
      ])

    return {
      sandboxed: this.sandboxed,
      kimiCodeHome: this.kimiCodeHome,
      projectDirectory: this.projectDirectory,
      paths: {
        config: configPath,
        tui: tuiPath,
        mcp: mcpPath,
        systemPrompt: systemPromptPath,
        agentsInstructions: agentsInstructionsPath
      },
      config,
      models: parseModels(configText),
      mcpServers: parseMcpServers(mcpText),
      skills,
      systemPrompt,
      agentsInstructions,
      promptSources: {
        system: systemPromptExists ? 'custom' : 'builtin',
        agents: agentsInstructionsExists ? 'custom' : 'none'
      },
      projectInstructions,
      raw: {
        config: configText,
        tui: tuiText,
        mcp: mcpText
      }
    }
  }

  async save({ config = {}, systemPrompt, agentsInstructions }) {
    validateConfig(config)
    await fs.mkdir(this.kimiCodeHome, { recursive: true })
    const configPath = path.join(this.kimiCodeHome, 'config.toml')
    if (MANAGED_FIELDS.some(([fieldPath]) => getPath(config, fieldPath) !== undefined)) {
      const currentConfig = await readText(configPath)
      let nextConfig = currentConfig
      for (const [fieldPath, type] of MANAGED_FIELDS) {
        const value = getPath(config, fieldPath)
        if (value === undefined) continue
        const parts = fieldPath.split('.')
        const key = parts.pop()
        nextConfig = patchTomlValue(
          nextConfig,
          parts.join('.'),
          key,
          serializeTomlValue(value, type)
        )
      }
      await writeWithBackup(configPath, ensureTrailingNewline(nextConfig))
    }

    if (typeof systemPrompt === 'string') {
      await writeOrRemoveWithBackup(
        path.join(this.kimiCodeHome, 'SYSTEM.md'),
        systemPrompt
      )
    }
    if (typeof agentsInstructions === 'string') {
      await writeOrRemoveWithBackup(
        path.join(this.kimiCodeHome, 'AGENTS.md'),
        agentsInstructions
      )
    }
    return this.getState()
  }
}

export function parseManagedConfig(text) {
  const result = {}
  for (const [fieldPath, type] of MANAGED_FIELDS) {
    const parts = fieldPath.split('.')
    const key = parts.pop()
    const raw = findTomlValue(text, parts.join('.'), key)
    if (raw === undefined) continue
    setPath(result, fieldPath, parseTomlValue(raw, type))
  }
  return result
}

export function patchTomlValue(text, section, key, serializedValue) {
  const lines = text ? text.replace(/\r\n/g, '\n').split('\n') : []
  const sectionRange = findSectionRange(lines, section)
  const start = sectionRange.start
  const end = sectionRange.end
  const keyPattern = new RegExp(`^(\\s*${escapeRegex(key)}\\s*=\\s*)(.*?)(\\s+#.*)?$`)

  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(keyPattern)
    if (!match) continue
    lines[index] = `${match[1]}${serializedValue}${match[3] || ''}`
    return lines.join('\n')
  }

  if (!section) {
    lines.splice(end, 0, `${key} = ${serializedValue}`)
    return lines.join('\n')
  }

  if (sectionRange.exists) {
    lines.splice(end, 0, `${key} = ${serializedValue}`)
    return lines.join('\n')
  }

  if (lines.length && lines.at(-1)?.trim()) lines.push('')
  lines.push(`[${section}]`, `${key} = ${serializedValue}`)
  return lines.join('\n')
}

function findTomlValue(text, section, key) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const { start, end } = findSectionRange(lines, section)
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+?)\\s*$`)
  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(pattern)
    if (match) return stripInlineComment(match[1]).trim()
  }
  return undefined
}

function findSectionRange(lines, section) {
  if (!section) {
    const end = lines.findIndex(line => /^\s*\[\[?/.test(line))
    return { exists: true, start: 0, end: end === -1 ? lines.length : end }
  }
  const matches = lines
    .map((line, index) => ({ index, section: parseTomlSectionName(line) }))
    .filter(item => item.section === section)
  if (matches.length > 1) throw new Error(`TOML 中存在重复节：[${section}]`)
  const index = matches[0]?.index ?? -1
  if (index === -1) return { exists: false, start: lines.length, end: lines.length }
  const next = lines.findIndex((line, lineIndex) => lineIndex > index && /^\s*\[\[?/.test(line))
  return { exists: true, start: index + 1, end: next === -1 ? lines.length : next }
}

function parseTomlSectionName(line) {
  const match = String(line).match(/^\s*\[(?!\[)(.+)\]\s*(?:#.*)?$/)
  if (!match) return null
  const raw = match[1].trim()
  if (/^"(?:\\.|[^"])*"$/.test(raw)) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (/^'[^']*'$/.test(raw)) return raw.slice(1, -1)
  return raw
}

function parseModels(text) {
  const models = []
  const pattern = /^\s*\[models\."([^"]+)"\]\s*$/gm
  for (const match of text.matchAll(pattern)) {
    const alias = match[1]
    const rest = text.slice(match.index + match[0].length)
    const end = rest.search(/^\s*\[\[?/m)
    const block = end === -1 ? rest : rest.slice(0, end)
    models.push({
      alias,
      model: parseStringValue(findLineValue(block, 'model')) || alias,
      displayName: parseStringValue(findLineValue(block, 'display_name')) || alias,
      maxContextSize: parseIntegerValue(findLineValue(block, 'max_context_size')),
      capabilities: parseArrayValue(findLineValue(block, 'capabilities'))
    })
  }
  return models
}

function parseMcpServers(text) {
  try {
    const value = JSON.parse(text || '{}')
    return Object.entries(value.mcpServers || {}).map(([name, config]) => ({
      name,
      enabled: config.enabled !== false,
      transport: config.command ? 'stdio' : config.transport || 'http',
      endpoint: config.command || config.url || '',
      enabledTools: config.enabledTools || [],
      disabledTools: config.disabledTools || []
    }))
  } catch {
    return []
  }
}

function validateConfig(config) {
  if (
    config.default_permission_mode !== undefined
    && !PERMISSION_MODES.has(config.default_permission_mode)
  ) {
    throw new Error('无效的默认权限模式')
  }
  for (const fieldPath of INTEGER_FIELDS) {
    const value = getPath(config, fieldPath)
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${fieldPath} 必须是非负整数`)
    }
  }
}

function parseTomlValue(raw, type) {
  if (type === 'boolean') return raw === 'true'
  if (type === 'integer') return parseIntegerValue(raw)
  if (type === 'array') return parseArrayValue(raw)
  return parseStringValue(raw)
}

function serializeTomlValue(value, type) {
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'integer') return String(value)
  if (type === 'array') {
    return `[${value.map(item => JSON.stringify(String(item))).join(', ')}]`
  }
  return JSON.stringify(String(value))
}

function parseStringValue(raw) {
  if (!raw) return ''
  const value = stripInlineComment(raw).trim()
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

function parseIntegerValue(raw) {
  const value = Number.parseInt(stripInlineComment(raw || ''), 10)
  return Number.isFinite(value) ? value : null
}

function parseArrayValue(raw) {
  if (!raw) return []
  const value = stripInlineComment(raw).trim()
  if (!value.startsWith('[') || !value.endsWith(']')) return []
  const items = value.slice(1, -1).match(/"(?:\\.|[^"])*"|'[^']*'|[^,]+/g) || []
  return items.map(item => parseStringValue(item.trim())).filter(Boolean)
}

function findLineValue(block, key) {
  const match = block.match(new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+)$`, 'm'))
  return match?.[1] || ''
}

function stripInlineComment(value) {
  let quote = null
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote || character
      continue
    }
    if (character === '#' && !quote) return value.slice(0, index)
  }
  return value
}

function setPath(target, fieldPath, value) {
  const parts = fieldPath.split('.')
  const key = parts.pop()
  let current = target
  for (const part of parts) {
    current[part] ||= {}
    current = current[part]
  }
  current[key] = value
}

function getPath(target, fieldPath) {
  return fieldPath.split('.').reduce((value, key) => value?.[key], target)
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function discoverSkills(kimiCodeHome, extraDirectories) {
  const roots = [
    path.join(kimiCodeHome, 'skills'),
    ...extraDirectories.map(directory => path.resolve(directory))
  ]
  const results = []
  const seen = new Set()
  for (const root of roots) {
    const candidates = []
    if (await fileExists(path.join(root, 'SKILL.md'))) candidates.push(root)
    try {
      const entries = await fs.readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) candidates.push(path.join(root, entry.name))
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error
    }
    for (const directory of candidates) {
      const manifestPath = path.join(directory, 'SKILL.md')
      if (!(await fileExists(manifestPath))) continue
      const normalized = directory.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      results.push({
        name: path.basename(directory),
        path: directory,
        source: directory.startsWith(path.join(kimiCodeHome, 'skills'))
          ? 'Kimi Code'
          : '额外目录'
      })
    }
  }
  return results.sort((left, right) => left.name.localeCompare(right.name))
}

async function readProjectInstructions(projectDirectory) {
  if (!projectDirectory) return null
  const candidates = [
    path.join(projectDirectory, '.kimi-code', 'AGENTS.md'),
    path.join(projectDirectory, 'AGENTS.md')
  ]
  for (const filePath of candidates) {
    if (!(await fileExists(filePath))) continue
    return {
      path: filePath,
      content: await readText(filePath)
    }
  }
  return null
}

async function writeWithBackup(filePath, content) {
  const temporaryPath = `${filePath}.tmp`
  const backupPath = `${filePath}.bak`
  try {
    await fs.copyFile(filePath, backupPath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await fs.writeFile(temporaryPath, content, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

async function writeOrRemoveWithBackup(filePath, content) {
  if (content.trim()) {
    await writeWithBackup(filePath, content)
    return
  }
  try {
    await fs.copyFile(filePath, `${filePath}.bak`)
    await fs.rm(filePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
