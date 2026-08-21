import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

async function loadTreeState() {
  const source = await readFile(
    new URL('../src/viewer/public/tree-state.js', import.meta.url),
    'utf8'
  )
  const context = vm.createContext({})
  vm.runInContext(source, context)
  return context.ViewerTreeState
}

test('expands top two directory levels by default', async () => {
  const state = await loadTreeState()
  const expanded = new Set()
  const collapsed = new Set()

  assert.equal(state.isExpanded({
    depth: 0,
    path: 'src',
    filter: '',
    expanded,
    collapsed
  }), true)
  assert.equal(state.isExpanded({
    depth: 1,
    path: 'src/viewer',
    filter: '',
    expanded,
    collapsed
  }), true)
  assert.equal(state.isExpanded({
    depth: 2,
    path: 'src/viewer/public',
    filter: '',
    expanded,
    collapsed
  }), false)
})

test('preserves manual directory toggles and expands filtered matches', async () => {
  const state = await loadTreeState()
  const expanded = new Set()
  const collapsed = new Set()

  assert.equal(state.toggle({
    depth: 1,
    path: 'src/viewer',
    expanded,
    collapsed
  }), false)
  assert.equal(state.isExpanded({
    depth: 1,
    path: 'src/viewer',
    filter: '',
    expanded,
    collapsed
  }), false)

  assert.equal(state.toggle({
    depth: 0,
    path: 'src',
    expanded,
    collapsed
  }), false)
  assert.equal(state.isExpanded({
    depth: 0,
    path: 'src',
    filter: '',
    expanded,
    collapsed
  }), false)
  assert.equal(state.isExpanded({
    depth: 2,
    path: 'src/viewer/public',
    filter: 'app',
    expanded,
    collapsed
  }), true)
})

test('formats file timestamps as month-day hour-minute', async () => {
  const state = await loadTreeState()
  const timestamp = new Date(2026, 6, 29, 8, 5).getTime()

  assert.equal(state.formatTimestamp(timestamp), '07-29 08:05')
  assert.equal(state.formatTimestamp('invalid'), '--')
})

test('detects file changes by modification time or size', async () => {
  const state = await loadTreeState()
  const current = { mtime: 1000, size: 20 }

  assert.equal(state.isFileVersionChanged(current, { mtime: 1000, size: 20 }), false)
  assert.equal(state.isFileVersionChanged(current, { mtime: 1001, size: 20 }), true)
  assert.equal(state.isFileVersionChanged(current, { mtime: 1000, size: 21 }), true)
})
