export const QUOTA_STATS_API_PATH = '/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats'

// Kimi Web 的额度页通过 Connect JSON 调用该接口。请求在页面上下文执行，
// 因此复用页面已有的登录 Cookie/localStorage，而不把凭据带回主进程。
export const QUOTA_STATS_REQUEST_SCRIPT = String.raw`
(async () => {
  try {
    const token = localStorage.getItem('access_token') || localStorage.getItem('auth-token') || ''
    const headers = {
      'Content-Type': 'application/json',
      'x-msh-platform': 'web',
      'x-msh-version': '2.0.0',
      'R-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      'X-Language': document.documentElement?.lang || 'zh-CN'
    }
    try {
      const tokenInfo = JSON.parse(localStorage.getItem('volcano-token-info') || 'null')
      if (tokenInfo?.userId) headers['X-Traffic-Id'] = tokenInfo.userId
      if (tokenInfo?.webId) headers['x-msh-device-id'] = tokenInfo.webId
      if (tokenInfo?.ssid) headers['x-msh-session-id'] = tokenInfo.ssid
    } catch {}
    if (token) headers.Authorization = 'Bearer ' + token
    const response = await fetch('${QUOTA_STATS_API_PATH}', {
      method: 'POST',
      headers,
      credentials: 'include',
      cache: 'no-store',
      body: '{}'
    })
    const text = await response.text()
    let payload = null
    try { payload = JSON.parse(text) } catch {}
    return { ok: response.ok, status: response.status, payload }
  } catch (error) {
    return { ok: false, status: null, payload: null, error: String(error) }
  }
})()
`

export function mapQuotaStats(payload, membershipPlan = '') {
  const source = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const balance = firstObject(source, 'subscription_balance', 'subscriptionBalance')
  const total = percentFromRatio(firstValue(balance, 'amount_used_ratio', 'amountUsedRatio'))
  const code = percentFromRatio(firstValue(balance, 'kimi_code_used_ratio', 'kimiCodeUsedRatio'))
  const totalPercent = total
  const codePercent = code === null ? (total === null ? null : 0) : code
  const kimiPercent = total === null ? null : Math.max(total - codePercent, 0)
  const five = firstObject(source, 'ratelimit_code_5h', 'ratelimitCode5h')
  const seven = firstObject(source, 'ratelimit_code_7d', 'ratelimitCode7d')
  const fiveReset = formatResetTime(firstValue(five, 'reset_time', 'resetTime'))
  const sevenReset = formatResetTime(firstValue(seven, 'reset_time', 'resetTime'))
  const totalReset = formatResetDate(firstValue(balance, 'expire_time', 'expireTime'))
  const result = {
    ready: totalPercent !== null
      && kimiPercent !== null
      && codePercent !== null
      && percentFromRatio(firstValue(five, 'ratio')) !== null
      && percentFromRatio(firstValue(seven, 'ratio')) !== null
      && Boolean(totalReset)
      && Boolean(fiveReset)
      && Boolean(sevenReset),
    likelyLoggedOut: false,
    membershipPlan,
    totalPercent: totalPercent ?? 0,
    kimiPercent: kimiPercent ?? 0,
    codePercent: codePercent ?? 0,
    fiveHourPercent: percentFromRatio(firstValue(five, 'ratio')) ?? 0,
    sevenDayPercent: percentFromRatio(firstValue(seven, 'ratio')) ?? 0,
    totalReset,
    fiveHourReset: fiveReset,
    sevenDayReset: sevenReset,
    error: ''
  }
  if (!result.ready) result.error = '官方额度接口未返回完整数据。'
  return result
}

function firstValue(source, ...keys) {
  if (!source || typeof source !== 'object') return undefined
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key]
  }
  return undefined
}

function firstObject(source, ...keys) {
  const value = firstValue(source, ...keys)
  return value && typeof value === 'object' ? value : null
}

function percentFromRatio(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  const percent = number <= 1 ? number * 100 : number
  return percent <= 100 ? Number(percent.toFixed(2)) : null
}

function timestampToDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(number) && number > 0) {
      return new Date(number < 1e12 ? number * 1000 : number)
    }
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (value && typeof value === 'object') {
    const seconds = Number(value.seconds ?? value.timestamp?.seconds)
    if (Number.isFinite(seconds)) {
      const nanos = Number(value.nanos ?? value.timestamp?.nanos) || 0
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6))
    }
  }
  return null
}

function formatResetDate(value) {
  const date = timestampToDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function formatResetTime(value) {
  const date = timestampToDate(value)
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
