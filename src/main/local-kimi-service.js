import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { net } from 'electron'
import { buildKimiWebArgs } from './local-kimi-args.js'

const HOST = '127.0.0.1'
const MAX_LOG_BYTES = 5 * 1024 * 1024

export class LocalKimiService {
  constructor({ homePath, logPath, getPermissionMode = async () => undefined }) {
    this.homePath = homePath
    this.logPath = logPath
    this.getPermissionMode = getPermissionMode
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
    const args = buildKimiWebArgs(await this.getPermissionMode(), this.port)

    await this.writeLog(`Starting ${executable} ${args.join(' ')} on ${url}\n`)
    this.child = spawn(executable, args, {
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

    // 就绪后校验端口监听者确为本子进程, 拒绝本机其他进程抢先绑定同一端口提供的伪造服务(RT-002)。
    const ownership = await verifyPortOwnership(this.port, this.child)
    if (ownership === 'other') {
      throw new Error('Kimi Web 端口被其他进程抢先占用，疑似伪造服务，已拒绝接入')
    }

    await this.writeLog(`Kimi Web is ready at ${url}\n`)
    return url
  }

  captureOutput(chunk) {
    const text = String(chunk)
    this.lastOutput = `${this.lastOutput}${text}`.slice(-3000)
    this.writeLog(text).catch(() => {})
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
