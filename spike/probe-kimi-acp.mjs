// Spike S-1 ACP 实验：kimi acp（Agent Client Protocol over stdio，NDJSON JSON-RPC）
// 验证：initialize → session/new（带 cwd）→ session/prompt（带简报）→ 事件流回执
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const OUT_DIR = path.resolve(process.cwd(), 'spike', 'results')
const brief = '【Arckeep spike ACP 简报测试】请只回复 OK，不要做任何其他操作。'

function rpc(child, id, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const cwd = process.cwd() + '\\spike'
  const child = spawn('kimi.cmd', ['acp'], {
    shell: true, windowsHide: true, cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
  })

  const log = { stderr: [], responses: [], notifications: [] }
  let buffer = ''
  const pending = new Map()
  child.stdout.on('data', chunk => {
    buffer += String(chunk)
    let idx
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { log.responses.push({ raw: line.slice(0, 300) }); continue }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        log.responses.push(msg)
        pending.get(msg.id)?.(msg)
        pending.delete(msg.id)
      } else {
        log.notifications.push(msg)
        const method = msg.method || msg.type
        if (log.notifications.length < 30) console.log('[acp] ←', method, JSON.stringify(msg.params || msg.payload || '').slice(0, 140))
      }
    }
  })
  child.stderr.on('data', c => { const t = String(c).trim(); if (t) { log.stderr.push(t.slice(0, 300)); console.log('[acp][stderr]', t.slice(0, 160)) } })
  child.on('exit', code => console.log('[acp] exit', code))

  const call = (id, method, params) => new Promise(resolve => { pending.set(id, resolve); rpc(child, id, method, params) })
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  // 1) initialize
  const init = await Promise.race([call(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} }), sleep(10000)])
  console.log('[acp] initialize →', init ? JSON.stringify(init.result || init.error).slice(0, 200) : 'TIMEOUT')

  // 2) session/new
  const sn = await Promise.race([call(2, 'session/new', { cwd, mcpServers: [] }), sleep(15000)])
  const sessionId = sn?.result?.sessionId
  console.log('[acp] session/new →', sessionId || JSON.stringify(sn?.error || 'TIMEOUT').slice(0, 200))

  // 3) session/prompt 携带简报
  let promptResult = null
  if (sessionId) {
    const pr = call(3, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: brief }] })
    promptResult = await Promise.race([pr, sleep(60000)])
    console.log('[acp] session/prompt →', promptResult ? JSON.stringify(promptResult.result || promptResult.error).slice(0, 200) : 'TIMEOUT')
  }

  log.verdict = {
    initializeOk: Boolean(init?.result),
    sessionNewOk: Boolean(sessionId),
    sessionId: sessionId || null,
    promptCompleted: Boolean(promptResult?.result),
    stopReason: promptResult?.result?.stopReason || null,
    notificationTypes: [...new Set(log.notifications.map(n => n.method || n.type))],
  }
  await fs.writeFile(path.join(OUT_DIR, 'acp-probe.json'), JSON.stringify(log, null, 2))
  console.log('[acp] verdict:', JSON.stringify(log.verdict))

  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  process.exit(0)
}
main().catch(e => { console.error('[acp] FAILED:', e.message); process.exit(1) })
