#!/usr/bin/env node
// Arckeep D0-04: standalone process entry for the KCC Viewer service.
//
// Reuses src/viewer/server.cjs unchanged; adds only the process seams a
// non-Electron host (the Arckeep C# shell) needs:
//   - CLI startup: --config-dir (required), --root, --port
//   - stdout handshake: one JSON line {"type":"ready","port":N,"token":"...","root":"..."}
//   - stdin control channel (JSON lines, id-correlated):
//       {"id":1,"type":"set-root","root":"D:/proj"}  -> {"id":1,"type":"root","ok":true,"root":"..."}
//       {"id":2,"type":"ping"}                       -> {"id":2,"type":"pong"}
//       {"id":3,"type":"shutdown"}                   -> closes server and exits 0
//   - self-exit when the host closes stdin (orphan protection)
//
// The auth token is generated per process and only ever travels over the
// loopback handshake line; it is never written to logs or disk.

const readline = require('node:readline')
const { startServer } = require('./server.cjs')

function parseArgs(argv) {
  const args = { port: 0, root: '', configDir: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--config-dir') { args.configDir = value; i += 1 }
    else if (key === '--root') { args.root = value; i += 1 }
    else if (key === '--port') { args.port = Number(value) || 0; i += 1 }
  }
  return args
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.configDir) {
    write({ type: 'error', error: 'missing --config-dir' })
    process.exit(2)
  }

  let server
  try {
    server = await startServer({
      port: args.port,
      configDir: args.configDir,
      defaultRoot: args.root
    })
  } catch (error) {
    write({ type: 'error', error: String(error && error.message || error) })
    process.exit(1)
    return
  }

  write({ type: 'ready', port: server.port, token: server.bootstrapToken, root: server.root })

  let shuttingDown = false
  async function shutdown(code = 0) {
    if (shuttingDown) return
    shuttingDown = true
    try { await server.close() } catch { /* already closing */ }
    process.exit(code)
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const id = message.id
    if (message.type === 'set-root') {
      server.setRoot(String(message.root || ''))
        .then(ok => write({ id, type: 'root', ok, root: server.root }))
        .catch(error => write({ id, type: 'root', ok: false, error: String(error && error.message || error) }))
    } else if (message.type === 'ping') {
      write({ id, type: 'pong' })
    } else if (message.type === 'shutdown') {
      write({ id, type: 'bye' })
      shutdown(0)
    } else if (message.type) {
      write({ id, type: 'error', error: `unknown command: ${message.type}` })
    }
  })
  // Host died or closed the control pipe: do not leave an orphan behind.
  rl.on('close', () => shutdown(0))

  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
}

main()
