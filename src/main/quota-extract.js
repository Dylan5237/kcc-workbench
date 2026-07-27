export const QUOTA_EXTRACTION_SCRIPT = String.raw`
(() => {
  const clean = value => (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  const bodyText = clean(document.body ? document.body.innerText : '')
  const number = pattern => {
    const match = bodyText.match(pattern)
    return match ? Number(match[1]) : null
  }
  const text = pattern => {
    const match = bodyText.match(pattern)
    return match ? clean(match[1]) : ''
  }

  const total = number(/总使用量\s*([0-9]+(?:\.[0-9]+)?)%/)
  const five = number(/5\s*小时用量[\s\S]{0,240}?Code\s*([0-9]+(?:\.[0-9]+)?)%/)
  const seven = number(/7\s*天用量[\s\S]{0,240}?Code\s*([0-9]+(?:\.[0-9]+)?)%/)
  const totalReset = text(/总使用量\s*[0-9]+(?:\.[0-9]+)?%[\s\S]{0,600}?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*后重置/)
  const fiveReset = text(/5\s*小时用量[\s\S]{0,300}?([0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*后重置/)
  const sevenReset = text(/7\s*天用量[\s\S]{0,300}?([0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*后重置/)

  const elements = Array.from(document.querySelectorAll('body *'))
  const smallestMatching = predicate => {
    const matches = elements.filter(predicate)
    return matches.find(element => !Array.from(element.children).some(predicate)) || matches[0] || null
  }
  const totalLabel = smallestMatching(element =>
    /^总使用量\s*[0-9]+(?:\.[0-9]+)?%$/.test(clean(element.textContent)))
  const fiveLabel = smallestMatching(element =>
    clean(element.textContent) === '5 小时用量' || clean(element.textContent) === '5小时用量')

  let kimi = null
  let code = null
  if (totalLabel && fiveLabel && total !== null) {
    const top = totalLabel.getBoundingClientRect().bottom
    const bottom = fiveLabel.getBoundingClientRect().top
    const colored = elements.map(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const rgb = (style.backgroundColor.match(/\d+/g) || []).map(Number)
      return { element, rect, rgb }
    }).filter(item =>
      item.rect.top >= top
      && item.rect.bottom <= bottom
      && item.rect.width > 2
      && item.rect.height >= 6
      && item.rect.height <= 40
      && item.rgb.length >= 3)

    const blacks = colored.filter(item =>
      item.rgb[0] < 65 && item.rgb[1] < 65 && item.rgb[2] < 65)
    const blues = colored.filter(item =>
      item.rgb[2] > 150
      && item.rgb[2] > item.rgb[0] * 1.35
      && item.rgb[2] > item.rgb[1] * 1.1)

    outer:
    for (const black of blacks) {
      for (const blue of blues) {
        if (
          Math.abs(black.rect.top - blue.rect.top) > 4
          || Math.abs(black.rect.height - blue.rect.height) > 4
        ) {
          continue
        }

        let ancestor = black.element.parentElement
        for (
          let depth = 0;
          ancestor && depth < 5;
          depth += 1, ancestor = ancestor.parentElement
        ) {
          if (!ancestor.contains(blue.element)) continue
          const track = ancestor.getBoundingClientRect()
          if (
            track.width < 160
            || track.width + 2 < black.rect.width + blue.rect.width
          ) {
            continue
          }
          const candidateKimi = black.rect.width / track.width * 100
          const candidateCode = blue.rect.width / track.width * 100
          if (Math.abs(candidateKimi + candidateCode - total) <= 0.8) {
            kimi = candidateKimi
            code = candidateCode
            break outer
          }
        }
      }
    }
  }

  const ready = total !== null
    && five !== null
    && seven !== null
    && Boolean(totalReset)
    && Boolean(fiveReset)
    && Boolean(sevenReset)
    && kimi !== null
    && code !== null

  const likelyLoggedOut = /登录|扫码登录|手机号登录/.test(bodyText)
    && !/总使用量/.test(bodyText)

  return {
    ready,
    likelyLoggedOut,
    totalPercent: total || 0,
    kimiPercent: kimi === null ? 0 : Number(kimi.toFixed(2)),
    codePercent: code === null ? 0 : Number(code.toFixed(2)),
    fiveHourPercent: five || 0,
    sevenDayPercent: seven || 0,
    totalReset,
    fiveHourReset: fiveReset,
    sevenDayReset: sevenReset,
    error: ready
      ? ''
      : likelyLoggedOut
        ? '需要登录 kimi.com 才能同步会员额度。'
        : total === null || five === null || seven === null
          ? '页面尚未显示完整额度信息。'
          : kimi === null || code === null
            ? '未能读取总额度中的 Kimi 与 Code 分项。'
            : '未能读取完整重置时间。'
  }
})()
`
