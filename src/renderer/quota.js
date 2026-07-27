const elements = {
  refreshButton: document.querySelector('#refreshButton'),
  closeButton: document.querySelector('#closeButton'),
  headerStatus: document.querySelector('#headerStatus'),
  updatedAt: document.querySelector('#updatedAt'),
  totalPercent: document.querySelector('#totalPercent'),
  kimiPercent: document.querySelector('#kimiPercent'),
  codePercent: document.querySelector('#codePercent'),
  kimiBar: document.querySelector('#kimiBar'),
  codeBar: document.querySelector('#codeBar'),
  totalReset: document.querySelector('#totalReset'),
  fivePercent: document.querySelector('#fivePercent'),
  fiveBar: document.querySelector('#fiveBar'),
  fiveReset: document.querySelector('#fiveReset'),
  sevenPercent: document.querySelector('#sevenPercent'),
  sevenBar: document.querySelector('#sevenBar'),
  sevenReset: document.querySelector('#sevenReset'),
  forecastBadge: document.querySelector('#forecastBadge'),
  forecastSummary: document.querySelector('#forecastSummary'),
  forecastDetails: document.querySelector('#forecastDetails'),
  errorPanel: document.querySelector('#errorPanel')
}

elements.closeButton.addEventListener('click', () => window.quotaPanel.close())
elements.refreshButton.addEventListener('click', () => window.quotaPanel.refresh())
window.quotaPanel.onState(render)
window.quotaPanel.getState().then(render)

function render(state) {
  const snapshot = state?.snapshot
  const syncing = state?.status === 'syncing'
  elements.refreshButton.disabled = syncing
  elements.refreshButton.innerHTML = syncing
    ? '正在更新…'
    : '更新信息 <span>↻</span>'

  elements.headerStatus.className = `status-dot ${statusClass(state)}`
  elements.updatedAt.textContent = syncing
    ? '正在连接 Kimi…'
    : snapshot
      ? `上次同步：${formatUpdatedAt(snapshot.updatedAt)}`
      : '尚未同步'

  setText(elements.totalPercent, percent(snapshot?.total?.usedPercent))
  setText(elements.kimiPercent, `Kimi ${percent(snapshot?.total?.kimiPercent)}`)
  setText(elements.codePercent, `Code ${percent(snapshot?.total?.codePercent)}`)
  setWidth(elements.kimiBar, snapshot?.total?.kimiPercent)
  setWidth(elements.codeBar, snapshot?.total?.codePercent)
  setText(elements.totalReset, reset(snapshot?.total?.resetAt))

  setText(elements.fivePercent, `Code ${percent(snapshot?.fiveHour?.percent)}`)
  setWidth(elements.fiveBar, snapshot?.fiveHour?.percent)
  setText(elements.fiveReset, reset(snapshot?.fiveHour?.resetAt))

  setText(elements.sevenPercent, `Code ${percent(snapshot?.sevenDay?.percent)}`)
  setWidth(elements.sevenBar, snapshot?.sevenDay?.percent)
  setText(elements.sevenReset, reset(snapshot?.sevenDay?.resetAt))

  renderForecast(state?.forecast)

  elements.errorPanel.hidden = !state?.error
  elements.errorPanel.textContent = state?.error || ''
  reportPreferredHeight()
}

function renderForecast(forecast) {
  const status = forecast?.status ?? 'insufficient'
  elements.forecastBadge.className = `forecast-badge ${status}`
  elements.forecastBadge.textContent = {
    safe: '节奏安全',
    stable: '消耗稳定',
    warning: '可能提前用尽',
    critical: '即将用尽',
    insufficient: '样本不足'
  }[status]
  elements.forecastSummary.textContent =
    forecast?.message || '再同步一次后生成燃尽预测。'

  const details = Object.values(forecast?.metrics || {})
    .filter(metric => Number.isFinite(metric.delta))
    .map(metric => {
      const safe = Number.isFinite(metric.safeRatePerHour)
        ? `建议 ≤ ${formatNumber(metric.safeRatePerHour)}%/小时`
        : metric.status === 'stable'
          ? '当前未观察到明显增长'
          : ''
      return `<div class="forecast-detail"><span>过去 ${metric.elapsedMinutes} 分钟 +${formatNumber(Math.max(0, metric.delta))}%</span><span>${safe}</span></div>`
    })
    .join('')
  elements.forecastDetails.innerHTML = details
}

function statusClass(state) {
  if (state?.status === 'syncing') return 'status-syncing'
  if (state?.status === 'error') return 'status-error'
  return `status-${state?.forecast?.status ?? 'insufficient'}`
}

function percent(value) {
  return Number.isFinite(value) ? `${formatNumber(value)}%` : '--'
}

function reset(value) {
  return value ? `${value} 后重置` : '--'
}

function setWidth(element, value) {
  element.style.width = `${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%`
}

function setText(element, value) {
  element.textContent = value
}

function formatUpdatedAt(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const now = new Date()
  const today = date.toDateString() === now.toDateString()
  return today
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}

let reportedHeight = 0
function reportPreferredHeight() {
  requestAnimationFrame(() => {
    const popover = document.querySelector('.popover')
    popover.style.height = 'auto'
    const naturalHeight = Math.ceil(popover.getBoundingClientRect().height)
    popover.style.height = ''
    if (Math.abs(naturalHeight - reportedHeight) < 2) return
    reportedHeight = naturalHeight
    window.quotaPanel.setPreferredHeight(naturalHeight)
  })
}
