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

const BURST_GAP_MINUTES = 10
const BURST_MAX_SPAN_MINUTES = 15
const MIN_OBSERVATION_MINUTES = 15
const MAX_DATA_AGE_MINUTES = 30

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
  const validSamples = samples
    .map(sample => ({
      sample,
      percent: valueAt(sample, metric.percentPath),
      reset: valueAt(sample, metric.resetPath),
      time: new Date(sample.updatedAt)
    }))
    .filter(item => Number.isFinite(item.percent)
      && item.reset
      && !Number.isNaN(item.time.getTime()))
    .sort((left, right) => left.time - right.time)

  if (validSamples.length < 2) return insufficient(metric.label)

  const current = validSamples.at(-1)
  const cycleStart = [...validSamples]
    .slice(0, -1)
    .findLastIndex(item => item.reset !== current.reset)
  const sameCycle = validSamples.slice(cycleStart + 1)
  const observed = collapseBursts(sameCycle)
  const first = observed[0]
  const latest = observed.at(-1)
  const spanMinutes = (latest.time - first.time) / 60_000
  const ageMinutes = Math.max(0, (now - latest.time) / 60_000)

  if (observed.length < 2 || spanMinutes < MIN_OBSERVATION_MINUTES) {
    return insufficient(metric.label, {
      sampleCount: observed.length,
      spanMinutes: Math.max(0, Math.round(spanMinutes)),
      reason: `${metric.label}需要至少相隔 ${MIN_OBSERVATION_MINUTES} 分钟的两次同步。`
    })
  }
  if (ageMinutes > MAX_DATA_AGE_MINUTES) {
    return insufficient(metric.label, {
      sampleCount: observed.length,
      spanMinutes: Math.round(spanMinutes),
      reason: `${metric.label}数据已超过 ${MAX_DATA_AGE_MINUTES} 分钟未更新，请重新同步。`
    })
  }

  const currentPercent = latest.percent
  const currentReset = latest.reset
  const currentTime = latest.time
  const previousPercent = first.percent
  const elapsedHours = spanMinutes / 60
  const delta = currentPercent - previousPercent
  if (delta < -0.5) {
    return {
      status: 'insufficient',
      message: `${metric.label}刚刚重置，再同步一次后生成预测。`,
      delta,
      elapsedMinutes: Math.round(spanMinutes),
      sampleCount: observed.length,
      spanMinutes: Math.round(spanMinutes)
    }
  }

  if (delta <= 0.05 || elapsedHours <= 0) {
    return {
      status: 'stable',
      message: `${metric.label}过去 ${formatDuration(spanMinutes)}未观察到明显增长。`,
      delta,
      elapsedMinutes: Math.round(spanMinutes),
      sampleCount: observed.length,
      spanMinutes: Math.round(spanMinutes),
      ratePerHour: 0,
      confidence: confidenceFor(observed.length, spanMinutes)
    }
  }

  const ratePerHour = delta / elapsedHours
  const hoursToExhaust = (100 - currentPercent) / ratePerHour
  const resetDate = parseReset(currentReset, currentTime)
  const hoursToReset = resetDate
    ? (resetDate.getTime() - currentTime.getTime()) / 3_600_000
    : null
  const projectedAt = new Date(currentTime.getTime() + hoursToExhaust * 3_600_000)
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
    ? `${metric.label}按过去 ${formatDuration(spanMinutes)}平均消耗，预计 ${formatProjected(projectedAt, currentTime)} 用尽。`
    : `${metric.label}按过去 ${formatDuration(spanMinutes)}平均消耗，重置前可用。`

  return {
    status,
    message,
    delta: round(delta),
    elapsedMinutes: Math.round(spanMinutes),
    sampleCount: observed.length,
    spanMinutes: Math.round(spanMinutes),
    confidence: confidenceFor(observed.length, spanMinutes),
    ratePerHour: round(ratePerHour),
    safeRatePerHour: safeRatePerHour === null ? null : round(safeRatePerHour),
    projectedAt: projectedAt.toISOString(),
    hoursToExhaust: round(hoursToExhaust),
    hoursToReset: hoursToReset === null ? null : round(hoursToReset)
  }
}

function insufficient(label, details = {}) {
  return {
    status: 'insufficient',
    message: details.reason || `${label}需要至少相隔 ${MIN_OBSERVATION_MINUTES} 分钟的两次同步。`,
    ...details
  }
}

function collapseBursts(samples) {
  const collapsed = []
  let clusterStart = null
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]
    const previous = collapsed.at(-1)
    const previousRaw = samples[index - 1]
    const gapMinutes = previousRaw
      ? (sample.time - previousRaw.time) / 60_000
      : Infinity
    if (
      previous
      && clusterStart
      && gapMinutes < BURST_GAP_MINUTES
      && (sample.time - clusterStart.time) / 60_000 <= BURST_MAX_SPAN_MINUTES
    ) {
      // Keep the first and latest point of a burst. This removes repeated
      // refreshes from the middle without erasing the observed interval.
      if (previous === clusterStart) collapsed.push(sample)
      else collapsed[collapsed.length - 1] = sample
      continue
    }
    collapsed.push(sample)
    clusterStart = sample
  }
  return collapsed
}

function confidenceFor(sampleCount, spanMinutes) {
  if (sampleCount >= 4 && spanMinutes >= 60) return 'high'
  if (sampleCount >= 3 && spanMinutes >= 30) return 'medium'
  return 'low'
}

function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`
  return `${round(minutes / 60)} 小时`
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
