import path from 'node:path'
import { promises as fs } from 'node:fs'
import { buildForecast } from './forecast-service.js'
import { normalizeSnapshot } from './quota-snapshot.js'

export class QuotaService {
  constructor({
    userDataPath,
    partition,
    demoMode = false,
    loginHandler = null,
    onStateChange = () => {},
    scraper = null
  }) {
    this.filePath = path.join(userDataPath, 'quota.json')
    this.partition = partition
    this.demoMode = demoMode
    this.loginHandler = loginHandler
    this.onStateChange = onStateChange
    this.scraper = scraper
    this.refreshPromise = null
    this.data = {
      version: 2,
      snapshot: null,
      history: []
    }
    this.state = {
      status: 'idle',
      snapshot: null,
      forecast: buildForecast([]),
      error: ''
    }
  }

  async initialize() {
    if (this.demoMode) {
      this.data = createDemoData()
    } else {
      this.data = await this.readData()
    }
    this.rebuildState('idle')
  }

  getState() {
    return structuredClone(this.state)
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.performRefresh()
    try {
      return await this.refreshPromise
    } finally {
      this.refreshPromise = null
    }
  }

  dispose() {
    this.onStateChange = () => {}
  }

  async performRefresh() {
    this.rebuildState('syncing')
    try {
      let extracted
      if (this.demoMode) {
        extracted = createDemoSnapshot()
      } else {
        const scraper = this.scraper || (await loadDefaultScraper())
        try {
          extracted = await scraper(this.partition)
        } catch (error) {
          if (error?.code !== 'KIMI_LOGIN_REQUIRED' || !this.loginHandler) {
            throw error
          }
          await this.loginHandler()
          this.rebuildState('syncing')
          extracted = await scraper(this.partition)
        }
      }
      const snapshot = this.demoMode
        ? extracted
        : normalizeSnapshot(extracted)
      this.data.snapshot = snapshot
      this.data.history = [...this.data.history, snapshot].slice(-60)
      await this.writeData()
      this.rebuildState('success')
      return this.getState()
    } catch (error) {
      this.rebuildState(
        'error',
        error instanceof Error ? error.message : String(error)
      )
      return this.getState()
    }
  }

  rebuildState(status, error = '') {
    this.state = {
      status,
      snapshot: this.data.snapshot,
      forecast: buildForecast(this.data.history),
      error
    }
    this.onStateChange(this.getState())
  }

  async readData() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      if (
        parsed?.version === 2
        && Array.isArray(parsed.history)
      ) {
        return {
          version: 2,
          snapshot: parsed.snapshot ?? null,
          history: parsed.history.slice(-60)
        }
      }
    } catch {
      return {
        version: 2,
        snapshot: null,
        history: []
      }
    }
    return {
      version: 2,
      snapshot: null,
      history: []
    }
  }

  async writeData() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2))
    await fs.rm(this.filePath, { force: true })
    await fs.rename(tempPath, this.filePath)
  }
}

// quota-worker 依赖 Electron 的 BrowserWindow, 惰性加载使 quota-service 可在纯 Node 下单元测试。
async function loadDefaultScraper() {
  const { scrapeQuota } = await import('./quota-worker.js')
  return scrapeQuota
}

function createDemoData() {
  const current = createDemoSnapshot()
  const previousTime = new Date(Date.now() - 42 * 60_000).toISOString()
  const previous = {
    ...structuredClone(current),
    updatedAt: previousTime,
    total: {
      ...current.total,
      usedPercent: 14.22,
      kimiPercent: 11.1,
      codePercent: 3.12
    },
    fiveHour: {
      ...current.fiveHour,
      percent: 18.97
    },
    sevenDay: {
      ...current.sevenDay,
      percent: 16.21
    }
  }
  return {
    version: 2,
    snapshot: current,
    history: [previous, current]
  }
}

function createDemoSnapshot() {
  return {
    updatedAt: new Date().toISOString(),
    total: {
      usedPercent: 18.62,
      kimiPercent: 14.7,
      codePercent: 3.92,
      resetAt: futureDate(29)
    },
    fiveHour: {
      percent: 31.37,
      resetAt: futureRollingReset(4)
    },
    sevenDay: {
      percent: 18.41,
      resetAt: futureRollingReset(120)
    }
  }
}

function futureDate(days) {
  const date = new Date(Date.now() + days * 24 * 3_600_000)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function futureRollingReset(hours) {
  const date = new Date(Date.now() + hours * 3_600_000)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
