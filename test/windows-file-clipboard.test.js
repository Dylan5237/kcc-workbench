import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWindowsFileClipboardScript } from '../src/main/windows-file-clipboard.js'

test('encodes file paths without interpolating them into PowerShell source', () => {
  const paths = [
    'D:\\项目\\说明 "最终".md',
    "D:\\project\\it's-safe.json"
  ]
  const script = buildWindowsFileClipboardScript(paths)

  assert.match(script, /SetFileDropList/)
  assert.match(script, /Preferred DropEffect/)
  assert.doesNotMatch(script, /说明/)
  assert.doesNotMatch(script, /it's-safe/)

  const payload = script.match(/FromBase64String\('([^']+)'\)/)?.[1]
  assert.ok(payload)
  assert.deepEqual(
    JSON.parse(Buffer.from(payload, 'base64').toString('utf8')),
    paths
  )
})
