// Spike S-1 探针：启动 kimi web，发现其 API 面（特别是"创建会话并携带首条消息"的能力）
// 产出：spike/results/api-probe.json + 控制台摘要
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOST = '127.0.0.1'
const OUT_DIR = path.resolve(process.cwd(), 'spike', 'results')

function reservePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.once('error', reject)
    s.listen(0, HOST, () => {
      const { port } = s.address()
      s.close(err => (err ? reject(err) : resolve(port)))
    })
  })
}

function startKimiWeb(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('kimi.cmd', ['web', '--host', HOST, '--port', String(port), '--no-open'], {
      shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', TERM: 'dumb' },
    })
    let buf = ''
    const timer = setTimeout(() => reject(new Error('kimi web 启动超时\n' + buf.slice(-800))), 30000)
    const onData = chunk => {
      buf += String(chunk)
      const m = buf.match(/https?:\/\/127\.0\.0\.1:\d+\/?#[^\s]+/) || buf.match(/https?:\/\/127\.0\.0\.1:\d+\//)
      if (m) {
        clearTimeout(timer)
        resolve({ child, openUrl: m[0], log: buf })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`kimi web 退出 code=${code}\n` + buf.slice(-800))) })
  })
}

function tokenFromOpenUrl(openUrl) {
  const hash = openUrl.split('#')[1] || ''
  const params = new URLSearchParams(hash)
  return params.get('token') || hash.replace(/^.*token=/, '') || ''
}

async function api(origin, route, { method = 'GET', token, body, full = false } = {}) {
  try {
    const res = await fetch(origin + route, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    return { route, status: res.status, body: full ? text : text.slice(0, 600) }
  } catch (error) {
    return { route, status: -1, body: String(error) }
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const port = await reservePort()
  console.log('[probe] starting kimi web on port', port)
  const { child, openUrl } = await startKimiWeb(port)
  const origin = `http://${HOST}:${port}/`
  const token = tokenFromOpenUrl(openUrl) || (await fs.readFile(path.join(os.homedir(), '.kimi-code', 'server.token'), 'utf8').catch(() => '')).trim()
  console.log('[probe] ready:', origin, '| token length:', token.length)

  const results = { origin, openUrlKnown: Boolean(openUrl), tokenLength: token.length, probes: [] }

  // 1) 元信息
  results.probes.push(await api(origin, 'api/v1/meta', { token }))

  // 2) 拉取前端 bundle，grep 出全部 API 路由
  const index = await fetch(origin).then(r => r.text())
  const assetMatch = index.match(/\/assets\/index-[^"']+\.js/)
  let routes = []
  if (assetMatch) {
    const bundle = await fetch(origin + assetMatch[0]).then(r => r.text())
    routes = [...new Set([...bundle.matchAll(/["'`]((?:\/api\/v1|\/api)\/[^"'`$]{1,80})["'`]/g)].map(m => m[1]))].sort()
    // 找"创建会话/发消息"相关调用形态
    const posts = [...new Set([...bundle.matchAll(/method:\s*["']POST["'][^}]{0,200}/g)].map(m => m[0]))].slice(0, 12)
    results.frontendPostSamples = posts
  }
  results.frontendRoutes = routes
  console.log('[probe] routes found:', routes.length)

  // 3) 会话列表与单会话结构
  results.probes.push(await api(origin, 'api/v1/sessions', { token }))

  // 4) 创建会话：第一轮发现需要 workspace_id 或 metadata.cwd，直接带上重试
  const brief = '【Arckeep spike 简报测试】这是一条探针消息，请只回复 OK，不要做任何其他操作。'
  const spikeCwd = process.cwd().replace(/\//g, '\\') + '\\spike'
  const create = await api(origin, 'api/v1/sessions', { method: 'POST', token, full: true, body: { prompt: brief, metadata: { cwd: spikeCwd } } })
  results.createAttempts = [{ route: create.route, status: create.status, body: create.body.slice(0, 900) }]
  console.log('[probe] POST api/v1/sessions {prompt, metadata.cwd} →', create.status)

  // 5) 若创建成功，读回会话详情与消息记录，验证"简报进入 transcript"（交付证据）
  results.deliveryEvidence = null
  try {
    const created = JSON.parse(create.body)
    const sessionId = created?.data?.id || created?.data?.session_id || created?.data?.session?.id
    if (sessionId) {
      console.log('[probe] session created:', sessionId, '| busy at creation:', created.data.busy)
      // 轮询等待首 turn 完成（最多 60s）
      let detail = null
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const d = await api(origin, `api/v1/sessions/${encodeURIComponent(sessionId)}`, { token, full: true })
        const parsed = JSON.parse(d.body)
        detail = parsed?.data
        if (detail && !detail.busy && detail.message_count > 0) break
      }
      const messages = await api(origin, `api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, { token, full: true })
      const turns = await api(origin, `api/v1/sessions/${encodeURIComponent(sessionId)}/turns`, { token })
      const haystack = JSON.stringify(detail) + messages.body + turns.body
      const transcriptHit = haystack.includes('Arckeep spike 简报测试')
      results.deliveryEvidence = {
        sessionId,
        workspaceId: detail?.workspace_id,
        turnCount: detail?.turn_count,
        messageCount: detail?.message_count,
        lastTurnReason: detail?.last_turn_reason,
        transcriptContainsBrief: transcriptHit,
        messagesSample: messages.body.slice(0, 1500),
        turnsStatus: turns.status,
      }
      console.log('[probe] transcript contains brief:', transcriptHit, '| turns:', detail?.turn_count, '| messages:', detail?.message_count)
    } else {
      results.deliveryEvidence = { note: 'no session id in response', raw: create.body.slice(0, 900) }
    }
  } catch (error) {
    results.deliveryEvidence = { error: String(error) }
  }

  await fs.writeFile(path.join(OUT_DIR, 'api-probe.json'), JSON.stringify(results, null, 2))
  console.log('[probe] written spike/results/api-probe.json')

  child.kill()
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  process.exit(0)
}

main().catch(error => { console.error('[probe] FAILED:', error.message); process.exit(1) })
