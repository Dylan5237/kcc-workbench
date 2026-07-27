const quotaButton = document.querySelector('#quotaButton')
const quotaPercent = document.querySelector('#quotaPercent')
const quotaStatusDot = document.querySelector('#quotaStatusDot')
const pageTitle = document.querySelector('#pageTitle')

quotaButton.addEventListener('click', () => window.desktopShell.toggleQuota())

window.desktopShell.onNavigationState(renderNavigation)
window.desktopShell.onQuotaState(renderQuota)
window.desktopShell.onQuotaVisibility(visible => {
  quotaButton.setAttribute('aria-expanded', String(Boolean(visible)))
})

window.desktopShell.getState().then(state => {
  renderNavigation(state.navigation)
  renderQuota(state.quota)
})

function renderNavigation(state) {
  pageTitle.textContent = compactTitle(state?.title)
}

function renderQuota(state) {
  const percent = state?.snapshot?.total?.usedPercent
  quotaPercent.textContent = Number.isFinite(percent)
    ? `${formatNumber(percent)}%`
    : '--'
  const status = state?.status === 'syncing'
    ? 'syncing'
    : state?.status === 'error'
      ? 'error'
      : state?.forecast?.status ?? 'insufficient'
  quotaStatusDot.className = `status-dot status-${status}`
  quotaButton.title = state?.forecast?.message || '点击查看额度'
}

function compactTitle(value) {
  if (!value || value.includes('Kimi AI 官网')) return 'Kimi'
  return value.length > 42 ? `${value.slice(0, 42)}…` : value
}

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}
