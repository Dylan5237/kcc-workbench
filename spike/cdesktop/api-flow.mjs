// D0-01 C2 probe: drive a real Claude Code session through cdesktop's local API.
// Step-by-step, prints each HTTP response so the evidence is auditable.
// Node >= 22 provides global fetch.

const BASE = process.env.CDESKTOP_URL || 'http://127.0.0.1:1274'
const PROBE_DIR = process.argv[2] || 'D:\\_projects\\tools\\kcc-workbench-wt-d0-01\\spike\\probe-project'

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  console.log(`\n=== ${method} ${path} -> ${res.status} ===`)
  console.log(JSON.stringify(json ?? text, null, 2).slice(0, 3000))
  return { status: res.status, json }
}

const p = (s) => console.log(`\n##### ${s} #####`)

// 1. Register the probe folder as a repo
p('STEP 1: register repo')
const repo = await call('POST', '/api/repos', { path: PROBE_DIR, display_name: 'd0-01-probe' })
const repoId = repo.json?.data?.id

// 2. Create a workspace (no worktree domain - direct folder mode)
p('STEP 2: create workspace')
const ws = await call('POST', '/api/workspaces', { name: 'd0-01-probe-ws', use_worktree: false })
const wsId = ws.json?.data?.id

// 3. Add the repo to the workspace
p('STEP 3: add repo to workspace')
await call('POST', `/api/workspaces/${wsId}/repos`, { repo_id: repoId, target_branch: 'main' })

// 4. Create a session bound to the workspace with the claude executor
p('STEP 4: create session (executor=CLAUDE_CODE)')
const sess = await call('POST', '/api/sessions', { workspace_id: wsId, executor: 'CLAUDE_CODE', name: 'd0-01-real-claude-probe' })
const sessId = sess.json?.data?.id

// 5. Send a real prompt -> backend spawns real `claude -p ...` child process
p('STEP 5: send follow-up prompt (spawns real claude CLI)')
const run = await call('POST', `/api/sessions/${sessId}/follow-up`, {
  prompt: 'Read README.md and src/hello.py in this project. In one short paragraph (under 60 words), say what language the code uses and what the project is about. Do not edit any files.',
  executor_config: { executor: 'CLAUDE_CODE' },
  retry_process_id: null,
  force_when_dirty: false,
  perform_git_reset: false,
})
const processId = run.json?.data?.id

// 6. Poll the execution process until it finishes, then print the last state
p('STEP 6: poll execution process until completion')
const base = `${BASE}/api/execution-processes/${wsId}`
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 3000))
  const res = await fetch(`${base}/${processId}`)
  const data = (await res.json())?.data
  if (!data) continue
  const status = data.status || data.latest_status
  console.log(`[t+${(i + 1) * 3}s] process status=${JSON.stringify(status)}`)
  if (['completed', 'finished', 'failed', 'error', 'cancelled', 'stopped'].some(s => String(status).toLowerCase().includes(s))) {
    console.log('FINAL PROCESS:', JSON.stringify(data, null, 2).slice(0, 4000))
    process.exit(0)
  }
}
console.log('TIMEOUT waiting for process completion')
process.exit(1)
