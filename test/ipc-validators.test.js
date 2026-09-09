import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requireSender,
  normalizeForkRequest,
  normalizeDogfoodCreateInput,
  normalizeDogfoodUpdateInput,
  normalizeDogfoodDeleteInput
} from '../src/main/ipc-validators.js'

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

test('normalizeDogfoodCreateInput trims and returns valid input', () => {
  assert.deepEqual(
    normalizeDogfoodCreateInput({ type: '问题', text: '  Viewer 又是空的  ' }),
    { type: '问题', text: 'Viewer 又是空的' }
  )
  assert.deepEqual(
    normalizeDogfoodCreateInput({ type: '正向反馈', text: '顺' }),
    { type: '正向反馈', text: '顺' }
  )
})

test('normalizeDogfoodCreateInput rejects invalid payloads', () => {
  assert.throws(() => normalizeDogfoodCreateInput(null), /记录参数无效/)
  assert.throws(() => normalizeDogfoodCreateInput({ type: 'bug', text: 'x' }), /记录类型无效/)
  assert.throws(() => normalizeDogfoodCreateInput({ type: '问题', text: '  ' }), /记录内容无效/)
  assert.throws(
    () => normalizeDogfoodCreateInput({ type: '问题', text: 'x'.repeat(20001) }),
    /记录内容无效/
  )
})

test('normalizeDogfoodUpdateInput requires id and at least one patch field', () => {
  assert.deepEqual(
    normalizeDogfoodUpdateInput({ id: 'abc', type: '想法' }),
    { id: 'abc', patch: { type: '想法' } }
  )
  assert.deepEqual(
    normalizeDogfoodUpdateInput({ id: 'abc', text: ' new ', type: '问题' }),
    { id: 'abc', patch: { text: 'new', type: '问题' } }
  )
  assert.throws(() => normalizeDogfoodUpdateInput({ text: 'x' }), /记录 id 无效/)
  assert.throws(() => normalizeDogfoodUpdateInput({ id: 'abc' }), /没有可更新的字段/)
  assert.throws(() => normalizeDogfoodUpdateInput({ id: 'abc', type: 'nope' }), /记录类型无效/)
  assert.throws(() => normalizeDogfoodUpdateInput({ id: 'abc', text: ' ' }), /记录内容无效/)
})

test('normalizeDogfoodDeleteInput accepts a bare id or { id } and rejects empties', () => {
  assert.deepEqual(normalizeDogfoodDeleteInput({ id: 'abc' }), { id: 'abc' })
  assert.deepEqual(normalizeDogfoodDeleteInput('abc'), { id: 'abc' })
  assert.throws(() => normalizeDogfoodDeleteInput({ id: '' }), /记录 id 无效/)
  assert.throws(() => normalizeDogfoodDeleteInput(null), /记录 id 无效/)
})
