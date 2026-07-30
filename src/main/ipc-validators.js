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
