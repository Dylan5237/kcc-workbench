// Spike 对照组：测量 Electron v1 的冷启动与常驻内存（隔离 demo profile，不碰真实数据）
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const t0 = Date.now()
const child = spawn('node_modules/electron/dist/electron.exe', ['.', '--demo', '--demo-profile=spike-mem'], {
  cwd: path.resolve(process.cwd()),
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '0' },
})
let firstOutputAt = null
child.stdout.on('data', () => { if (firstOutputAt === null) firstOutputAt = Date.now() - t0 })
child.stderr.on('data', () => { if (firstOutputAt === null) firstOutputAt = Date.now() - t0 })

await new Promise(r => setTimeout(r, 20000)) // 等应用完全起来（含 kimi web 启动）

// 统计启动后新建的 electron 进程
const { stdout } = await execFileP('powershell', [
  '-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CreationDate -and ($_.CommandLine -match 'KCCWorkbench') } | Select-Object ProcessId,WorkingSetSize | ConvertTo-Json`,
], { windowsHide: true, maxBuffer: 1024 * 1024 })

let procs = []
try { procs = JSON.parse(stdout); if (!Array.isArray(procs)) procs = [procs] } catch { procs = [] }
const totalMb = Math.round(procs.reduce((s, p) => s + (p.WorkingSetSize || 0), 0) / 1048576 * 10) / 10

const result = {
  first_output_ms: firstOutputAt,
  electron_processes: procs.length,
  electron_working_set_mb: totalMb,
  measured_after_ms: Date.now() - t0,
}
await fs.mkdir('spike/results', { recursive: true })
await fs.writeFile('spike/results/electron-baseline.json', JSON.stringify(result, null, 2))
console.log('ELECTRON BASELINE', JSON.stringify(result))

spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
process.exit(0)
