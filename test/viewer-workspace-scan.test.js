import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  WATCHED_EXTENSIONS,
  MAX_SCANNED_ENTRIES,
  MAX_SNAPSHOT_DOCUMENTS,
  MAX_SNAPSHOT_BYTES,
  MAX_ARTIFACT_CONTENT_BYTES,
  shouldIgnoreDirectoryEntry,
  isIgnoredRelativePath,
  isIgnoredPathSegment,
  classifyFileKind,
  isTextFileExtension,
  normalizeWebPath,
  readArtifactDocument,
  createWorkspaceScan,
  scanBaselineDocuments,
  scanRecoverySlice,
  buildWorkspaceTree
} = require('../src/viewer/workspace-scan.cjs')

test('extension sets and predicates keep server.cjs semantics', () => {
  assert.equal(MAX_SCANNED_ENTRIES, 20_000)
  assert.equal(MAX_SNAPSHOT_DOCUMENTS, 2_000)
  assert.equal(MAX_SNAPSHOT_BYTES, 64 * 1024 * 1024)
  assert.equal(MAX_ARTIFACT_CONTENT_BYTES, 512 * 1024)
  assert.ok(WATCHED_EXTENSIONS.has('.md') && WATCHED_EXTENSIONS.has('.mermaid') && WATCHED_EXTENSIONS.has('.json'))
  assert.ok(!WATCHED_EXTENSIONS.has('.js'))
  assert.equal(classifyFileKind('.md'), 'doc')
  assert.equal(classifyFileKind('.js'), 'code')
  assert.equal(classifyFileKind('.png'), 'image')
  assert.equal(classifyFileKind('.bin'), 'binary')
  assert.equal(isTextFileExtension('.md'), true)
  assert.equal(isTextFileExtension('.js'), true)
  assert.equal(isTextFileExtension('.bin'), false)
  assert.equal(isIgnoredPathSegment('.git'), true)
  assert.equal(isIgnoredPathSegment('node_modules'), true)
  assert.equal(isIgnoredPathSegment('tmp-old'), true)
  assert.equal(isIgnoredPathSegment('x.draft.md'), true)
  assert.equal(isIgnoredPathSegment('notes.md~'), true)
  assert.equal(isIgnoredPathSegment('regular.md'), false)
  assert.equal(isIgnoredRelativePath('sub/node_modules/a.md'), true)
  assert.equal(isIgnoredRelativePath('sub/a.md'), false)
  assert.equal(normalizeWebPath('a\\b\\c.md'), 'a/b/c.md')
  assert.equal(normalizeWebPath('.'), '')
  assert.equal(shouldIgnoreDirectoryEntry({ name: 'node_modules', isDirectory: () => true }), true)
  assert.equal(shouldIgnoreDirectoryEntry({ name: 'tmp-run', isDirectory: () => true }), true)
  assert.equal(shouldIgnoreDirectoryEntry({ name: 'src', isDirectory: () => true }), false)
  assert.equal(shouldIgnoreDirectoryEntry({ name: 'x.tmp', isDirectory: () => false }), true)
  assert.equal(shouldIgnoreDirectoryEntry({ name: 'a.md', isDirectory: () => false }), false)
})

test('readArtifactDocument reads contents and guards path escapes', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-read-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  await fs.writeFile(path.join(tmp, 'a.md'), 'hello')
  const doc = await readArtifactDocument(tmp, 'a.md')
  assert.ok(doc)
  assert.equal(doc.content, 'hello')
  assert.equal(doc.size, 5)
  assert.equal(typeof doc.mtime, 'number')
  assert.equal(await readArtifactDocument(tmp, '../outside.md'), null)
  assert.equal(await readArtifactDocument(tmp, path.join(tmp, 'missing.md')), null)
})

test('baseline maps primary-relative and extra-root-absolute keys, skips ignored and symlinked entries', async t => {
  const primary = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-base-p-'))
  const extra = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-base-e-'))
  t.after(() => fs.rm(primary, { recursive: true, force: true }))
  t.after(() => fs.rm(extra, { recursive: true, force: true }))
  await fs.mkdir(path.join(primary, 'sub'))
  await fs.writeFile(path.join(primary, 'doc.md'), '# doc')
  await fs.writeFile(path.join(primary, 'sub', 'inner.md'), '# inner')
  await fs.writeFile(path.join(primary, 'draft.draft.md'), 'draft')
  await fs.writeFile(path.join(primary, 'note.tmp'), 'tmp')
  await fs.writeFile(path.join(primary, '.hidden.md'), 'hidden')
  await fs.mkdir(path.join(primary, 'node_modules'))
  await fs.writeFile(path.join(primary, 'node_modules', 'pkg.md'), 'pkg')
  await fs.mkdir(path.join(primary, 'tmp-scratch'))
  await fs.writeFile(path.join(primary, 'tmp-scratch', 'scratch.md'), 'scratch')
  await fs.writeFile(path.join(extra, 'extra.md'), '# extra')
  let symlinkCreated = false
  try {
    await fs.symlink(path.join(primary, 'sub'), path.join(primary, 'linked'), 'junction')
    symlinkCreated = true
  } catch {
    // symlink privileges unavailable: skip the symlink assertions
  }
  const state = createWorkspaceScan({ roots: [primary, extra], primaryRoot: primary })
  const result = await scanBaselineDocuments(state)
  assert.equal(result.done, true)
  assert.equal(result.stats.truncated.entries, false)
  assert.equal(result.stats.truncated.documents, false)
  const keys = [...result.documents.keys()]
  assert.ok(keys.includes('doc.md'))
  assert.ok(keys.includes('sub/inner.md'))
  assert.ok(keys.includes(normalizeWebPath(path.join(extra, 'extra.md'))))
  assert.equal(result.documents.get('doc.md').content, '# doc')
  assert.ok(!keys.includes('draft.draft.md'))
  assert.ok(!keys.includes('note.tmp'))
  assert.ok(!keys.includes('.hidden.md'))
  assert.ok(!keys.includes('node_modules/pkg.md'))
  assert.ok(!keys.includes('tmp-scratch/scratch.md'))
  assert.ok(!keys.includes(normalizeWebPath(path.join(primary, 'node_modules', 'pkg.md'))))
  if (symlinkCreated) {
    assert.ok(!keys.includes('linked/inner.md'))
    assert.ok(!keys.includes(normalizeWebPath(path.join(primary, 'linked', 'inner.md'))))
  }
})

test('baseline honors injected limits and reports truncation flags', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-cap-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  for (let i = 0; i < 5; i += 1) await fs.writeFile(path.join(tmp, `doc-${i}.md`), `# ${i}`)
  const docState = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  const docResult = await scanBaselineDocuments(docState, { limits: { maxSnapshotDocuments: 2 } })
  assert.equal(docResult.done, true)
  assert.equal(docResult.documents.size, 2)
  assert.equal(docResult.stats.truncated.documents, true)
  const entryState = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  const entryResult = await scanBaselineDocuments(entryState, { limits: { maxScannedEntries: 3 } })
  assert.equal(entryResult.done, true)
  assert.equal(entryResult.stats.truncated.entries, true)
  assert.ok(entryResult.stats.entries <= 3)
})

test('sliced baseline accumulates documents across calls until done', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-slice-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  for (let i = 0; i < 10; i += 1) await fs.writeFile(path.join(tmp, `doc-${i}.md`), `# ${i}`)
  const state = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  const first = await scanBaselineDocuments(state, { slice: { maxEntries: 3, deadlineMs: Infinity } })
  assert.equal(first.done, false)
  assert.ok(first.stats.entries <= 3)
  assert.ok(first.documents.size >= 1)
  let guard = 0
  let last = first
  while (!last.done && guard < 20) {
    last = await scanBaselineDocuments(state, { slice: { maxEntries: 3, deadlineMs: Infinity } })
    guard += 1
  }
  assert.equal(last.done, true)
  assert.equal(last.documents.size, 10)
  assert.deepEqual(
    [...last.documents.keys()].sort(),
    Array.from({ length: 10 }, (_, i) => `doc-${i}.md`)
  )
  assert.equal(last.stats.truncated.entries, false)
})

test('recovery slices respect entry budget and complete the sweep with seen set', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  for (let i = 0; i < 10; i += 1) await fs.writeFile(path.join(tmp, `doc-${i}.md`), `# ${i}`)
  const state = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  state.phase = 'sweep-idle' // baseline finished elsewhere
  const slice1 = await scanRecoverySlice(state, { maxEntries: 4, deadlineMs: Number.MAX_SAFE_INTEGER })
  assert.ok(slice1.stats.entries <= 4)
  assert.equal(slice1.sweepComplete, false)
  assert.ok(slice1.batch.every(([, stat]) => typeof stat.mtime === 'number' && typeof stat.size === 'number'))
  let guard = 0
  let last = slice1
  while (!last.sweepComplete && guard < 20) {
    last = await scanRecoverySlice(state, { maxEntries: 4, deadlineMs: Number.MAX_SAFE_INTEGER })
    guard += 1
  }
  assert.equal(last.sweepComplete, true)
  assert.equal(last.scanComplete, true)
  assert.equal(last.seen.length, 10)
  assert.deepEqual([...last.seen].sort(), Array.from({ length: 10 }, (_, i) => `doc-${i}.md`))
})

test('recovery slice honors injected deadline and re-reports changed mtime in the next sweep', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-deadline-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  await fs.mkdir(path.join(tmp, 'nested-a'))
  await fs.mkdir(path.join(tmp, 'nested-b'))
  for (let i = 0; i < 3; i += 1) {
    await fs.writeFile(path.join(tmp, `root-${i}.md`), `# ${i}`)
    await fs.writeFile(path.join(tmp, 'nested-a', `a-${i}.md`), `# a${i}`)
    await fs.writeFile(path.join(tmp, 'nested-b', `b-${i}.md`), `# b${i}`)
  }
  const state = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  state.phase = 'sweep-idle'
  // now sequence: slice start, deadline check before first readdir, then a
  // value past the deadline for the check before the second directory read
  const ticks = [0, 0, 100_000]
  let calls = 0
  const now = () => ticks[Math.min(calls++, ticks.length - 1)]
  const timed = await scanRecoverySlice(state, { maxEntries: 100, deadlineMs: 1000, now })
  assert.equal(timed.sweepComplete, false)
  assert.equal(timed.stats.budgetHit, 'deadline')
  // finish sweep 1 with a generous budget
  const batches = [...timed.batch]
  let guard = 0
  let last = timed
  while (!last.sweepComplete && guard < 50) {
    last = await scanRecoverySlice(state, { maxEntries: 4, deadlineMs: Number.MAX_SAFE_INTEGER })
    batches.push(...last.batch)
    guard += 1
  }
  assert.equal(last.sweepComplete, true)
  assert.equal(last.scanComplete, true)
  assert.equal(last.seen.length, 9)
  assert.ok(batches.length >= 9)
  // change one file; the next sweep must re-report it with the new mtime
  const target = path.join(tmp, 'root-0.md')
  const bumpedMtime = Date.now() + 60_000
  await fs.utimes(target, bumpedMtime / 1000, bumpedMtime / 1000)
  const sweep2 = []
  let second = { sweepComplete: false }
  guard = 0
  while (!second.sweepComplete && guard < 50) {
    second = await scanRecoverySlice(state, { maxEntries: 4, deadlineMs: Number.MAX_SAFE_INTEGER })
    sweep2.push(...second.batch)
    guard += 1
  }
  assert.equal(second.sweepComplete, true)
  assert.equal(second.scanComplete, true)
  assert.equal(second.seen.length, 9)
  const changed = sweep2.find(([key]) => key === 'root-0.md')
  assert.ok(changed, 'changed file must be re-reported in the next sweep')
  assert.ok(Math.abs(changed[1].mtime - bumpedMtime) < 2000)
  assert.equal(typeof changed[1].size, 'number')
})

test('recovery returns scanComplete=false for unreadable or nonexistent roots while still completing the sweep', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-miss-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const missing = path.join(tmp, 'does-not-exist')
  const state = createWorkspaceScan({ roots: [missing], primaryRoot: missing })
  state.phase = 'sweep-idle'
  const slice = await scanRecoverySlice(state, { maxEntries: 10, deadlineMs: Number.MAX_SAFE_INTEGER })
  assert.equal(slice.sweepComplete, true)
  assert.equal(slice.scanComplete, false)
  assert.deepEqual(slice.seen, [])
})

test('recovery sweep caps the seen set and marks scanComplete=false', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-scan-seen-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  for (let i = 0; i < 5; i += 1) await fs.writeFile(path.join(tmp, `doc-${i}.md`), `# ${i}`)
  const state = createWorkspaceScan({ roots: [tmp], primaryRoot: tmp })
  state.phase = 'sweep-idle'
  let guard = 0
  let last = { sweepComplete: false }
  while (!last.sweepComplete && guard < 50) {
    last = await scanRecoverySlice(state, {
      maxEntries: 100,
      deadlineMs: Number.MAX_SAFE_INTEGER,
      limits: { maxSnapshotDocuments: 3 }
    })
    guard += 1
  }
  assert.equal(last.sweepComplete, true)
  assert.equal(last.scanComplete, false)
  assert.equal(last.seen.length, 3)
})

test('buildWorkspaceTree keeps node shape, sorting, includeAll kinds, truncation, and extra-root prefixes', async t => {
  const primary = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-tree-p-'))
  const extra = await fs.mkdtemp(path.join(os.tmpdir(), 'kcc-tree-e-'))
  t.after(() => fs.rm(primary, { recursive: true, force: true }))
  t.after(() => fs.rm(extra, { recursive: true, force: true }))
  await fs.mkdir(path.join(primary, 'zeta'))
  await fs.mkdir(path.join(primary, 'alpha'))
  await fs.writeFile(path.join(primary, 'b.md'), 'b')
  await fs.writeFile(path.join(primary, 'a.md'), 'a')
  await fs.writeFile(path.join(primary, 'alpha', 'inner.md'), 'i')
  await fs.writeFile(path.join(primary, 'alpha', 'app.js'), 'js')
  await fs.writeFile(path.join(primary, 'alpha', 'logo.png'), 'png')
  await fs.writeFile(path.join(primary, 'alpha', 'blob.bin'), 'bin')
  await fs.writeFile(path.join(extra, 'extra.md'), 'e')
  const { tree, stats } = await buildWorkspaceTree({ roots: [primary, extra], primaryRoot: primary, includeAll: true })
  assert.equal(stats.truncated, false)
  assert.equal(tree.type, 'dir')
  assert.equal(tree.path, '')
  assert.equal(tree.name, path.basename(primary))
  const byName = new Map(tree.children.map(child => [child.name, child]))
  // empty directories are pruned, so zeta must not appear
  assert.ok(!byName.has('zeta'))
  const dirs = tree.children.filter(child => child.type === 'dir').map(child => child.name)
  const files = tree.children.filter(child => child.type === 'file').map(child => child.name)
  assert.deepEqual(dirs, [...dirs].sort((left, right) => left.localeCompare(right, 'zh-CN')))
  assert.deepEqual(files, [...files].sort((left, right) => left.localeCompare(right, 'zh-CN')))
  const firstFileIndex = tree.children.findIndex(child => child.type === 'file')
  assert.ok(tree.children.slice(0, firstFileIndex).every(child => child.type === 'dir'))
  const alpha = byName.get('alpha')
  assert.ok(alpha)
  assert.equal(alpha.path, 'alpha')
  const kinds = new Map(alpha.children.map(child => [child.name, child.kind]))
  assert.equal(kinds.get('inner.md'), 'doc')
  assert.equal(kinds.get('app.js'), 'code')
  assert.equal(kinds.get('logo.png'), 'image')
  assert.equal(kinds.get('blob.bin'), 'binary')
  const aFile = byName.get('a.md')
  assert.deepEqual(Object.keys(aFile).sort(), ['ext', 'kind', 'mtime', 'name', 'path', 'size', 'type'])
  assert.equal(aFile.path, 'a.md')
  assert.equal(aFile.ext, '.md')
  assert.equal(aFile.kind, 'doc')
  assert.equal(typeof aFile.size, 'number')
  assert.equal(typeof aFile.mtime, 'number')
  // extra root is prefixed with its absolute web path, name stays the basename
  const extraBase = normalizeWebPath(extra)
  const extraNode = byName.get(path.basename(extra))
  assert.ok(extraNode)
  assert.equal(extraNode.type, 'dir')
  assert.equal(extraNode.path, extraBase)
  assert.equal(extraNode.children.length, 1)
  assert.equal(extraNode.children[0].path, `${extraBase}/extra.md`)
  assert.equal(extraNode.children[0].name, 'extra.md')
  // run mode (includeAll=false) only includes watched extensions
  const runTree = await buildWorkspaceTree({ roots: [primary], primaryRoot: primary, includeAll: false })
  const runAlpha = runTree.tree.children.find(child => child.name === 'alpha')
  assert.deepEqual(runAlpha.children.map(child => child.name), ['inner.md'])
  assert.equal(runTree.stats.truncated, false)
  // entry budget is shared and reported
  const capped = await buildWorkspaceTree({
    roots: [primary, extra],
    primaryRoot: primary,
    includeAll: false,
    limits: { maxScannedEntries: 2 }
  })
  assert.equal(capped.stats.truncated, true)
  assert.ok(capped.stats.entries <= 2)
})
