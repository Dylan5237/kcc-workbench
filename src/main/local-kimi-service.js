import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { net } from 'electron'
import { buildKimiWebArgs } from './local-kimi-args.js'
import {
  buildAuthenticatedKimiWebUrl,
  extractKimiWebToken,
  extractKimiWebUrl,
  redactUrlToken
} from './local-kimi-runtime.js'

const HOST = '127.0.0.1'
const MAX_LOG_BYTES = 5 * 1024 * 1024

export class LocalKimiService {
  constructor({ homePath, logPath, portPath = null, getPermissionMode = async () => undefined }) {
    this.homePath = homePath
    this.logPath = logPath
    this.portPath = portPath
    this.getPermissionMode = getPermissionMode
    this.child = null
    this.ownsProcess = false
    this.executable = ''
    this.startPromise = null
    this.lastOutput = ''
    this.outputBuffer = ''
    this.port = null
    this.openUrl = ''
  }

  get url() {
    return this.port ? `http://${HOST}:${this.port}/` : ''
  }

  // Kimi Code 0.38+ protects the local Web UI with a bearer token carried in
  // the URL fragment. Keep the API origin token-free for main-process calls.
  get webUrl() {
    return this.openUrl || this.url
  }

  get apiHeaders() {
    const token = extractKimiWebToken(this.webUrl)
    return token ? { Authorization: `Bearer ${token}` } : {}
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

  async stop() {
    const child = this.child
    const executable = this.executable
    const ownsProcess = this.ownsProcess
    this.child = null
    this.ownsProcess = false
    this.executable = ''
    this.port = null
    this.openUrl = ''

    if (!ownsProcess || !child || child.killed) return
    if (process.platform === 'win32' && isWindowsCommandScript(executable) && child.pid) {
      await new Promise(resolve => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve())
      })
      return
    }
    child.kill()
  }

  async startProcess() {
    const executable = await resolveKimiExecutable(this.homePath)
    this.executable = executable
    const preferredPort = await readPreferredPort(this.portPath)
    if (preferredPort) {
      try {
        this.port = await reservePort(preferredPort)
      } catch (error) {
        if (error?.code !== 'EADDRINUSE') throw error
        const reused = await reuseExistingKimiServer(this.homePath, preferredPort)
        if (reused) {
          this.port = preferredPort
          this.openUrl = reused
          this.ownsProcess = false
          await this.writeLog(`Reusing existing Kimi Web at ${this.url}\n`)
          return this.url
        }
        this.port = await reservePort(0)
      }
    } else {
      this.port = await reservePort(0)
    }
    await writePreferredPort(this.portPath, this.port)
    this.openUrl = ''
    const url = this.url
    const args = buildKimiWebArgs(await this.getPermissionMode(), this.port)

    await this.writeLog(`Starting ${executable} ${args.join(' ')} on ${url}\n`)
    this.child = spawn(executable, args, {
      cwd: this.homePath,
      windowsHide: true,
      shell: isWindowsCommandScript(executable),
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

    try {
      await Promise.race([waitUntilReady(url), exitPromise])
      await waitForOpenUrl(() => this.openUrl, this.child)

      // 就绪后校验端口监听者确为本子进程, 拒绝本机其他进程抢先绑定同一端口提供的伪造服务(RT-002)。
      const ownership = await verifyPortOwnership(this.port, this.child)
      if (ownership === 'other') {
        throw new Error('Kimi Web 端口被其他进程抢先占用，疑似伪造服务，已拒绝接入')
      }

      await this.writeLog(`Kimi Web is ready at ${url}\n`)
      return url
    } catch (error) {
      // 首次启动失败时清理 cmd/node 子进程与状态，允许上层进行一次干净重试。
      await this.stop()
      throw error
    }
  }

  captureOutput(chunk) {
    const text = String(chunk)
    this.outputBuffer = `${this.outputBuffer}${text}`.slice(-4096)
    const cleanText = stripAnsi(this.outputBuffer)
    const openUrl = extractKimiWebUrl(cleanText)
    if (openUrl) this.openUrl = openUrl
    const safeText = redactUrlToken(text)
    this.lastOutput = `${this.lastOutput}${safeText}`.slice(-3000)
    this.writeLog(safeText).catch(() => {})
  }

  async writeLog(text) {
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true })
      const entry = `[${new Date().toISOString()}] ${text}`
      const stat = await fs.stat(this.logPath).catch(() => null)
      if (stat && stat.size >= MAX_LOG_BYTES) {
        const existing = await fs.readFile(this.logPath, 'utf8').catch(() => '')
        const tail = existing.slice(-Math.floor(MAX_LOG_BYTES / 2))
        await fs.writeFile(this.logPath, tail + entry)
      } else {
        await fs.appendFile(this.logPath, entry)
      }
    } catch {
      // 日志写入失败不阻断主流程
    }
  }
}

async function resolveKimiExecutable(homePath) {
  const configured = process.env.KIMI_CLI_PATH?.trim()
  if (configured) return configured

  // npm-installed Kimi Code is the preferred runtime after migration. Keep
  // the legacy native binary as a fallback for existing installations.
  const pathCandidates = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap(directory => [
      path.join(directory, 'kimi.cmd'),
      path.join(directory, 'kimi.exe')
    ])
  const candidates = [
    ...pathCandidates,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'kimi.cmd') : '',
    path.join(homePath, '.local', 'bin', 'kimi.exe')
  ].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index)
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next installation source.
    }
  }
  return candidates.at(-1) || path.join(homePath, '.local', 'bin', 'kimi.exe')
}

function isWindowsCommandScript(executable) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
}

function stripAnsi(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await isReady(url)) return
    await delay(300)
  }
  throw new Error(`等待 Kimi Web 启动超时：${url}`)
}

async function waitForOpenUrl(readUrl, child) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (readUrl() || child.exitCode !== null) return
    await delay(50)
  }
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

async function reuseExistingKimiServer(homePath, port) {
  const origin = `http://${HOST}:${port}/`
  const token = await readKimiServerToken(homePath)
  if (!token || !(await isReady(origin))) return ''
  try {
    const response = await net.fetch(`${origin}api/v1/meta`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) return ''
    return buildAuthenticatedKimiWebUrl(origin, token)
  } catch {
    return ''
  }
}

async function readKimiServerToken(homePath) {
  const kimiHome = process.env.KIMI_CODE_HOME?.trim() || path.join(homePath, '.kimi-code')
  try {
    const token = (await fs.readFile(path.join(kimiHome, 'server.token'), 'utf8')).trim()
    return token || ''
  } catch {
    return ''
  }
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(port, HOST, () => {
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

async function readPreferredPort(portPath) {
  if (!portPath) return null
  try {
    const data = JSON.parse(await fs.readFile(portPath, 'utf8'))
    const port = Number(data?.port)
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null
  } catch {
    return null
  }
}

async function writePreferredPort(portPath, port) {
  if (!portPath) return
  try {
    await fs.mkdir(path.dirname(portPath), { recursive: true })
    await fs.writeFile(portPath, `${JSON.stringify({ port }, null, 2)}\n`, 'utf8')
  } catch {
    // Port persistence is an optimization; startup must still proceed if it fails.
  }
}

// 确认 127.0.0.1:{port} 的监听套接字归 child 所有。
// 返回 'self' 端口归本子进程; 'other' 端口被其他进程监听且本子进程已退出(绑定失败, 判定伪造);
// 'unknown' 无法判定(本子进程仍存活, 可能由 kimi 派生子进程监听, 放行避免误伤)。
async function verifyPortOwnership(port, child, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    const owner = await readPortOwner(port, child.pid)
    if (owner === 'self') return 'self'
    if (owner === 'other' && child.exitCode !== null) return 'other'
    if (Date.now() >= deadline) return 'unknown'
    await delay(250)
  }
}

async function readPortOwner(port, expectedPid) {
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile('netstat', ['-ano'], { windowsHide: true }, (error, output) => {
        if (error) reject(error)
        else resolve(String(output))
      })
    })
    const prefix = `127.0.0.1:${port}`
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.includes(prefix)) continue
      const tokens = line.trim().split(/\s+/)
      if (tokens.length < 5 || tokens[2] !== '0.0.0.0:0') continue  // 仅监听套接字, 忽略已建立连接
      const pid = Number.parseInt(tokens[4], 10)
      if (!Number.isInteger(pid)) continue
      return pid === expectedPid ? 'self' : 'other'
    }
    return 'none'
  } catch {
    return 'unknown'
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
