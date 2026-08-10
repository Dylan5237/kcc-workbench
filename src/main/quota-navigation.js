export const QUOTA_URL = 'https://www.kimi.com/membership/subscription?tab=quota'

export async function loadQuotaPage(window, {
  attempts = 3,
  wait = delay
} = {}) {
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const url = attempt === 0
        ? QUOTA_URL
        : `${QUOTA_URL}&__kcc_refresh=${Date.now()}-${attempt}`
      await window.loadURL(url, {
        extraHeaders: 'Cache-Control: no-cache\r\nPragma: no-cache\r\n'
      })
      return
    } catch (error) {
      lastError = error
      if (!isTransientQuotaLoadError(error) || attempt === attempts - 1) throw error

      if (attempt === 0) {
        const targetSession = window.webContents.session
        await Promise.allSettled([
          targetSession.clearCache(),
          targetSession.clearStorageData({
            origin: 'https://www.kimi.com',
            storages: ['serviceworkers', 'cachestorage']
          })
        ])
      }
      await wait(500 * (attempt + 1))
    }
  }

  throw lastError
}

export function isTransientQuotaLoadError(error) {
  const code = Number(error?.errno ?? error?.code)
  const message = error instanceof Error ? error.message : String(error || '')
  return code === -2
    || code === -3
    || /ERR_(?:FAILED|ABORTED)\s*\((?:-2|-3)\)/i.test(message)
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
