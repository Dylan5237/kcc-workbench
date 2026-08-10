import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isTransientQuotaLoadError,
  loadQuotaPage,
  QUOTA_URL
} from '../src/main/quota-navigation.js'

function fakeWindow(loadResults) {
  const calls = []
  let clearCacheCalls = 0
  let clearStorageCalls = 0
  return {
    calls,
    get clearCacheCalls() { return clearCacheCalls },
    get clearStorageCalls() { return clearStorageCalls },
    webContents: {
      session: {
        async clearCache() { clearCacheCalls += 1 },
        async clearStorageData(options) {
          clearStorageCalls += 1
          assert.equal(options.origin, 'https://www.kimi.com')
          assert.deepEqual(options.storages, ['serviceworkers', 'cachestorage'])
        }
      }
    },
    async loadURL(url, options) {
      calls.push({ url, options })
      const next = loadResults.shift()
      if (next instanceof Error) throw next
    }
  }
}

test('loads the quota page normally without clearing login storage', async () => {
  const window = fakeWindow([null])
  await loadQuotaPage(window, { wait: async () => {} })

  assert.equal(window.calls.length, 1)
  assert.equal(window.calls[0].url, QUOTA_URL)
  assert.match(window.calls[0].options.extraHeaders, /Cache-Control: no-cache/)
  assert.equal(window.clearCacheCalls, 0)
  assert.equal(window.clearStorageCalls, 0)
})

test('recovers from ERR_FAILED by clearing only cache/service workers and retrying', async () => {
  const failure = Object.assign(new Error(`ERR_FAILED (-2) loading '${QUOTA_URL}'`), { errno: -2 })
  const window = fakeWindow([failure, null])
  await loadQuotaPage(window, { wait: async () => {} })

  assert.equal(window.calls.length, 2)
  assert.match(window.calls[1].url, /__kcc_refresh=/)
  assert.equal(window.clearCacheCalls, 1)
  assert.equal(window.clearStorageCalls, 1)
})

test('does not retry permanent navigation failures', async () => {
  const failure = Object.assign(new Error('ERR_NAME_NOT_RESOLVED (-105)'), { errno: -105 })
  const window = fakeWindow([failure])

  await assert.rejects(
    loadQuotaPage(window, { wait: async () => {} }),
    /ERR_NAME_NOT_RESOLVED/
  )
  assert.equal(window.calls.length, 1)
  assert.equal(window.clearCacheCalls, 0)
})

test('recognizes both Chromium transient load codes', () => {
  assert.equal(isTransientQuotaLoadError({ errno: -2 }), true)
  assert.equal(isTransientQuotaLoadError({ code: -3 }), true)
  assert.equal(isTransientQuotaLoadError(new Error('ERR_FAILED (-2) loading URL')), true)
  assert.equal(isTransientQuotaLoadError({ errno: -105 }), false)
})
