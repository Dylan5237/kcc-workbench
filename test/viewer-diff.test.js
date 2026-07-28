import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createLineDiff } = require('../src/viewer/diff.cjs')

test('creates readable line additions and removals', () => {
  const result = createLineDiff('alpha\nold\nomega', 'alpha\nnew\nomega')
  assert.deepEqual(result.stats, { added: 1, removed: 1 })
  assert.deepEqual(
    result.lines.map(line => `${line.type}:${line.text}`),
    ['equal:alpha', 'add:new', 'remove:old', 'equal:omega']
  )
})

test('represents created and deleted files', () => {
  assert.deepEqual(createLineDiff('', 'new').stats, { added: 1, removed: 0 })
  assert.deepEqual(createLineDiff('old', '').stats, { added: 0, removed: 1 })
})
