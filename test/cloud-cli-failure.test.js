import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('CloudCLI failures use a dedicated actionable error page', async () => {
  const [mainSource, errorPage] = await Promise.all([
    readFile(new URL('src/main/main.js', root), 'utf8'),
    readFile(new URL('src/renderer/service-error-cloudcli.html', root), 'utf8')
  ])

  assert.match(mainSource, /cloudCliView\.webContents\.loadURL\('app:\/\/shell\/service-error-cloudcli\.html'\)/)
  assert.match(mainSource, /getURL\(\)\.startsWith\('app:\/\/shell\/service-'\)/)
  assert.match(errorPage, /CloudCLI 启动失败/)
  assert.match(errorPage, /Node\.js 22/)
  assert.match(errorPage, /process\.versions\.modules/)
  assert.match(errorPage, /cloudcli-web\.log/)
  assert.doesNotMatch(errorPage, /Kimi Code Web 启动失败/)
})

test('CloudCLI startup failures are persisted before cleanup', async () => {
  const serviceSource = await readFile(new URL('src/main/cloud-cli-service.js', root), 'utf8')

  assert.match(serviceSource, /CloudCLI start failed:/)
  assert.match(serviceSource, /await this\.writeLog/)
  assert.match(serviceSource, /await this\.stop\(\)/)
})
