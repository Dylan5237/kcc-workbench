const elements = {
  defaultEngine: document.querySelector('#defaultEngine'),
  rememberEngine: document.querySelector('#rememberEngine'),
  viewerMode: document.querySelector('#viewerMode'),
  defaultModel: document.querySelector('#defaultModel'),
  permissionMode: document.querySelector('#permissionMode'),
  defaultPlanMode: document.querySelector('#defaultPlanMode'),
  telemetry: document.querySelector('#telemetry'),
  systemPrompt: document.querySelector('#systemPrompt'),
  agentsInstructions: document.querySelector('#agentsInstructions'),
  thinkingEnabled: document.querySelector('#thinkingEnabled'),
  thinkingEffort: document.querySelector('#thinkingEffort'),
  thinkingKeep: document.querySelector('#thinkingKeep'),
  maxSteps: document.querySelector('#maxSteps'),
  maxRetries: document.querySelector('#maxRetries'),
  reservedContext: document.querySelector('#reservedContext'),
  subagentTimeout: document.querySelector('#subagentTimeout'),
  maxBackgroundTasks: document.querySelector('#maxBackgroundTasks'),
  bashTimeout: document.querySelector('#bashTimeout'),
  toolsEnabled: document.querySelector('#toolsEnabled'),
  toolsDisabled: document.querySelector('#toolsDisabled'),
  mcpStartupTimeout: document.querySelector('#mcpStartupTimeout'),
  mcpToolTimeout: document.querySelector('#mcpToolTimeout'),
  mergeSkills: document.querySelector('#mergeSkills'),
  extraSkillDirs: document.querySelector('#extraSkillDirs'),
  extraAgentDirs: document.querySelector('#extraAgentDirs'),
  imageMaxEdge: document.querySelector('#imageMaxEdge'),
  imageByteBudget: document.querySelector('#imageByteBudget')
}
const saveButton = document.querySelector('#saveButton')
const resetButton = document.querySelector('#resetButton')
const saveStatus = document.querySelector('#saveStatus')
let state = null
let dirty = false

for (const button of document.querySelectorAll('.nav-item')) {
  button.addEventListener('click', () => activatePanel(button.dataset.panel))
}
for (const input of Object.values(elements)) {
  input.addEventListener('input', markDirty)
  input.addEventListener('change', markDirty)
}
for (const button of document.querySelectorAll('[data-insert]')) {
  button.addEventListener('click', () => insertPromptVariable(button.dataset.insert))
}
saveButton.addEventListener('click', save)
resetButton.addEventListener('click', () => render(state))
document.querySelector('#addSkillDirectory').addEventListener('click', () => {
  selectDirectoryFor(elements.extraSkillDirs)
})
document.querySelector('#addAgentDirectory').addEventListener('click', () => {
  selectDirectoryFor(elements.extraAgentDirs)
})
document.querySelector('#addModelBtn').addEventListener('click', () => {
  const editor = document.querySelector('#modelEditor')
  if (editor.className === 'empty-state') {
    editor.className = ''
    editor.innerHTML = ''
  }
  editor.insertAdjacentHTML('beforeend', modelCardHtml({
    alias: '', model: '', displayName: '', provider: '', apiKey: '', baseUrl: '', maxContextSize: null, capabilities: []
  }))
  markDirty()
})
document.addEventListener('input', event => {
  if (event.target.closest('[data-model-field]')) markDirty()
})
document.addEventListener('click', event => {
  const removeButton = event.target.closest('.model-remove')
  if (removeButton) {
    removeButton.closest('.model-card').remove()
    markDirty()
  }
})

load()

async function load() {
  setStatus('正在读取配置…')
  try {
    state = await window.desktopSettings.getState()
    render(state)
  } catch (error) {
    setStatus(`读取失败：${error.message}`, true)
  }
}

function render(nextState) {
  state = nextState
  const config = state.config || {}
  const workbench = state.workbench || {}
  setValue('defaultEngine', workbench.config?.defaultEngine || 'kimi')
  setChecked('rememberEngine', Boolean(workbench.config?.rememberEngine))
  setValue('viewerMode', workbench.config?.viewerMode || 'auto')
  document.querySelector('#workbenchStorage').textContent =
      workbench.storage === 'exe'
        ? ('exe 旁 ' + (workbench.configPath || ''))
        : ('userData ' + (workbench.configPath || ''))
  renderModels(state.models || [], config.default_model)
  setValue('permissionMode', config.default_permission_mode)
  setChecked('defaultPlanMode', config.default_plan_mode)
  setChecked('telemetry', config.telemetry)
  setValue('systemPrompt', state.systemPrompt)
  setValue('agentsInstructions', state.agentsInstructions)
  setChecked('thinkingEnabled', config.thinking?.enabled)
  setValue('thinkingEffort', config.thinking?.effort)
  setValue('thinkingKeep', config.thinking?.keep)
  setValue('maxSteps', config.loop_control?.max_steps_per_turn)
  setValue('maxRetries', config.loop_control?.max_retries_per_step)
  setValue('reservedContext', config.loop_control?.reserved_context_size)
  setValue('subagentTimeout', config.subagent?.timeout_ms)
  setValue('maxBackgroundTasks', config.background?.max_running_tasks)
  setValue('bashTimeout', config.background?.bash_task_timeout_s)
  setValue('toolsEnabled', (config.tools?.enabled || []).join(', '))
  setValue('toolsDisabled', (config.tools?.disabled || []).join(', '))
  setValue('mcpStartupTimeout', config.mcp?.startup_timeout_ms)
  setValue('mcpToolTimeout', config.mcp?.tool_timeout_ms)
  setChecked('mergeSkills', config.merge_all_available_skills)
  setValue('extraSkillDirs', (config.extra_skill_dirs || []).join('\n'))
  setValue('extraAgentDirs', (config.extra_agent_dirs || []).join('\n'))
  setValue('imageMaxEdge', config.image?.max_edge_px)
  setValue('imageByteBudget', config.image?.read_byte_budget)

  document.querySelector('#homePath').textContent = state.kimiCodeHome
  document.querySelector('#projectPath').textContent = state.projectDirectory || '未检测到'
  document.querySelector('#projectInstructionsPath').textContent =
    state.projectInstructions?.path || '未发现'
  document.querySelector('#systemPromptPath').textContent = state.paths.systemPrompt
  document.querySelector('#agentsPath').textContent = state.paths.agentsInstructions
  document.querySelector('#sandboxBanner').classList.toggle('hidden', !state.sandboxed)
  renderMcp(state.mcpServers || [])
  renderSkills(state.skills || [])
  renderPaths(state.paths)
  renderPromptSource(state.promptSources?.system)
  setDirty(false)
}

function collect() {
  const completeConfig = {
      default_model: elements.defaultModel.value.trim(),
      default_permission_mode: elements.permissionMode.value || undefined,
      default_plan_mode: elements.defaultPlanMode.checked,
      telemetry: elements.telemetry.checked,
      merge_all_available_skills: elements.mergeSkills.checked,
      extra_skill_dirs: lineList(elements.extraSkillDirs.value),
      extra_agent_dirs: lineList(elements.extraAgentDirs.value),
      thinking: {
        enabled: elements.thinkingEnabled.checked,
        effort: elements.thinkingEffort.value,
        keep: elements.thinkingKeep.value
      },
      loop_control: {
        max_steps_per_turn: integerValue(elements.maxSteps),
        max_retries_per_step: integerValue(elements.maxRetries),
        reserved_context_size: integerValue(elements.reservedContext)
      },
      background: {
        max_running_tasks: integerValue(elements.maxBackgroundTasks),
        bash_task_timeout_s: integerValue(elements.bashTimeout)
      },
      subagent: { timeout_ms: integerValue(elements.subagentTimeout) },
      mcp: {
        startup_timeout_ms: integerValue(elements.mcpStartupTimeout),
        tool_timeout_ms: integerValue(elements.mcpToolTimeout)
      },
      tools: {
        enabled: commaList(elements.toolsEnabled.value),
        disabled: commaList(elements.toolsDisabled.value)
      },
      image: {
        max_edge_px: integerValue(elements.imageMaxEdge),
        read_byte_budget: integerValue(elements.imageByteBudget)
      }
  }
  const payload = {
    config: changedConfig(completeConfig, state.config || {}),
    workbench: {
      defaultEngine: elements.defaultEngine.value,
      rememberEngine: elements.rememberEngine.checked,
      viewerMode: elements.viewerMode.value
    }
  }
  const models = collectModels()
  if (!modelsEqual(models, state.models || [])) {
    payload.models = models
  }
  if (elements.systemPrompt.value !== state.systemPrompt) {
    payload.systemPrompt = elements.systemPrompt.value
  }
  if (elements.agentsInstructions.value !== state.agentsInstructions) {
    payload.agentsInstructions = elements.agentsInstructions.value
  }
  return payload
}

function collectModels() {
  return [...document.querySelectorAll('.model-card')].map(card => {
    const fieldValue = key => card.querySelector(`[data-model-field="${key}"]`)?.value?.trim() ?? ''
    const maxContextSize = fieldValue('maxContextSize') ? Number.parseInt(fieldValue('maxContextSize'), 10) : undefined
    return {
      alias: fieldValue('alias'),
      model: fieldValue('model'),
      displayName: fieldValue('displayName'),
      provider: fieldValue('provider'),
      apiKey: fieldValue('apiKey'),
      baseUrl: fieldValue('baseUrl'),
      maxContextSize: Number.isFinite(maxContextSize) ? maxContextSize : undefined,
      capabilities: fieldValue('capabilities').split(',').map(item => item.trim()).filter(Boolean)
    }
  })
}

function modelsEqual(left, right) {
  if (left.length !== right.length) return false
  const normalize = model => JSON.stringify([
    model.alias || '',
    model.model || '',
    model.displayName || '',
    model.provider || '',
    model.apiKey || '',
    model.baseUrl || '',
    model.maxContextSize || null,
    model.capabilities || []
  ])
  return left.every((model, index) => normalize(model) === normalize(right[index]))
}

async function save() {
  if (!dirty) return
  saveButton.disabled = true
  resetButton.disabled = true
  setStatus('正在保存…')
  try {
    state = await window.desktopSettings.save(collect())
    render(state)
    setStatus('已保存')
  } catch (error) {
    setStatus(`保存失败：${error.message}`, true)
    saveButton.disabled = false
    resetButton.disabled = false
  }
}

function activatePanel(name) {
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('active', panel.dataset.panel === name)
  }
  for (const button of document.querySelectorAll('.nav-item')) {
    button.classList.toggle('active', button.dataset.panel === name)
  }
  document.querySelector('.content').scrollTop = 0
}

function insertPromptVariable(value) {
  const input = elements.systemPrompt
  input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end')
  input.focus()
  markDirty()
}

function renderModels(models, selectedAlias) {
  const options = [{ alias: '', displayName: '由 Kimi Code 决定' }, ...models]
  if (selectedAlias && !models.some(model => model.alias === selectedAlias)) {
    options.push({ alias: selectedAlias, displayName: selectedAlias })
  }
  elements.defaultModel.innerHTML = options
    .map(model => `<option value="${escapeHtml(model.alias)}">${escapeHtml(model.displayName || model.alias)}${model.alias ? ` · ${escapeHtml(model.alias)}` : ''}</option>`)
    .join('')
  elements.defaultModel.value = selectedAlias || ''
  renderModelEditor(models)
}

function renderModelEditor(models) {
  const editor = document.querySelector('#modelEditor')
  if (!models.length) {
    editor.className = 'empty-state'
    editor.textContent = '没有自定义模型。点击"添加模型"开始。'
    return
  }
  editor.className = ''
  editor.innerHTML = models.map(modelCardHtml).join('')
}

function modelCardHtml(model) {
  return `
    <div class="model-card">
      <div class="model-card-head">
        <span class="model-card-name">${escapeHtml(model.displayName || model.alias) || '未命名模型'}</span>
        <button class="model-remove" type="button" title="删除此模型">删除</button>
      </div>
      <div class="model-grid">
        <label><span>别名</span><input data-model-field="alias" value="${escapeHtml(model.alias || '')}" placeholder="my-model" spellcheck="false"></label>
        <label><span>模型 ID</span><input data-model-field="model" value="${escapeHtml(model.model || '')}" placeholder="gpt-4" spellcheck="false"></label>
        <label><span>显示名</span><input data-model-field="displayName" value="${escapeHtml(model.displayName || '')}" placeholder="选填" spellcheck="false"></label>
        <label><span>Provider</span><input data-model-field="provider" value="${escapeHtml(model.provider || '')}" placeholder="openai-compatible" spellcheck="false"></label>
        <label><span>API Key</span><input data-model-field="apiKey" value="${escapeHtml(model.apiKey || '')}" placeholder="sk-..." spellcheck="false"></label>
        <label><span>Base URL</span><input data-model-field="baseUrl" value="${escapeHtml(model.baseUrl || '')}" placeholder="https://api.example.com/v1" spellcheck="false"></label>
        <label><span>上下文大小</span><input data-model-field="maxContextSize" type="number" min="0" value="${model.maxContextSize ?? ''}" placeholder="选填"></label>
        <label><span>能力（逗号分隔）</span><input data-model-field="capabilities" value="${escapeHtml((model.capabilities || []).join(', '))}" placeholder="text" spellcheck="false"></label>
      </div>
    </div>
  `
}

function renderSkills(skills) {
  const list = document.querySelector('#skillsList')
  if (!skills.length) {
    list.className = 'empty-state'
    list.textContent = '没有发现 Skill。可通过“选择文件夹”添加额外目录。'
    return
  }
  list.className = ''
  list.innerHTML = skills.map(skill => `
    <div class="list-row">
      <strong>${escapeHtml(skill.name)}</strong>
      <span class="state-chip">${escapeHtml(skill.source)}</span>
      <small title="${escapeHtml(skill.path)}">${escapeHtml(skill.path)}</small>
    </div>
  `).join('')
}

function renderPromptSource(source) {
  const notice = document.querySelector('#promptSourceNotice')
  const title = document.querySelector('#promptSourceTitle')
  const description = document.querySelector('#promptSourceDescription')
  const custom = source === 'custom'
  notice.classList.toggle('custom', custom)
  title.textContent = custom
    ? '正在使用自定义 SYSTEM.md'
    : '正在使用 Kimi Code 内置系统提示词'
  description.textContent = custom
    ? '下方编辑器显示的是当前生效的自定义覆盖。'
    : '配置目录中没有 SYSTEM.md。内置提示词由 Kimi Code 程序提供，不是可直接读取的配置文件；下方用于创建自定义覆盖。'
}

async function selectDirectoryFor(input) {
  const directory = await window.desktopSettings.selectDirectory()
  if (!directory) return
  const directories = lineList(input.value)
  if (!directories.includes(directory)) directories.push(directory)
  input.value = directories.join('\n')
  input.focus()
  markDirty()
}

function renderMcp(servers) {
  const list = document.querySelector('#mcpList')
  if (!servers.length) {
    list.className = 'empty-state'
    list.textContent = '没有发现 MCP 服务'
    return
  }
  list.className = ''
  list.innerHTML = servers.map(server => `
    <div class="list-row">
      <strong>${escapeHtml(server.name)}</strong>
      <span class="state-chip">${server.enabled ? '已启用' : '已停用'}</span>
      <small>${escapeHtml(server.transport)} · ${escapeHtml(server.endpoint || '未设置端点')}</small>
    </div>
  `).join('')
}

function renderPaths(paths) {
  document.querySelector('#pathsCard').innerHTML = Object.entries(paths)
    .map(([name, value]) => `<div class="path-row"><span>${escapeHtml(name)}</span><code>${escapeHtml(value)}</code></div>`)
    .join('')
}

function markDirty() {
  setDirty(true)
}

function setDirty(value) {
  dirty = value
  saveButton.disabled = !value
  resetButton.disabled = !value
  setStatus(value ? '有未保存的更改' : '尚未修改')
}

function setStatus(message, error = false) {
  saveStatus.textContent = message
  saveStatus.style.color = error ? '#c23d32' : ''
}

function setValue(name, value) {
  elements[name].value = value ?? ''
}

function setChecked(name, value) {
  elements[name].checked = Boolean(value)
}

function integerValue(input) {
  if (!input.value.trim()) return undefined
  return Number.parseInt(input.value, 10)
}

function commaList(value) {
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function lineList(value) {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
}

function changedConfig(current, initial) {
  const result = {}
  for (const [key, value] of Object.entries(current)) {
    const initialValue = initial?.[key]
    if (isPlainObject(value)) {
      const nested = changedConfig(value, initialValue || {})
      if (Object.keys(nested).length) result[key] = nested
      continue
    }
    if (!equivalentSetting(value, initialValue)) result[key] = value
  }
  return result
}

function equivalentSetting(left, right) {
  if ((left === '' || left === undefined) && (right === '' || right === undefined)) {
    return true
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  if (Array.isArray(left) && left.length === 0 && right === undefined) return true
  return left === right
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
