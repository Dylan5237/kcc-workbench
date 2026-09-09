import assert from 'node:assert/strict'
import test from 'node:test'
import { selectDogfoodCaptureContext } from '../src/main/dogfood-context.js'

// R1 合同: projectRoot/sessionId 只能来自同一个 last-successfully-applied
// Viewer context; 失败 apply 不写入, 引擎不匹配时两个字段一起为 null。
// (失败 apply 不写入的语义由 main.js 中 setConversationContext 成功返回后
// 才更新 lastAppliedViewerContext 的顺序保证; 这里验证选择逻辑本身。)

test('Case A: successful Kimi context arm 后 capture 带出完整 provenance', () => {
  const applied = { engine: 'kimi', projectDirectory: 'D:\\proj\\A', sessionId: 'session_a' }
  assert.deepEqual(selectDogfoodCaptureContext(applied, 'kimi'), {
    projectRoot: 'D:\\proj\\A',
    sessionId: 'session_a'
  })
})

test('Case B: CloudCLI apply 失败后不得返回旧 Kimi root', () => {
  // 失败 apply 不更新 lastAppliedViewerContext; 它仍是旧 Kimi context,
  // 但 activeEngine 已是 cloudcli -> 两个字段必须一起为 null。
  const applied = { engine: 'kimi', projectDirectory: 'D:\\proj\\A', sessionId: 'session_a' }
  assert.deepEqual(selectDogfoodCaptureContext(applied, 'cloudcli'), {
    projectRoot: null,
    sessionId: null
  })
})

test('Case C: CloudCLI context 成功 apply 后 capture 带出新 provenance', () => {
  const applied = { engine: 'cloudcli', projectDirectory: 'D:\\proj\\B', sessionId: 'session_b' }
  assert.deepEqual(selectDogfoodCaptureContext(applied, 'cloudcli'), {
    projectRoot: 'D:\\proj\\B',
    sessionId: 'session_b'
  })
})

test('Case D: 存在旧 Kimi successful context 但引擎已切且无新 context -> 全 null', () => {
  const applied = { engine: 'kimi', projectDirectory: 'D:\\proj\\A', sessionId: 'session_a' }
  assert.deepEqual(selectDogfoodCaptureContext(applied, 'cloudcli'), {
    projectRoot: null,
    sessionId: null
  })
})

test('no successful apply ever -> 全 null', () => {
  assert.deepEqual(selectDogfoodCaptureContext(null, 'kimi'), {
    projectRoot: null,
    sessionId: null
  })
  assert.deepEqual(selectDogfoodCaptureContext(undefined, 'cloudcli'), {
    projectRoot: null,
    sessionId: null
  })
})

test('workspace-only context (无 sessionId) 保持 root 且 sessionId 为 null', () => {
  const applied = { engine: 'kimi', projectDirectory: 'D:\\proj\\A', sessionId: null }
  assert.deepEqual(selectDogfoodCaptureContext(applied, 'kimi'), {
    projectRoot: 'D:\\proj\\A',
    sessionId: null
  })
})
