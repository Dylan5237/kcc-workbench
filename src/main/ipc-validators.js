const DOGFOOD_TYPES = new Set(['问题', '想法', '正向反馈'])
const DOGFOOD_MAX_TEXT = 20000

export function normalizeDogfoodCreateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('记录参数无效')
  const type = String(input.type || '')
  const text = String(input.text || '').trim()
  if (!DOGFOOD_TYPES.has(type)) throw new Error('记录类型无效')
  if (!text || text.length > DOGFOOD_MAX_TEXT) throw new Error('记录内容无效')
  return { type, text }
}

export function normalizeDogfoodUpdateInput(input) {
  if (!input || typeof input !== 'object') throw new Error('更新参数无效')
  const id = String(input.id || '').trim()
  if (!id || id.length > 100) throw new Error('记录 id 无效')
  const patch = {}
  if (input.type !== undefined) {
    if (!DOGFOOD_TYPES.has(input.type)) throw new Error('记录类型无效')
    patch.type = input.type
  }
  if (input.text !== undefined) {
    const text = String(input.text || '').trim()
    if (!text || text.length > DOGFOOD_MAX_TEXT) throw new Error('记录内容无效')
    patch.text = text
  }
  if (!Object.keys(patch).length) throw new Error('没有可更新的字段')
  return { id, patch }
}

export function normalizeDogfoodDeleteInput(input) {
  const id = String(input?.id ?? input ?? '').trim()
  if (!id || id.length > 100) throw new Error('记录 id 无效')
  return { id }
}

export function requireSender(event, expectedWebContents) {
  if (!expectedWebContents || event.sender.id !== expectedWebContents.id) {
    throw new Error('Blocked IPC from an unexpected renderer')
  }
}

export function normalizeForkRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('分叉参数无效')
  const checkpointId = String(input.checkpointId || '').trim()
  const branchName = String(input.branchName || '').trim()
  const targetPath = String(input.targetPath || '').trim()
  if (!checkpointId || checkpointId.length > 200) throw new Error('时间点无效')
  if (!branchName || branchName.length > 120) throw new Error('分支名无效')
  if (targetPath.length > 4096) throw new Error('目标目录无效')
  return { checkpointId, branchName, targetPath }
}
