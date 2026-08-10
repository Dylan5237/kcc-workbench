const quotaButton = document.querySelector('#quotaButton')
const quotaPercent = document.querySelector('#quotaPercent')
const quotaStatusDot = document.querySelector('#quotaStatusDot')
const restartKimiBtn = document.querySelector('#restartKimiBtn')
const engineToggle = document.querySelector('#engineToggle')
const brandEngine = document.querySelector('#brandEngine')
const workspaceTabs = [...document.querySelectorAll('.workspace-tab')]
const settingsTab = document.querySelector('[data-tab="settings"]')
let activeTab = 'kimi'
let activeEngine = 'kimi'

quotaButton.addEventListener('click', () => window.desktopShell.toggleQuota())
restartKimiBtn.addEventListener('click', async () => {
  restartKimiBtn.disabled = true
  try {
    await window.desktopShell.restartWeb()
  } finally {
    restartKimiBtn.disabled = false
  }
})
engineToggle.addEventListener('click', async () => {
  engineToggle.disabled = true
  try {
    const result = await window.desktopShell.toggleEngine()
    renderEngine(result.engine)
  } finally {
    engineToggle.disabled = false
  }
})
for (const tab of workspaceTabs) {
  tab.addEventListener('click', () => window.desktopShell.setTab(tab.dataset.tab))
}

window.desktopShell.onQuotaState(renderQuota)
window.desktopShell.onTabChanged(state => {
  renderActiveTab(state.activeTab)
  if (state.activeEngine) renderEngine(state.activeEngine)
})
window.desktopShell.onEngineChanged(state => renderEngine(state.engine))
window.desktopShell.onQuotaVisibility(visible => {
  quotaButton.setAttribute('aria-expanded', String(Boolean(visible)))
})

window.desktopShell.getState().then(state => {
  renderActiveTab(state.activeTab)
  renderEngine(state.activeEngine)
  renderQuota(state.quota)
})

function renderActiveTab(nextTab) {
  activeTab = nextTab
  for (const tab of workspaceTabs) {
    const active = tab.dataset.tab === activeTab
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-current', active ? 'page' : 'false')
  }
  renderKimiOnlyActions()
}

function renderEngine(nextEngine) {
  activeEngine = nextEngine === 'cloudcli' ? 'cloudcli' : 'kimi'
  const isKimi = activeEngine === 'kimi'
  brandEngine.textContent = isKimi ? 'Kimi' : 'CloudCLI'
  engineToggle.title = isKimi ? '切换到 CloudCLI（Alt+Q）' : '切换到 Kimi Code（Alt+Q）'
  engineToggle.setAttribute('aria-label', engineToggle.title)
  renderKimiOnlyActions()
}

function renderKimiOnlyActions() {
  const visible = activeTab === 'kimi' && activeEngine === 'kimi'
  restartKimiBtn.hidden = !visible
  quotaButton.hidden = !visible
  settingsTab.hidden = activeEngine !== 'kimi'
  if (!visible) quotaButton.setAttribute('aria-expanded', 'false')
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
