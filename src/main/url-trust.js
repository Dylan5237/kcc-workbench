// 判断 URL 是否为本应用可信的本地内容, 用于 default session 的权限闸门:
// 仅可信 origin 才放行 clipboard-sanitized-write / fullscreen 等。
// 可信来源: Viewer 本地 HTTP 服务、Kimi Web 本地服务、demo 模式的 app: 协议。
export function isAllowedKimiCodeUrl(value, { viewerPort, kimiUrl, demoMode = false } = {}) {
  try {
    const url = new URL(value)
    if (url.protocol === 'app:' && demoMode) return true
    if (viewerPort && url.origin === `http://127.0.0.1:${viewerPort}`) return true
    if (!kimiUrl) return false
    return url.origin === new URL(kimiUrl).origin
  } catch {
    return false
  }
}

export function createKimiCodeUrlGuard(getOptions) {
  if (typeof getOptions !== 'function') {
    throw new TypeError('getOptions must be a function')
  }
  return value => isAllowedKimiCodeUrl(value, getOptions() || {})
}
