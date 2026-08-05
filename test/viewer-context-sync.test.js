import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundContextSync } from '../src/main/viewer-context-sync.js'

function createFakeTimers() {
  let nextId = 0
  const timeouts = new Map()
  const intervals = new Map()
  return {
    setTimeout(callback) {
      const id = ++nextId
      timeouts.set(id, callback)
      return id
    },
    clearTimeout(id) { timeouts.delete(id) },
    setInterval(callback) {
      const id = ++nextId
      intervals.set(id, callback)
      return id
    },
    clearInterval(id) { intervals.delete(id) },
    async flushTimeouts() {
      const callbacks = [...timeouts.values()]
      timeouts.clear()
      for (const callback of callbacks) await callback()
    },
    async tickIntervals() {
      for (const callback of intervals.values()) callback()
      await this.flushTimeouts()
    },
    get intervalCount() { return intervals.size }
  }
}

test('syncs immediately, on request, and on the background poll', async () => {
  const timers = createFakeTimers()
  let calls = 0
  const controller = createBackgroundContextSync({
    sync: async () => { calls += 1 },
    timers
  })

  controller.start()
  await timers.flushTimeouts()
  assert.equal(calls, 1)

  controller.request()
  await timers.flushTimeouts()
  assert.equal(calls, 2)

  await timers.tickIntervals()
  assert.equal(calls, 3)
  controller.stop()
  assert.equal(timers.intervalCount, 0)
})

test('stops pending background synchronization when the window closes', async () => {
  const timers = createFakeTimers()
  let calls = 0
  const controller = createBackgroundContextSync({
    sync: async () => { calls += 1 },
    timers
  })

  controller.start()
  controller.stop()
  await timers.flushTimeouts()
  await timers.tickIntervals()
  assert.equal(calls, 0)
})
