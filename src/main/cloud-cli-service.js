import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { net } from 'electron'

const HOST = '127.0.0.1'
const READY_PATTERN = /CloudCLI Server - Ready|Server URL/i

export class CloudCliService {
  constructor({ logPath, env = {} }) {
    this.logPath = logPath
    this.env = env
    this.child = null
    this.port = null
    this.startPromise = null
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
    if (this.child && !this.child.killed) {
      this.child.kill()
    }
    this.child = null
    this.port = null
  }

  async startProcess() {
    this.port = await reserveLoopbackPort()
    const cliEntry = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'node_modules',
      '@cloudcli-ai',
      'cloudcli',
      'dist-server',
      'server',
      'modules',
      'cli',
      'cli.js'
    )
    const url = this.url
    const nodeExecutable = resolveNodeExecutable()
    await this.writeLog(`Using node: ${nodeExecutable}\n`)
    this.child = spawn(nodeExecutable, [cliEntry], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.env,
        SERVER_PORT: String(this.port),
        HOST: HOST,
        NO_OPEN: '1',
        PYTHONUTF8: '1'
      }
    })
    let output = ''
    this.child.stdout.on('data', chunk => {
      output = `${output}${chunk}`.slice(-20000)
    })
    this.child.stderr.on('data', chunk => {
      output = `${output}${chunk}`.slice(-20000)
    })
    this.child.on('error', error => {
      output = `${output}\n${error.stack || error}`.slice(-20000)
    })

    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`CloudCLI 服务提前退出: ${output}`)
      }
      if (await isReady(url)) {
        await this.writeLog(`CloudCLI ready at ${url}\n${output.slice(-2000)}\n`)
        return url
      }
      await delay(400)
    }
    throw new Error(`等待 CloudCLI 就绪超时: ${output.slice(-2000)}`)
  }

  async writeLog(text) {
    try {
      const { promises: fs } = await import('node:fs')
      await fs.mkdir(path.dirname(this.logPath), { recursive: true })
      await fs.appendFile(this.logPath, `[${new Date().toISOString()}] ${text}`)
    } catch {
      // 日志失败不阻塞主流程
    }
  }
}

function resolveNodeExecutable() {
  // CloudCLI 的原生依赖(如 better-sqlite3)按用户当前系统 Node ABI 编译,
  // 必须用同一个 Node 运行; 用 Electron 内置 Node 会因 NODE_MODULE_VERSION 不匹配失败。
  if (process.env.CLOUDCLI_NODE_PATH) return process.env.CLOUDCLI_NODE_PATH
  if (process.env.npm_node_execpath) return process.env.npm_node_execpath
  return process.env.NODE_EXECUTABLE_PATH || 'node'
}

async function isReady(url) {
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) return false
    const html = await response.text()
    return /CloudCLI|Claude UI|claude/i.test(html) || html.includes('assets/')
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
        else if (!port) reject(new Error('无法分配端口'))
        else resolve(port)
      })
    })
  })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
