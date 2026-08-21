import path from 'node:path'
import { promises as fs } from 'node:fs'

const CONFIG_DIR_NAME = 'config'
const CONFIG_FILE_NAME = 'workbench-config.json'
const ENGINES = new Set(['kimi', 'cloudcli'])

/**
 * 根据 workbench 配置决定启动引擎。
 * 优先级：rememberEngine 且 lastEngine 有效 → lastEngine；否则 defaultEngine；否则 kimi。
 */
export function resolveStartupEngine(config) {
  if (!config || typeof config !== 'object') return 'kimi'
  if (config.rememberEngine && ENGINES.has(config.lastEngine)) return config.lastEngine
  if (ENGINES.has(config.defaultEngine)) return config.defaultEngine
  return 'kimi'
}

/**
 * Workbench 自己的全局配置（L1 产品层）。
 *
 * 存储位置默认在 exe 所在路径的 config/ 子目录（便携、随 exe 迁移），
 * 当 exe 目录不可写时（如 Program Files）回落到 fallbackDir。
 * 配置落点会通过 state 暴露给设置页，便于用户确认“本实例配置在哪”。
 */
export class WorkbenchConfigService {
  constructor({ exeDir, fallbackDir, forceFallback = false }) {
    this.exeDir = path.resolve(exeDir)
    this.fallbackDir = path.resolve(fallbackDir)
    this.forceFallback = forceFallback
    this.storageDir = null
    this.configPath = null
    this.state = {}
  }

  async initialize() {
    const exeConfigDir = path.join(this.exeDir, CONFIG_DIR_NAME)
    this.storageDir = (!this.forceFallback && (await canWrite(exeConfigDir)))
      ? exeConfigDir
      : this.fallbackDir
    this.configPath = path.join(this.storageDir, CONFIG_FILE_NAME)
    this.state = await readJson(this.configPath)
    return this.describe()
  }

  async get() {
    return { ...this.state }
  }

  async save(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('配置补丁无效')
    this.state = { ...this.state, ...patch }
    await fs.mkdir(this.storageDir, { recursive: true })
    const temporaryPath = `${this.configPath}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8')
    await fs.rename(temporaryPath, this.configPath)
    return this.describe()
  }

  describe() {
    return {
      configPath: this.configPath,
      storage: this.storageDir === path.join(this.exeDir, CONFIG_DIR_NAME) ? 'exe' : 'userData'
    }
  }
}

async function canWrite(directory) {
  try {
    await fs.mkdir(directory, { recursive: true })
    const probe = path.join(directory, `.write-probe-${process.pid}`)
    await fs.writeFile(probe, '', 'utf8')
    await fs.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    if (error instanceof SyntaxError) return {}
    throw error
  }
}
