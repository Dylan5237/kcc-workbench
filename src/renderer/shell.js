const quotaButton = document.querySelector('#quotaButton')
const quotaPercent = document.querySelector('#quotaPercent')
const quotaStatusDot = document.querySelector('#quotaStatusDot')
const restartKimiBtn = document.querySelector('#restartKimiBtn')
const engineSelect = document.querySelector('#engineSelect')
const workspaceTabs = [...document.querySelectorAll('.workspace-tab')]

quotaButton.addEventListener('click', () => window.desktopShell.toggleQuota())
restartKimiBtn.addEventListener('click', async () => {
  restartKimiBtn.disabled = true
  try {
    await window.desktopShell.restartWeb()
  } finally {
    restartKimiBtn.disabled = false
  }
})
engineSelect.addEventListener('change', async () => {
  engineSelect.disabled = true
  try {
    const result = await window.desktopShell.switchEngine(engineSelect.value)
    engineSelect.value = result.engine
  } finally {
    engineSelect.disabled = false
  }
})
for (const tab of workspaceTabs) {
  tab.addEventListener('click', () => window.desktopShell.setTab(tab.dataset.tab))
}

window.desktopShell.onQuotaState(renderQuota)
window.desktopShell.onTabChanged(state => renderActiveTab(state.activeTab))
window.desktopShell.onQuotaVisibility(visible => {
  quotaButton.setAttribute('aria-expanded', String(Boolean(visible)))
})

window.desktopShell.getState().then(state => {
  renderActiveTab(state.activeTab)
  renderQuota(state.quota)
})
window.desktopShell.getEngine().then(state => {
  engineSelect.value = state.engine
})

function renderActiveTab(activeTab) {
  for (const tab of workspaceTabs) {
    const active = tab.dataset.tab === activeTab
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-current', active ? 'page' : 'false')
  }
  restartKimiBtn.hidden = activeTab !== 'kimi'
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

function formatNumber(value) {
  return Number(value).toFixed(2).replace(/\.?0+$/, '')
}
