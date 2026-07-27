import { spawn } from 'node:child_process'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { net } from 'electron'

const HOST = '127.0.0.1'
const PORT = 5494
const URL = `http://${HOST}:${PORT}/`

export class LocalKimiService {
  constructor({ homePath, logPath }) {
    this.homePath = homePath
    this.logPath = logPath
    this.child = null
    this.ownsProcess = false
    this.startPromise = null
    this.lastOutput = ''
  }

  get url() {
    return URL
  }

  async start() {
    if (await isReady()) return URL
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startProcess()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  stop() {
    if (this.ownsProcess && this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    this.ownsProcess = false
  }

  async startProcess() {
    const executable = process.env.KIMI_CLI_PATH
      || path.join(this.homePath, '.local', 'bin', 'kimi.exe')

    await this.writeLog(`Starting ${executable} web on ${URL}\n`)
    this.child = spawn(executable, [
      'web',
      '--host', HOST,
      '--port', String(PORT),
      '--no-open'
    ], {
      cwd: this.homePath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        FORCE_COLOR: '0',
        TERM: 'dumb'
      }
    })
    this.ownsProcess = true

    this.child.stdout.on('data', chunk => this.captureOutput(chunk))
    this.child.stderr.on('data', chunk => this.captureOutput(chunk))
    this.child.on('error', error => this.captureOutput(`${error.stack || error}\n`))

    const exitPromise = new Promise((_, reject) => {
      this.child.once('exit', code => {
        if (!this.ownsProcess) return
        reject(new Error(
          `Kimi Web 服务提前退出（代码 ${code ?? 'unknown'}）。${this.lastOutput}`
        ))
      })
      this.child.once('error', reject)
    })

    await Promise.race([waitUntilReady(), exitPromise])
    await this.writeLog(`Kimi Web is ready at ${URL}\n`)
    return URL
  }

  captureOutput(chunk) {
    const text = String(chunk)
    this.lastOutput = `${this.lastOutput}${text}`.slice(-3000)
    this.writeLog(text).catch(() => {})
  }

  async writeLog(text) {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true })
    await fs.appendFile(this.logPath, `[${new Date().toISOString()}] ${text}`)
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await isReady()) return
    await delay(300)
  }
  throw new Error(`等待 Kimi Web 启动超时：${URL}`)
}

async function isReady() {
  try {
    const response = await net.fetch(URL)
    if (!response.ok) return false
    const html = await response.text()
    return /Kimi(?:\s+Code)?|\/assets\/index-/i.test(html)
  } catch {
    return false
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
