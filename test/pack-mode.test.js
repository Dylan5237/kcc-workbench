import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('pack help documents separate fast and portable modes', () => {
  const output = execFileSync(process.execPath, ['scripts/pack.mjs', '--help'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8'
  })

  assert.match(output, /Full portable build/)
  assert.match(output, /Fast unpacked build/)
  assert.match(output, /dist-fast/)
})
