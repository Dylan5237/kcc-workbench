import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { QuotaService } from '../src/main/quota-service.js'

function validExtracted(overrides = {}) {
  return {
    totalPercent: 20,
    kimiPercent: 15,
    codePercent: 5,
    totalReset: '2026-08-01',
    fiveHourPercent: 30,
    fiveHourReset: '08-01 10:00',
    sevenDayPercent: 25,
    sevenDayReset: '08-05 10:00',
    ...overrides
  }
}

function loginRequiredError() {
  const error = new Error('需要登录')
  error.code = 'KIMI_LOGIN_REQUIRED'
  return error
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function makeService(options = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-quota-'))
  const service = new QuotaService({
    userDataPath,
    partition: 'persist:test',
    demoMode: false,
    scraper: async () => validExtracted(),
    ...options
  })
  return { service, userDataPath }
}

test('initialize starts idle with empty history when no data file exists', async () => {
  const { service, userDataPath } = await makeService()
  await service.initialize()
  const state = service.getState()
  assert.equal(state.status, 'idle')
  assert.equal(state.snapshot, null)
  assert.equal(typeof state.forecast, 'object')
  await assert.rejects(fs.access(path.join(userDataPath, 'quota.json')))
})

test('initialize restores a persisted quota.json', async () => {
  const { service, userDataPath } = await makeService()
  const persisted = {
    version: 2,
    snapshot: {
      updatedAt: '2026-08-01T00:00:00.000Z',
      total: { usedPercent: 20, kimiPercent: 15, codePercent: 5, resetAt: '2026-08-01' },
      fiveHour: { percent: 30, resetAt: '08-01 10:00' },
      sevenDay: { percent: 25, resetAt: '08-05 10:00' }
    },
    history: []
  }
  await fs.writeFile(path.join(userDataPath, 'quota.json'), JSON.stringify(persisted))
  await service.initialize()
  assert.equal(service.getState().snapshot.total.usedPercent, 20)
})

test('initialize falls back to empty on corrupt or wrong-version data', async () => {
  const corrupt = await makeService()
  await fs.writeFile(path.join(corrupt.userDataPath, 'quota.json'), 'not json')
  await corrupt.service.initialize()
  assert.equal(corrupt.service.getState().snapshot, null)

  const wrongVersion = await makeService()
  await fs.writeFile(
    path.join(wrongVersion.userDataPath, 'quota.json'),
    JSON.stringify({ version: 1, history: [] })
  )
  await wrongVersion.service.initialize()
  assert.equal(wrongVersion.service.getState().snapshot, null)
})

test('refresh normalizes, persists atomically, and reports success', async () => {
  const { service, userDataPath } = await makeService()
  await service.initialize()
  const state = await service.refresh()

  assert.equal(state.status, 'success')
  assert.equal(state.snapshot.total.usedPercent, 20)
  assert.equal(state.snapshot.total.resetAt, '2026-08-01')

  const persisted = JSON.parse(await fs.readFile(path.join(userDataPath, 'quota.json'), 'utf8'))
  assert.equal(persisted.version, 2)
  assert.equal(persisted.snapshot.total.usedPercent, 20)
  assert.equal(persisted.history.length, 1)
  await assert.rejects(fs.access(path.join(userDataPath, 'quota.json.tmp')))
})

test('refresh caps persisted history at 60 samples', async () => {
  const { service, userDataPath } = await makeService()
  await service.initialize()
  for (let index = 0; index < 65; index += 1) await service.refresh()
  const persisted = JSON.parse(await fs.readFile(path.join(userDataPath, 'quota.json'), 'utf8'))
  assert.equal(persisted.history.length, 60)
})

test('refresh re-prompts login once then succeeds when the scraper requires it', async () => {
  let calls = 0
  let loginCalls = 0
  const scraper = async () => {
    calls += 1
    if (calls === 1) throw loginRequiredError()
    return validExtracted()
  }
  const { service } = await makeService({
    scraper,
    loginHandler: async () => { loginCalls += 1 }
  })
  await service.initialize()
  const state = await service.refresh()

  assert.equal(loginCalls, 1)
  assert.equal(calls, 2)
  assert.equal(state.status, 'success')
  assert.equal(state.snapshot.total.usedPercent, 20)
})

test('refresh without a login handler surfaces the login error', async () => {
  const { service } = await makeService({ scraper: async () => { throw loginRequiredError() } })
  await service.initialize()
  const state = await service.refresh()
  assert.equal(state.status, 'error')
  assert.match(state.error, /需要登录/)
})

test('refresh surfaces other scraper errors without writing', async () => {
  const { service, userDataPath } = await makeService({
    scraper: async () => { throw new Error('网络超时') }
  })
  await service.initialize()
  const state = await service.refresh()
  assert.equal(state.status, 'error')
  assert.match(state.error, /网络超时/)
  await assert.rejects(fs.access(path.join(userDataPath, 'quota.json')))
})

test('refresh rejects an invalid snapshot before persisting it', async () => {
  const { service, userDataPath } = await makeService({
    scraper: async () => validExtracted({ totalPercent: 150 })
  })
  await service.initialize()
  const state = await service.refresh()
  assert.equal(state.status, 'error')
  assert.match(state.error, /无效百分比/)
  await assert.rejects(fs.access(path.join(userDataPath, 'quota.json')))
})

test('demo mode writes demo data to disk', async () => {
  const { service, userDataPath } = await makeService({ demoMode: true })
  await service.initialize()
  const state = await service.refresh()
  assert.equal(state.status, 'success')
  assert.equal(typeof state.snapshot.total.usedPercent, 'number')
  const persisted = JSON.parse(await fs.readFile(path.join(userDataPath, 'quota.json'), 'utf8'))
  assert.equal(persisted.version, 2)
  assert.equal(typeof persisted.snapshot.total.usedPercent, 'number')
  // demo 模式 initialize 注入 2 条样例, refresh 追加 1 条
  assert.equal(persisted.history.length, 3)
})

test('refresh notifies subscribers through syncing and success', async () => {
  const events = []
  const { service } = await makeService({ onStateChange: state => events.push(state.status) })
  await service.initialize()
  await service.refresh()
  assert.ok(events.includes('idle'))
  assert.ok(events.includes('syncing'))
  assert.ok(events.includes('success'))
})

test('refresh deduplicates concurrent calls', async () => {
  let calls = 0
  const scraper = async () => {
    calls += 1
    await delay(30)
    return validExtracted()
  }
  const { service } = await makeService({ scraper })
  await service.initialize()
  const [first, second] = await Promise.all([service.refresh(), service.refresh()])
  assert.equal(calls, 1)
  assert.equal(first.status, 'success')
  assert.equal(second.status, 'success')
})

test('writeData creates missing parent directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kimi-quota-'))
  const userDataPath = path.join(root, 'nested', 'deeper')
  const service = new QuotaService({
    userDataPath,
    partition: 'persist:test',
    demoMode: false,
    scraper: async () => validExtracted()
  })
  await service.initialize()
  await service.refresh()
  const persisted = JSON.parse(await fs.readFile(path.join(userDataPath, 'quota.json'), 'utf8'))
  assert.equal(persisted.snapshot.total.usedPercent, 20)
})
