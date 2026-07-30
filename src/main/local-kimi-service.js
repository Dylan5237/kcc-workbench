import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { net } from 'electron'

const HOST = '127.0.0.1'

export class LocalKimiService {
  constructor({ homePath, logPath }) {
    this.homePath = homePath
    this.logPath = logPath
    this.child = null
    this.ownsProcess = false
    this.startPromise = null
    this.lastOutput = ''
    this.port = null
  }

  get url() {
    return this.port ? `http://${HOST}:${this.port}/` : ''
  }

  async start() {
    if (this.child && this.url && await isReady(this.url)) return this.url
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
    this.port = null
  }

  async startProcess() {
    const executable = process.env.KIMI_CLI_PATH
      || path.join(this.homePath, '.local', 'bin', 'kimi.exe')
    this.port = await reserveLoopbackPort()
    const url = this.url

    await this.writeLog(`Starting ${executable} web on ${url}\n`)
    this.child = spawn(executable, [
      'web',
      '--host', HOST,
      '--port', String(this.port),
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

    await Promise.race([waitUntilReady(url), exitPromise])
    await this.writeLog(`Kimi Web is ready at ${url}\n`)
    return url
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

async function waitUntilReady(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await isReady(url)) return
    await delay(300)
  }
  throw new Error(`等待 Kimi Web 启动超时：${url}`)
}

async function isReady(url) {
  try {
    const response = await net.fetch(url)
    if (!response.ok) return false
    const html = await response.text()
    return /Kimi(?:\s+Code)?|\/assets\/index-/i.test(html)
  } catch {
    return false
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => {
        if (error) reject(error)
        else if (!port) reject(new Error('无法分配 Kimi Web 本地端口'))
        else resolve(port)
      })
    })
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
