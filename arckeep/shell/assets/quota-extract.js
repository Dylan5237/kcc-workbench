(() => {
  const clean = value => (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
  const bodyText = clean(document.body ? document.body.innerText : '')
  const elements = Array.from(document.querySelectorAll('body *'))
  const quotaHeading = /总(?:使用量|额度|额度总量)/
  const fiveHeading = /5\s*小时用量/
  const sevenHeading = /7\s*天用量/

  const numberFrom = (source, pattern) => {
    const match = source.match(pattern)
    return match ? Number(match[1]) : null
  }

  const textFrom = (source, pattern) => {
    const match = source.match(pattern)
    return match ? clean(match[1]) : ''
  }

  const sectionBetween = (source, startPattern, endPattern) => {
    const startMatch = source.match(startPattern)
    if (!startMatch || startMatch.index === undefined) return ''
    const start = startMatch.index
    const tail = source.slice(start + startMatch[0].length)
    const endOffset = tail.search(endPattern)
    return endOffset < 0
      ? source.slice(start)
      : source.slice(start, start + startMatch[0].length + endOffset)
  }

  const percentNear = (source, label) => {
    const escaped = label === 'Kimi' ? 'Kimi' : 'Code'
    return numberFrom(
      source,
      new RegExp(escaped + '\\s*[:：]?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%', 'i')
    ) ?? numberFrom(
      source,
      new RegExp('([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*' + escaped, 'i')
    )
  }

  const totalSection = sectionBetween(bodyText, quotaHeading, fiveHeading)
  const fiveSection = sectionBetween(bodyText, fiveHeading, sevenHeading)
  const sevenStart = bodyText.search(sevenHeading)
  const sevenSection = sevenStart < 0 ? '' : bodyText.slice(sevenStart)

  const total = numberFrom(
    bodyText,
    /总(?:使用量|额度|额度总量)\s*([0-9]+(?:\.[0-9]+)?)%/
  )
  const five = percentNear(fiveSection, 'Code')
  const seven = percentNear(sevenSection, 'Code')
  const totalReset = textFrom(
    totalSection,
    /([0-9]{4}-[0-9]{2}-[0-9]{2})\s*后重置/
  ) || textFrom(
    bodyText,
    /总(?:使用量|额度|额度总量)[\s\S]{0,600}?([0-9]{4}-[0-9]{2}-[0-9]{2})\s*后重置/
  )
  const fiveReset = textFrom(
    fiveSection,
    /([0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*后重置/
  )
  const sevenReset = textFrom(
    sevenSection,
    /([0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})\s*后重置/
  )

  // Prefer visible Kimi/Code percentages; this survives quota layout/CSS changes.
  let kimi = percentNear(totalSection, 'Kimi')
  let code = percentNear(totalSection, 'Code')

  const parsePercent = value => {
    const match = String(value || '').match(/([0-9]+(?:\.[0-9]+)?)\s*%/)
    return match ? Number(match[1]) : null
  }

  const classText = element => {
    const value = element.className
    return typeof value === 'string' ? value : value?.baseVal || ''
  }

  const metadata = element => [
    element.id,
    classText(element),
    element.getAttribute('aria-label'),
    element.getAttribute('data-label'),
    element.getAttribute('data-name'),
    element.getAttribute('data-value'),
    element.getAttribute('title')
  ].filter(Boolean).join(' ')

  const hasName = (element, name) => {
    const value = metadata(element)
    return new RegExp('(?:^|[^a-z])' + name + '(?:$|[^a-z])', 'i').test(value)
  }

  const trackRatio = element => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 2 || rect.height < 6 || rect.height > 40) return null
    let ancestor = element.parentElement
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const track = ancestor.getBoundingClientRect()
      if (track.width >= rect.width + 2 && track.width >= 100 && track.height >= rect.height - 4) {
        return rect.width / track.width * 100
      }
    }
    return null
  }

  // Some versions expose the segment name in class/data attributes instead of text.
  const namedBarPercent = name => {
    for (const element of elements) {
      if (!hasName(element, name)) continue
      const direct = parsePercent(
        element.getAttribute('aria-valuenow')
        || element.getAttribute('data-percent')
        || element.getAttribute('data-value')
        || element.getAttribute('style')
      )
      if (direct !== null && direct >= 0 && direct <= 100) return direct
      const ratio = trackRatio(element)
      if (ratio !== null) return ratio
    }
    return null
  }

  // Compatibility with older Kimi pages that expose only a black/blue stacked bar.
  const smallestMatching = predicate => {
    const matches = elements.filter(predicate)
    return matches.find(element => !Array.from(element.children).some(predicate)) || matches[0] || null
  }
  const totalLabel = smallestMatching(element =>
    new RegExp('^' + quotaHeading.source + '\\s*[0-9]+(?:\\.[0-9]+)?%$').test(clean(element.textContent))
  )
  const fiveLabel = smallestMatching(element =>
    clean(element.textContent) === '5 小时用量' || clean(element.textContent) === '5小时用量'
  )
  if ((kimi === null || code === null) && total !== null) {
    kimi = kimi ?? namedBarPercent('kimi')
    code = code ?? namedBarPercent('code')
  }

  if ((kimi === null || code === null) && totalLabel && fiveLabel && total !== null) {
    const top = totalLabel.getBoundingClientRect().bottom
    const bottom = fiveLabel.getBoundingClientRect().top
    const parseColor = value => {
      const hex = String(value || '').match(/#([0-9a-f]{3,8})/i)
      if (hex) {
        const raw = hex[1].length === 3
          ? hex[1].split('').map(char => char + char).join('')
          : hex[1]
        return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)]
      }
      const rgb = String(value || '').match(/rgba?\s*\(\s*([0-9.]+)[, ]+\s*([0-9.]+)[, ]+\s*([0-9.]+)/i)
      return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : []
    }
    const colored = elements.map(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const colors = [
        style.backgroundColor,
        style.background,
        style.backgroundImage,
        style.fill,
        element.getAttribute('fill')
      ].map(parseColor).find(value => value.length >= 3) || []
      return { element, rect, rgb: colors }
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
        ) continue
        let ancestor = black.element.parentElement
        for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
          if (!ancestor.contains(blue.element)) continue
          const track = ancestor.getBoundingClientRect()
          if (track.width < 160 || track.width + 2 < black.rect.width + blue.rect.width) continue
          const candidateKimi = black.rect.width / track.width * 100
          const candidateCode = blue.rect.width / track.width * 100
          if (Math.abs(candidateKimi + candidateCode - total) <= 0.8) {
            kimi = kimi ?? candidateKimi
            code = code ?? candidateCode
            break outer
          }
        }
      }
    }
  }

  // If one label is omitted by the page, recover it from the total.
  if (total !== null && kimi === null && code !== null) kimi = total - code
  if (total !== null && code === null && kimi !== null) code = total - kimi
  if (
    kimi !== null && code !== null
    && (kimi < 0 || code < 0 || kimi > 100 || code > 100 || Math.abs(kimi + code - (total || 0)) > 0.8)
  ) {
    kimi = null
    code = null
  }

  const planNames = ['Allegretto', 'Allegro', 'Moderato', 'Vivace']
  const planPattern = name => new RegExp('(?:^|[^A-Za-z])' + name + '(?:$|[^A-Za-z])', 'i')
  const planFromText = value => {
    const text = clean(value)
    return planNames.find(name => planPattern(name).test(text)) || ''
  }
  const membershipPlan = (() => {
    const active = elements.filter(element => {
      const attrs = [
        'aria-current', element.getAttribute('aria-current'),
        'aria-selected', element.getAttribute('aria-selected'),
        'data-selected', element.getAttribute('data-selected'),
        'data-active', element.getAttribute('data-active'),
        classText(element)
      ].join(' ')
      return /(^|[ =_-])(active|current|selected|checked|subscribed)(?=$|[ =_-])/i.test(attrs)
    })
    const activePlans = active
      .map(element => planFromText(element.textContent))
      .filter(Boolean)
    if (activePlans.length) return activePlans[0]
    const bodyPlans = planNames.filter(name => planPattern(name).test(bodyText))
    return bodyPlans.length === 1 ? bodyPlans[0] : ''
  })()

  const hasQuota = quotaHeading.test(bodyText)
  // Arckeep 修正（2026-08-30）：kimi.com 现版页面的总额度分项（Kimi/Code）只剩视觉条、无数字，
  // 分项缺失不再视为未就绪；分项保持 best-effort（能读到才展示）。
  const ready = total !== null
    && five !== null
    && seven !== null
    && Boolean(totalReset)
    && Boolean(fiveReset)
    && Boolean(sevenReset)

  const likelyLoggedOut = /登录|扫码登录|手机号登录/.test(bodyText) && !hasQuota

  return {
    ready,
    likelyLoggedOut,
    membershipPlan,
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
