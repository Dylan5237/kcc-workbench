// Spike S-1 WS 实验：连接 /api/v1/ws，观察服务端协议，尝试提交 prompt
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import WebSocket from 'ws'

const HOST = '127.0.0.1'
const OUT_DIR = path.resolve(process.cwd(), 'spike', 'results')

function reservePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref(); s.once('error', reject)
    s.listen(0, HOST, () => { const { port } = s.address(); s.close(e => e ? reject(e) : resolve(port)) })
  })
}
function startKimiWeb(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('kimi.cmd', ['web', '--host', HOST, '--port', String(port), '--no-open'], {
      shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    })
    let buf = ''
    const timer = setTimeout(() => reject(new Error('启动超时')), 30000)
    const onData = c => { buf += String(c); if (/127\.0\.0\.1:\d+/.test(buf)) { clearTimeout(timer); resolve(child) } }
    child.stdout.on('data', onData); child.stderr.on('data', onData)
    child.once('exit', code => { clearTimeout(timer); reject(new Error('退出 code=' + code)) })
  })
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const port = await reservePort()
  const child = await startKimiWeb(port)
  const origin = `http://${HOST}:${port}`
  const token = (await fs.readFile(path.join(os.homedir(), '.kimi-code', 'server.token'), 'utf8')).trim()
  console.log('[ws] server on', port)

  // 先建会话
  const spikeCwd = process.cwd().replace(/\//g, '\\') + '\\spike'
  const createRes = await fetch(`${origin}/api/v1/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { cwd: spikeCwd } }),
  })
  const created = await createRes.json()
  const sessionId = created?.data?.id
  console.log('[ws] session created:', sessionId)

  const log = { sessionId, incoming: [], attempts: [] }
  const ws = new WebSocket(`ws://${HOST}:${port}/api/v1/ws?client_id=spike-${Date.now()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  ws.on('message', data => {
    const text = String(data)
    log.incoming.push(text.slice(0, 400))
    const short = text.length > 160 ? text.slice(0, 160) + '…' : text
    console.log('[ws] ←', short.replace(/\n/g, ' '))
  })
  ws.on('error', e => console.log('[ws] error:', e.message))
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); setTimeout(() => reject(new Error('ws 连接超时')), 8000) })
  console.log('[ws] connected')

  // 听 3 秒服务端 hello/快照
  await new Promise(r => setTimeout(r, 3000))

  // 尝试订阅会话 + 提交 prompt（几种候选形态）
  const brief = '【Arckeep spike WS 简报测试】请只回复 OK。'
  const candidates = [
    { type: 'session.subscribe', session_id: sessionId },
    { type: 'session.subscribe', sessionId },
    { type: 'prompt.submit', session_id: sessionId, text: brief },
    { type: 'prompt.submit', session_id: sessionId, prompt: brief },
    { type: 'prompt.submit', sessionId, text: brief },
  ]
  for (const msg of candidates) {
    ws.send(JSON.stringify(msg))
    console.log('[ws] →', JSON.stringify(msg).slice(0, 110))
    await new Promise(r => setTimeout(r, 1500))
  }

  // 观察 20 秒事件流
  await new Promise(r => setTimeout(r, 20000))

  // 读回会话状态
  const detail = await fetch(`${origin}/api/v1/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
  log.finalSession = { busy: detail?.data?.busy, message_count: detail?.data?.message_count, turn_count: detail?.data?.turn_count, last_prompt: detail?.data?.last_prompt ?? null }
  console.log('[ws] final session:', JSON.stringify(log.finalSession))

  await fs.writeFile(path.join(OUT_DIR, 'ws-probe.json'), JSON.stringify(log, null, 2))
  ws.close()
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  process.exit(0)
}
main().catch(e => { console.error('[ws] FAILED:', e.message); process.exit(1) })
