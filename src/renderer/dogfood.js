const captureForm = document.querySelector('#captureForm')
const captureText = document.querySelector('#captureText')
const formError = document.querySelector('#formError')
const saveBtn = document.querySelector('#saveBtn')
const closeBtn = document.querySelector('#closeBtn')
const todayList = document.querySelector('#todayList')
const emptyHint = document.querySelector('#emptyHint')
const todayHeading = document.querySelector('#todayHeading')

closeBtn.addEventListener('click', () => window.dogfoodInbox.close())

captureForm.addEventListener('submit', async event => {
  event.preventDefault()
  const type = captureForm.elements.captureType.value
  const text = captureText.value
  showError('')
  saveBtn.disabled = true
  try {
    await window.dogfoodInbox.create({ type, text })
    captureText.value = ''
    captureText.focus()
  } catch (error) {
    // 失败时绝不清空输入，只提示。
    showError(error?.message || '保存失败，请重试')
  } finally {
    saveBtn.disabled = false
  }
})

window.dogfoodInbox.onState(state => renderToday(state?.records || []))
window.dogfoodInbox.onFocusEditor(() => captureText.focus())

window.dogfoodInbox.getState().then(state => {
  renderToday(state?.records || [])
  captureText.focus()
})

function showError(message) {
  formError.textContent = message
  formError.hidden = !message
}

function renderToday(records) {
  todayHeading.textContent = `今天（${records.length}）`
  emptyHint.hidden = records.length > 0
  todayList.replaceChildren(...records.map(renderRecord))
}

function renderRecord(record) {
  const item = document.createElement('li')
  item.className = 'record'
  item.dataset.id = record.id

  const head = document.createElement('div')
  head.className = 'record-head'
  const typeBadge = document.createElement('span')
  typeBadge.className = `record-type record-type-${record.type}`
  typeBadge.textContent = record.type
  const time = document.createElement('span')
  time.className = 'record-time'
  time.textContent = formatTime(record.createdAt)
  head.append(typeBadge, time)

  const text = document.createElement('p')
  text.className = 'record-text'
  text.textContent = record.text

  const meta = document.createElement('p')
  meta.className = 'record-meta'
  meta.textContent = metaLine(record)
  meta.hidden = !meta.textContent

  const actions = document.createElement('div')
  actions.className = 'record-actions'
  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.textContent = '编辑'
  editBtn.addEventListener('click', () => enterEditMode(item, record))
  const deleteBtn = document.createElement('button')
  deleteBtn.type = 'button'
  deleteBtn.className = 'danger'
  deleteBtn.textContent = '删除'
  deleteBtn.addEventListener('click', () => confirmDelete(deleteBtn, record))
  actions.append(editBtn, deleteBtn)

  item.append(head, text, meta, actions)
  return item
}

function confirmDelete(button, record) {
  if (!button.classList.contains('confirming')) {
    button.classList.add('confirming')
    button.textContent = '确认删除？'
    setTimeout(() => {
      if (button.isConnected) {
        button.classList.remove('confirming')
        button.textContent = '删除'
      }
    }, 3000)
    return
  }
  button.disabled = true
  window.dogfoodInbox.remove(record.id).catch(() => {
    button.disabled = false
    button.classList.remove('confirming')
    button.textContent = '删除'
  })
}

function enterEditMode(item, record) {
  const textNode = item.querySelector('.record-text')
  const metaNode = item.querySelector('.record-meta')
  const actions = item.querySelector('.record-actions')
  if (!textNode || item.querySelector('.edit-area')) return

  const editArea = document.createElement('textarea')
  editArea.className = 'edit-area'
  editArea.value = record.text

  const typeSelect = document.createElement('select')
  typeSelect.className = 'edit-type'
  for (const type of ['问题', '想法', '正向反馈']) {
    const option = document.createElement('option')
    option.value = type
    option.textContent = type
    option.selected = type === record.type
    typeSelect.append(option)
  }

  const saveEdit = document.createElement('button')
  saveEdit.type = 'button'
  saveEdit.textContent = '保存'
  const cancelEdit = document.createElement('button')
  cancelEdit.type = 'button'
  cancelEdit.textContent = '取消'

  textNode.replaceWith(editArea)
  metaNode.hidden = true
  actions.replaceChildren(saveEdit, cancelEdit)
  actions.before(typeSelect)
  editArea.focus()

  const restore = () => {
    // 状态推送会重新渲染列表；取消时直接重绘当前条。
    window.dogfoodInbox.getState().then(state => renderToday(state?.records || []))
  }
  cancelEdit.addEventListener('click', restore)
  saveEdit.addEventListener('click', async () => {
    saveEdit.disabled = true
    try {
      await window.dogfoodInbox.update({
        id: record.id,
        type: typeSelect.value,
        text: editArea.value
      })
    } catch {
      saveEdit.disabled = false
      saveEdit.textContent = '重试保存'
    }
  })
}

function metaLine(record) {
  const parts = []
  if (record.activeEngine) parts.push(record.activeEngine === 'cloudcli' ? 'CloudCLI' : 'Kimi')
  if (record.activeTab) parts.push(`页签 ${record.activeTab}`)
  if (record.sourceCommit) parts.push(`build ${String(record.sourceCommit).slice(0, 7)}`)
  return parts.join(' · ')
}

function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
