#!/usr/bin/env node
// 一键重新打包为 portable exe。
// 默认流程: 运行测试 -> 清理 dist/ -> electron-builder 打包 -> 报告产物路径与大小。
// 打包阶段自绘进度条(进度% + 旋转符 + 计时 + 当前阶段), 避免 electron-builder 长时间无输出被判卡死。
// 用法:
//   npm run pack                  # 完整流程(测试+清理+打包)
//   npm run pack -- --no-test     # 跳过测试
//   npm run pack -- --no-clean    # 保留旧 dist/(增量打包)
import { execSync, spawn } from 'node:child_process'
import { existsSync, rmSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const flags = process.argv.slice(2)
const skipTest = flags.includes('--no-test')
const skipClean = flags.includes('--no-clean')

function run(command, label) {
  console.log(`\n▶ ${label}`)
  execSync(command, { stdio: 'inherit' })
}

// electron-builder 输出行 -> 近似进度百分比与阶段名(按出现顺序, 只增不减)。
// 不纳入 signing 阶段: 它出现多次且顺序穿插, 会让百分比回跳; 改由最终 exit 置 100%。
const PHASES = [
  [/electron-builder\s+version/i, 5, '启动 electron-builder'],
  [/loaded configuration/i, 10, '加载配置'],
  [/executing @electron\/rebuild/i, 18, '重建原生依赖'],
  [/installing native dependencies/i, 25, '安装原生依赖'],
  [/completed installing native dependencies/i, 32, '原生依赖就绪'],
  [/\bpackaging\b/i, 45, '打包 asar'],
  [/updating asar/i, 50, '更新 asar 校验'],
  [/building.*target=portable/i, 70, '生成 portable exe(7z 压缩, 最耗时)']
]

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const BAR_WIDTH = 22

function runWithProgress(command, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${label}`)
    const child = spawn(command, [], { shell: true })
    const start = Date.now()
    let frame = 0
    let percent = 0
    let phase = '准备中'

    function redraw() {
      const sec = Math.floor((Date.now() - start) / 1000)
      const mm = String(Math.floor(sec / 60)).padStart(2, '0')
      const ss = String(sec % 60).padStart(2, '0')
      const filled = Math.round((percent / 100) * BAR_WIDTH)
      const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
      process.stdout.write(`\r\x1b[K${SPINNER[frame]} ${bar} ${String(percent).padStart(3)}%  ${mm}:${ss}  ${phase}`)
      frame = (frame + 1) % SPINNER.length
    }
    const timer = setInterval(redraw, 700)
    redraw()

    function onLine(raw) {
      const line = raw.replace(/\r$/, '')
      for (const [re, pct, name] of PHASES) {
        if (re.test(line)) { percent = Math.max(percent, pct); phase = name }
      }
      process.stdout.write(`\r\x1b[K${line}\n`)
    }

    function drain(buf, handler) {
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        handler(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
      return buf
    }

    let outBuf = ''
    let errBuf = ''
    child.stdout.on('data', chunk => { outBuf = drain(outBuf + chunk.toString(), onLine) })
    child.stderr.on('data', chunk => { errBuf = drain(errBuf + chunk.toString(), onLine) })
    child.on('error', error => {
      clearInterval(timer); process.stdout.write('\r\x1b[K'); reject(error)
    })
    child.on('exit', code => {
      if (outBuf.trim()) onLine(outBuf)
      if (errBuf.trim()) onLine(errBuf)
      clearInterval(timer); process.stdout.write('\r\x1b[K')
      if (code === 0) resolve()
      else reject(new Error(`${command} 退出码 ${code}`))
    })
  })
}

async function cleanDist(dir) {
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const retryable = ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)
      if (!retryable || attempt >= 2) {
        throw retryable
          ? new Error('dist/ 被占用, 请先关闭运行中的 Kimi Desktop 后重试')
          : error
      }
      console.log(`\n⚠  dist/ 被占用(${error.code}), 1s 后重试...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

async function main() {
  if (skipTest) {
    console.log('\n⏭  跳过测试(--no-test)')
  } else {
    run('npm test', '运行测试(失败则中止打包)')
  }

  const distDir = path.resolve('dist')
  if (skipClean) {
    console.log('\n⏭  跳过清理(--no-clean)')
  } else if (existsSync(distDir)) {
    console.log('\n▶ 清理旧产物 dist/')
    await cleanDist(distDir)
  }

  await runWithProgress('npm run dist', '打包 portable exe(electron-builder --win x64)')

  function findExe(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
        return path.join(dir, entry.name)
      }
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = findExe(path.join(dir, entry.name))
        if (found) return found
      }
    }
    return null
  }

  const exe = existsSync(distDir) ? findExe(distDir) : null
  if (exe) {
    const mb = (statSync(exe).size / 1024 / 1024).toFixed(1)
    console.log(`\n✓ 打包完成: ${path.relative(process.cwd(), exe)}  (${mb} MB)`)
  } else {
    console.log('\n✗ 未在 dist/ 找到产物 exe，请检查上方 electron-builder 输出')
    process.exit(1)
  }
}

main().catch(error => {
  console.error(`\n✗ ${error.message}`)
  process.exit(1)
})
