import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDogfoodService, localDateString } from '../src/main/dogfood-service.js'

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'kcc-dogfood-test-'))
}

async function readJsonl(dir) {
  const content = await fs.readFile(path.join(dir, 'inbox.jsonl'), 'utf8')
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('create appends a create event and folds into list/today', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  const record = await service.create({
    type: '问题',
    text: 'Viewer 最后打开又是空的',
    context: { activeEngine: 'kimi', activeTab: 'kimi', appVersion: '1.0.0', sourceCommit: null }
  })
  assert.equal(record.type, '问题')
  assert.equal(record.localDate, localDateString())
  assert.equal(record.activeEngine, 'kimi')
  assert.equal(record.sourceCommit, null)

  const events = await readJsonl(dir)
  assert.equal(events.length, 1)
  assert.equal(events[0].op, 'create')
  assert.equal(events[0].record.id, record.id)

  const fresh = createDogfoodService({ dir })
  const today = await fresh.today()
  assert.equal(today.length, 1)
  assert.equal(today[0].text, 'Viewer 最后打开又是空的')
})

test('create rejects invalid type or empty text without writing', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  await assert.rejects(() => service.create({ type: 'bug', text: 'x' }), /记录类型无效/)
  await assert.rejects(() => service.create({ type: '问题', text: '   ' }), /记录内容无效/)
  await assert.rejects(
    () => service.create({ type: '问题', text: 'x'.repeat(20001) }),
    /记录内容无效/
  )
  await assert.rejects(() => fs.stat(path.join(dir, 'inbox.jsonl')))
})

test('update appends an update event and folds type/text changes', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  const record = await service.create({ type: '问题', text: 'before' })
  const updated = await service.update({ id: record.id, patch: { type: '想法', text: 'after' } })
  assert.equal(updated.type, '想法')
  assert.equal(updated.text, 'after')
  assert.ok(updated.updatedAt)

  const events = await readJsonl(dir)
  assert.deepEqual(events.map(e => e.op), ['create', 'update'])
  assert.deepEqual(events[1].patch, { type: '想法', text: 'after' })

  const fresh = createDogfoodService({ dir })
  const list = await fresh.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].text, 'after')
  assert.equal(list[0].type, '想法')
})

test('delete appends a delete event and folds the record away', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  const first = await service.create({ type: '问题', text: 'one' })
  const second = await service.create({ type: '正向反馈', text: 'two' })
  await service.remove({ id: first.id })

  const events = await readJsonl(dir)
  assert.deepEqual(events.map(e => e.op), ['create', 'create', 'delete'])
  assert.equal(events[2].id, first.id)
  assert.ok(events[2].deletedAt)

  const fresh = createDogfoodService({ dir })
  const list = await fresh.list()
  assert.deepEqual(list.map(r => r.id), [second.id])
  await assert.rejects(() => service.remove({ id: first.id }), /记录不存在/)
})

test('malformed trailing line is ignored without touching earlier records or the file', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  await service.create({ type: '问题', text: 'r1' })
  await service.create({ type: '想法', text: 'r2' })
  await service.create({ type: '正向反馈', text: 'r3' })

  const jsonlPath = path.join(dir, 'inbox.jsonl')
  const before = await fs.readFile(jsonlPath, 'utf8')
  await fs.appendFile(jsonlPath, '{"op":"create","record":{"id":"broken', 'utf8')
  const afterAppend = await fs.readFile(jsonlPath, 'utf8')

  const malformed = []
  const fresh = createDogfoodService({
    dir,
    onMalformedLine: entry => malformed.push(entry)
  })
  const list = await fresh.list()
  assert.equal(list.length, 3)
  assert.deepEqual(list.map(r => r.text), ['r1', 'r2', 'r3'])
  assert.equal(malformed.length, 1)
  assert.equal(malformed[0].line, 4)

  // 加载绝不能 truncate 或重写日志: 文件字节保持原样(含损坏尾行)。
  const afterLoad = await fs.readFile(jsonlPath, 'utf8')
  assert.equal(afterLoad, afterAppend)
  assert.ok(before.length < afterLoad.length)
})

test('today returns only current local date records, newest first', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  await fs.mkdir(dir, { recursive: true })
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const old = {
    id: 'old-1',
    createdAt: yesterday.toISOString(),
    localDate: localDateString(yesterday),
    type: '问题',
    text: 'yesterday'
  }
  await fs.writeFile(
    path.join(dir, 'inbox.jsonl'),
    `${JSON.stringify({ op: 'create', record: old })}\n`,
    'utf8'
  )
  await service.create({ type: '问题', text: 'first today' })
  await service.create({ type: '想法', text: 'second today' })

  const today = await service.today()
  assert.equal(today.length, 2)
  assert.equal(today[0].text, 'second today')
  assert.equal(today[1].text, 'first today')
  assert.equal((await service.list()).length, 3)
})

test('inbox.md snapshot is regenerated from folded records', async () => {
  const dir = await makeTempDir()
  const service = createDogfoodService({ dir })
  await service.create({
    type: '问题',
    text: 'Viewer 第一次打开为空',
    context: { activeEngine: 'kimi', sourceCommit: 'a'.repeat(40) }
  })
  const markdown = await fs.readFile(path.join(dir, 'inbox.md'), 'utf8')
  assert.match(markdown, /# Arckeep Dogfood Inbox/)
  assert.match(markdown, /### \d{2}:\d{2} · 问题/)
  assert.match(markdown, /Engine: Kimi/)
  assert.match(markdown, /Build: a{7}/)
  assert.match(markdown, /Viewer 第一次打开为空/)
})

test('markdown snapshot failure does not roll back the JSONL mutation', async () => {
  const dir = await makeTempDir()
  // 让 inbox.md 路径变成目录, 强制快照写入失败。
  await fs.mkdir(path.join(dir, 'inbox.md'), { recursive: true })
  const snapshotErrors = []
  const service = createDogfoodService({
    dir,
    onSnapshotError: error => snapshotErrors.push(error)
  })
  const record = await service.create({ type: '问题', text: 'still saved' })
  assert.ok(record.id)
  assert.equal(snapshotErrors.length, 1)
  const events = await readJsonl(dir)
  assert.equal(events.length, 1)
  assert.equal(events[0].record.text, 'still saved')
  const fresh = createDogfoodService({ dir })
  assert.equal((await fresh.list()).length, 1)
})

test('persistence stays inside the given profile dogfood directory', async () => {
  const profile = await makeTempDir()
  const dir = path.join(profile, 'dogfood')
  const service = createDogfoodService({ dir })
  await service.create({ type: '想法', text: 'profile isolation' })
  const entries = await fs.readdir(profile)
  assert.deepEqual(entries, ['dogfood'])
  const dogfoodFiles = (await fs.readdir(dir)).sort()
  assert.deepEqual(dogfoodFiles, ['inbox.jsonl', 'inbox.md'])
})
