export function extractKimiWebUrl(value) {
  const match = String(value).match(
    /(?:Kimi server:\s*|Local:\s*)(https?:\/\/\S+#token=[^\s]+)/i
  )
  return match ? trimUrl(match[1]) : ''
}

export function extractKimiWebToken(value) {
  try {
    const url = new URL(String(value))
    return new URLSearchParams(url.hash.replace(/^#/, '')).get('token') || ''
  } catch {
    return ''
  }
}

export function buildAuthenticatedKimiWebUrl(origin, token = '') {
  try {
    const url = new URL(String(origin))
    if (token) url.hash = `token=${encodeURIComponent(token)}`
    return url.toString()
  } catch {
    return String(origin)
  }
}

export function parseKimiSessionId(value) {
  try {
    const url = new URL(String(value))
    const prefix = '/sessions/'
    if (!url.pathname.startsWith(prefix)) return ''
    const encoded = url.pathname.slice(prefix.length)
    if (!encoded || encoded.includes('/')) return ''
    return decodeURIComponent(encoded)
  } catch {
    return ''
  }
}

export function redactUrlToken(value) {
  return String(value)
    .replace(/(#token=)[^\s\r\n]+/gi, '$1[redacted]')
    .replace(/(Token:\s*)[^\s\r\n]+/gi, '$1[redacted]')
}

function trimUrl(value) {
  return String(value).replace(/[\])},.;]+$/g, '')
}
