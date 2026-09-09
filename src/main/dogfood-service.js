// K1-D0 (#34) Dogfood Inbox persistence.
// inbox.jsonl is the append-only source of truth; inbox.md is a derivative
// human-readable snapshot regenerated after each successful mutation.
// Loading folds events in order; malformed lines (e.g. a torn final write)
// are skipped and reported, never rewritten or truncated.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const DOGFOOD_TYPES = ['问题', '想法', '正向反馈']
const DOGFOOD_TYPE_SET = new Set(DOGFOOD_TYPES)
const MAX_TEXT_LENGTH = 20000

export function localDateString(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createDogfoodService({ dir, onMalformedLine = () => {}, onSnapshotError = () => {} }) {
  if (!dir) throw new Error('dogfood service requires a storage directory')
  const jsonlPath = path.join(dir, 'inbox.jsonl')
  const markdownPath = path.join(dir, 'inbox.md')
  let records = []
  let loaded = false

  async function load() {
    if (loaded) return
    loaded = true
    let content = ''
    try {
      content = await fs.readFile(jsonlPath, 'utf8')
    } catch {
      records = []
      return
    }
    const byId = new Map()
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim()
      if (!line) continue
      let event = null
      try {
        event = JSON.parse(line)
      } catch {
        onMalformedLine({ line: index + 1 })
        continue
      }
      if (event?.op === 'create' && event.record && typeof event.record.id === 'string') {
        byId.set(event.record.id, event.record)
      } else if (event?.op === 'update' && typeof event.id === 'string') {
        const existing = byId.get(event.id)
        if (existing && event.patch && typeof event.patch === 'object') {
          const next = { ...existing }
          if (DOGFOOD_TYPE_SET.has(event.patch.type)) next.type = event.patch.type
          if (typeof event.patch.text === 'string' && event.patch.text.trim()) {
            next.text = event.patch.text.slice(0, MAX_TEXT_LENGTH)
          }
          if (typeof event.updatedAt === 'string') next.updatedAt = event.updatedAt
          byId.set(event.id, next)
        }
      } else if (event?.op === 'delete' && typeof event.id === 'string') {
        byId.delete(event.id)
      }
    }
    records = [...byId.values()]
  }

  async function appendEvent(event) {
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(jsonlPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  async function regenerateMarkdown() {
    const snapshot = renderMarkdown(records)
    const tempPath = `${markdownPath}.tmp`
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(tempPath, snapshot, 'utf8')
      await fs.rename(tempPath, markdownPath)
    } catch (error) {
      // inbox.md is derivative: a snapshot failure must never roll back or
      // block the JSONL mutation that already succeeded.
      try { await fs.rm(tempPath, { force: true }) } catch { /* best effort */ }
      onSnapshotError(error)
    }
  }

  return {
    async ensureLoaded() {
      await load()
    },
    async list() {
      await load()
      return records.map(record => ({ ...record }))
    },
    async today(date = localDateString()) {
      await load()
      return records
        .filter(record => record.localDate === date)
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .map(record => ({ ...record }))
    },
    async create({ type, text, context = {} }) {
      await load()
      if (!DOGFOOD_TYPE_SET.has(type)) throw new Error('记录类型无效')
      const trimmed = String(text || '').trim()
      if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) throw new Error('记录内容无效')
      const record = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        localDate: localDateString(),
        type,
        text: trimmed,
        activeEngine: context.activeEngine ?? null,
        activeTab: context.activeTab ?? null,
        appVersion: context.appVersion ?? null,
        sourceCommit: context.sourceCommit ?? null,
        projectRoot: context.projectRoot ?? null,
        sessionId: context.sessionId ?? null
      }
      await appendEvent({ op: 'create', record })
      records = [...records, record]
      await regenerateMarkdown()
      return { ...record }
    },
    async update({ id, patch }) {
      await load()
      const existing = records.find(record => record.id === id)
      if (!existing) throw new Error('记录不存在')
      const nextPatch = {}
      if (patch?.type !== undefined) {
        if (!DOGFOOD_TYPE_SET.has(patch.type)) throw new Error('记录类型无效')
        nextPatch.type = patch.type
      }
      if (patch?.text !== undefined) {
        const trimmed = String(patch.text || '').trim()
        if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) throw new Error('记录内容无效')
        nextPatch.text = trimmed
      }
      if (!Object.keys(nextPatch).length) throw new Error('没有可更新的字段')
      const updatedAt = new Date().toISOString()
      await appendEvent({ op: 'update', id, patch: nextPatch, updatedAt })
      const next = { ...existing, ...nextPatch, updatedAt }
      records = records.map(record => (record.id === id ? next : record))
      await regenerateMarkdown()
      return { ...next }
    },
    async remove({ id }) {
      await load()
      if (!records.some(record => record.id === id)) throw new Error('记录不存在')
      await appendEvent({ op: 'delete', id, deletedAt: new Date().toISOString() })
      records = records.filter(record => record.id !== id)
      await regenerateMarkdown()
      return true
    },
    paths: { jsonlPath, markdownPath }
  }
}

export function renderMarkdown(records) {
  const lines = ['# Arckeep Dogfood Inbox', '']
  const byDate = new Map()
  for (const record of records) {
    const date = record.localDate || 'unknown-date'
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date).push(record)
  }
  const dates = [...byDate.keys()].sort().reverse()
  for (const date of dates) {
    lines.push(`## ${date}`, '')
    const dayRecords = byDate.get(date)
      .slice()
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    for (const record of dayRecords) {
      lines.push(`### ${formatLocalTime(record.createdAt)} · ${record.type}`, '')
      const meta = []
      if (record.activeEngine) meta.push(`Engine: ${record.activeEngine === 'cloudcli' ? 'CloudCLI' : 'Kimi'}`)
      if (record.activeTab) meta.push(`Tab: ${record.activeTab}`)
      if (record.sourceCommit) meta.push(`Build: ${String(record.sourceCommit).slice(0, 7)}`)
      if (record.appVersion) meta.push(`Version: ${record.appVersion}`)
      if (meta.length) lines.push(meta.join(' · '), '')
      lines.push(record.text, '')
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function formatLocalTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
