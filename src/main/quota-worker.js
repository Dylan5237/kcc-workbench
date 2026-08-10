import { BrowserWindow } from 'electron'
import { QUOTA_EXTRACTION_SCRIPT } from './quota-extract.js'
import { loadQuotaPage } from './quota-navigation.js'

export async function scrapeQuota(partition) {
  const worker = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const sanitizedUserAgent = worker.webContents
    .getUserAgent()
    .replace(/\sElectron\/\S+/i, '')
  worker.webContents.setUserAgent(sanitizedUserAgent)

  try {
    await loadQuotaPage(worker)
    const deadline = Date.now() + 40_000
    let lastResult = null
    while (Date.now() < deadline) {
      lastResult = await worker.webContents.executeJavaScript(
        QUOTA_EXTRACTION_SCRIPT,
        true
      )
      if (lastResult?.ready) return lastResult
      if (lastResult?.likelyLoggedOut) {
        const error = new Error(lastResult.error)
        error.code = 'KIMI_LOGIN_REQUIRED'
        throw error
      }
      await delay(700)
    }
    throw new Error(lastResult?.error || '额度页面加载超时。')
  } finally {
    if (!worker.isDestroyed()) worker.destroy()
  }
}

export async function runQuotaFixtureSelfTest() {
  const worker = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  const html = `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: sans-serif; padding: 24px; }
        .panel { width: 720px; }
        .total-label { font-size: 18px; }
        .track { display: flex; width: 640px; height: 18px; margin: 18px 0; background: #eee; }
        .kimi { width: 14.70%; background: rgb(28,28,28); }
        .code { width: 3.92%; background: rgb(55,124,246); }
        .remaining { flex: 1; }
        .section { margin-top: 28px; padding-top: 18px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="panel">
        <div class="total-label">总使用量 <span>18.62%</span></div>
        <div class="track">
          <div class="kimi"></div><div class="code"></div><div class="remaining"></div>
        </div>
        <div>Kimi　Code</div>
        <div>2026-08-25 后重置</div>
        <div class="section">
          <div>5 小时用量</div>
          <div>Code　31.37%</div>
          <div>07-27 13:13 后重置</div>
        </div>
        <div class="section">
          <div>7 天用量</div>
          <div>Code　18.41%</div>
          <div>08-01 11:13 后重置</div>
        </div>
      </div>
    </body>
  </html>`

  try {
    await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const result = await worker.webContents.executeJavaScript(
      QUOTA_EXTRACTION_SCRIPT,
      true
    )
    if (!result.ready) {
      throw new Error(result.error || 'Quota extraction self-test failed')
    }
    return result
  } finally {
    if (!worker.isDestroyed()) worker.destroy()
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
