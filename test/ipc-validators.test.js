import assert from 'node:assert/strict'
import test from 'node:test'
import { requireSender, normalizeForkRequest } from '../src/main/ipc-validators.js'

test('requireSender passes when sender matches expected webContents', () => {
  assert.doesNotThrow(() => requireSender({ sender: { id: 7 } }, { id: 7 }))
})

test('requireSender blocks IPC from a mismatched renderer', () => {
  assert.throws(
    () => requireSender({ sender: { id: 7 } }, { id: 9 }),
    /unexpected renderer/
  )
})

test('requireSender blocks IPC when expected webContents is missing', () => {
  assert.throws(
    () => requireSender({ sender: { id: 7 } }, null),
    /unexpected renderer/
  )
})

test('normalizeForkRequest trims and returns valid input', () => {
  assert.deepEqual(
    normalizeForkRequest({
      checkpointId: '  abc  ',
      branchName: 'feat/x',
      targetPath: '/tmp/work'
    }),
    { checkpointId: 'abc', branchName: 'feat/x', targetPath: '/tmp/work' }
  )
})

test('normalizeForkRequest rejects non-object input', () => {
  assert.throws(() => normalizeForkRequest(null), /分叉参数无效/)
  assert.throws(() => normalizeForkRequest('x'), /分叉参数无效/)
})

test('normalizeForkRequest rejects empty or overlong fields', () => {
  assert.throws(
    () => normalizeForkRequest({ checkpointId: '', branchName: 'b', targetPath: '' }),
    /时间点无效/
  )
  assert.throws(
    () => normalizeForkRequest({ checkpointId: 'a', branchName: '', targetPath: '' }),
    /分支名无效/
  )
  assert.throws(
    () => normalizeForkRequest({ checkpointId: 'a'.repeat(201), branchName: 'b', targetPath: '' }),
    /时间点无效/
  )
  assert.throws(
    () => normalizeForkRequest({ checkpointId: 'a', branchName: 'b'.repeat(121), targetPath: '' }),
    /分支名无效/
  )
  assert.throws(
    () => normalizeForkRequest({ checkpointId: 'a', branchName: 'b', targetPath: 'x'.repeat(4097) }),
    /目标目录无效/
  )
})
