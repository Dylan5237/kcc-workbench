const METRICS = [
  {
    key: 'fiveHour',
    percentPath: ['fiveHour', 'percent'],
    resetPath: ['fiveHour', 'resetAt'],
    label: '5 小时额度'
  },
  {
    key: 'sevenDay',
    percentPath: ['sevenDay', 'percent'],
    resetPath: ['sevenDay', 'resetAt'],
    label: '7 天额度'
  },
  {
    key: 'total',
    percentPath: ['total', 'usedPercent'],
    resetPath: ['total', 'resetAt'],
    label: '总额度'
  }
]

export function buildForecast(history, now = new Date()) {
  const samples = Array.isArray(history)
    ? history.filter(sample => sample && sample.updatedAt).slice(-60)
    : []
  const forecasts = Object.fromEntries(
    METRICS.map(metric => [
      metric.key,
      forecastMetric(metric, samples, now)
    ])
  )

  const severity = {
    critical: 4,
    warning: 3,
    safe: 2,
    stable: 1,
    insufficient: 0
  }
  const overall = Object.values(forecasts).reduce(
    (current, item) =>
      severity[item.status] > severity[current.status] ? item : current,
    { status: 'insufficient', message: '再同步一次后生成燃尽预测。' }
  )

  return {
    status: overall.status,
    message: overall.message,
    metrics: forecasts
  }
}

function forecastMetric(metric, samples, now) {
  if (samples.length < 2) {
    return insufficient(metric.label)
  }

  const current = samples.at(-1)
  const currentPercent = valueAt(current, metric.percentPath)
  const currentReset = valueAt(current, metric.resetPath)
  const currentTime = new Date(current.updatedAt)
  if (
    !Number.isFinite(currentPercent)
    || !currentReset
    || Number.isNaN(currentTime.getTime())
  ) {
    return insufficient(metric.label)
  }

  const previous = [...samples]
    .slice(0, -1)
    .reverse()
    .find(sample => {
      const previousReset = valueAt(sample, metric.resetPath)
      const previousPercent = valueAt(sample, metric.percentPath)
      const previousTime = new Date(sample.updatedAt)
      const minutes = (currentTime - previousTime) / 60_000
      return previousReset === currentReset
        && Number.isFinite(previousPercent)
        && minutes >= 2
        && minutes <= 7 * 24 * 60
    })

  if (!previous) {
    return insufficient(metric.label)
  }

  const previousPercent = valueAt(previous, metric.percentPath)
  const previousTime = new Date(previous.updatedAt)
  const elapsedHours = (currentTime - previousTime) / 3_600_000
  const delta = currentPercent - previousPercent
  if (delta < -0.5) {
    return {
      status: 'insufficient',
      message: `${metric.label}刚刚重置，再同步一次后生成预测。`,
      delta,
      elapsedMinutes: Math.round(elapsedHours * 60)
    }
  }

  if (delta <= 0.05 || elapsedHours <= 0) {
    return {
      status: 'stable',
      message: `${metric.label}当前消耗稳定。`,
      delta,
      elapsedMinutes: Math.round(elapsedHours * 60),
      ratePerHour: 0
    }
  }

  const ratePerHour = delta / elapsedHours
  const hoursToExhaust = (100 - currentPercent) / ratePerHour
  const resetDate = parseReset(currentReset, now)
  const hoursToReset = resetDate
    ? (resetDate.getTime() - now.getTime()) / 3_600_000
    : null
  const projectedAt = new Date(now.getTime() + hoursToExhaust * 3_600_000)
  const safeRatePerHour = hoursToReset && hoursToReset > 0
    ? (100 - currentPercent) / hoursToReset
    : null
  const beforeReset = hoursToReset !== null
    && hoursToReset > 0
    && hoursToExhaust < hoursToReset

  let status = 'safe'
  if (beforeReset) {
    status = hoursToExhaust <= Math.min(3, hoursToReset * 0.25)
      ? 'critical'
      : 'warning'
  }

  const message = beforeReset
    ? `${metric.label}预计 ${formatProjected(projectedAt, now)} 用尽。`
    : `${metric.label}按当前速度可安全使用。`

  return {
    status,
    message,
    delta: round(delta),
    elapsedMinutes: Math.round(elapsedHours * 60),
    ratePerHour: round(ratePerHour),
    safeRatePerHour: safeRatePerHour === null ? null : round(safeRatePerHour),
    projectedAt: projectedAt.toISOString(),
    hoursToExhaust: round(hoursToExhaust),
    hoursToReset: hoursToReset === null ? null : round(hoursToReset)
  }
}

function insufficient(label) {
  return {
    status: 'insufficient',
    message: `${label}需要至少两次有效同步才能预测。`
  }
}

function valueAt(object, pathParts) {
  return pathParts.reduce((value, key) => value?.[key], object)
}

function parseReset(value, now) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T23:59:59`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const match = value.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, month, day, hour, minute] = match
  let candidate = new Date(
    now.getFullYear(),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  )
  if (candidate.getTime() < now.getTime() - 24 * 3_600_000) {
    candidate = new Date(
      now.getFullYear() + 1,
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    )
  }
  return candidate
}

function formatProjected(date, now) {
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

function round(value) {
  return Math.round(value * 100) / 100
}
