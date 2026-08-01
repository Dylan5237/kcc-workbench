import assert from 'node:assert/strict'
import test from 'node:test'
import { createGracefulShutdownHandler } from '../src/main/graceful-shutdown.js'

test('waits for asynchronous cleanup before allowing Electron to quit', async () => {
  let releaseCleanup
  let quitCalls = 0
  let prevented = 0
  const cleanup = new Promise(resolve => { releaseCleanup = resolve })
  const handler = createGracefulShutdownHandler({
    quit: () => { quitCalls += 1 },
    shutdown: () => cleanup
  })
  const event = { preventDefault: () => { prevented += 1 } }

  const first = handler(event)
  const second = handler(event)
  assert.equal(first, second)
  assert.equal(prevented, 2)
  assert.equal(quitCalls, 0)

  releaseCleanup()
  await first
  assert.equal(quitCalls, 1)

  handler(event)
  assert.equal(prevented, 2)
  assert.equal(quitCalls, 1)
})
