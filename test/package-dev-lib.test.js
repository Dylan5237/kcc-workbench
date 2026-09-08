import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  isFullSha,
  makeBuildInfo,
  normalizeWorktreePath,
  parseWorktreePorcelain,
  shortSha
} from '../scripts/package-dev-lib.mjs'

const SHA = '44c6fa0df010d37004bd33cc6ad6e639f7bbc58f'

test('isFullSha accepts only 40-char lowercase hex', () => {
  assert.equal(isFullSha(SHA), true)
  assert.equal(isFullSha(SHA.toUpperCase()), false)
  assert.equal(isFullSha(SHA.slice(0, 39)), false)
  assert.equal(isFullSha(`${SHA}0`), false)
  assert.equal(isFullSha(''), false)
  assert.equal(isFullSha(undefined), false)
})

test('shortSha returns the first 7 chars and rejects invalid input', () => {
  assert.equal(shortSha(SHA), '44c6fa0')
  assert.throws(() => shortSha('44c6fa0'), /40-char/)
})

test('parseWorktreePorcelain parses branches, detached and prunable entries', () => {
  const porcelain = [
    'worktree D:/_projects/tools/KCCWorkbench',
    `HEAD ${SHA}`,
    'branch refs/heads/feature/viewer-modes',
    '',
    'worktree D:/_projects/tools/kcc-workbench-wt-package-dev',
    `HEAD ${SHA}`,
    'detached',
    '',
    'worktree D:/_projects/tools/kcc-workbench-wt-stale',
    `HEAD ${SHA}`,
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    ''
  ].join('\n')

  const worktrees = parseWorktreePorcelain(porcelain)
  assert.equal(worktrees.length, 3)
  assert.deepEqual(worktrees[0], {
    path: 'D:/_projects/tools/KCCWorkbench',
    head: SHA,
    branch: 'refs/heads/feature/viewer-modes',
    detached: false,
    bare: false,
    prunable: false,
    locked: false
  })
  assert.equal(worktrees[1].branch, null)
  assert.equal(worktrees[1].detached, true)
  assert.equal(worktrees[2].prunable, true)
})

test('normalizeWorktreePath equalizes separators, case and trailing slash', () => {
  const a = normalizeWorktreePath('D:/_projects/tools/kcc-workbench-wt-package-dev/')
  const b = normalizeWorktreePath('d:\\_projects\\tools\\KCC-WORKBENCH-WT-PACKAGE-DEV')
  assert.equal(a, b)
})

test('makeBuildInfo emits the contract shape with a fixed clock', () => {
  const info = makeBuildInfo({
    sourceBranch: 'develop/kcc-1.0',
    sourceCommit: SHA,
    version: '1.0.0',
    builtAt: '2026-09-08T00:00:00.000Z'
  })
  assert.deepEqual(info, {
    sourceBranch: 'develop/kcc-1.0',
    sourceCommit: SHA,
    sourceCommitShort: '44c6fa0',
    version: '1.0.0',
    mode: 'development',
    builtAt: '2026-09-08T00:00:00.000Z'
  })
})

test('makeBuildInfo rejects missing or malformed fields', () => {
  assert.throws(() => makeBuildInfo({ sourceBranch: '', sourceCommit: SHA, version: '1.0.0' }), /sourceBranch/)
  assert.throws(() => makeBuildInfo({ sourceBranch: 'develop/kcc-1.0', sourceCommit: 'abc1234', version: '1.0.0' }), /40-char/)
  assert.throws(() => makeBuildInfo({ sourceBranch: 'develop/kcc-1.0', sourceCommit: SHA, version: '' }), /version/)
  assert.throws(
    () => makeBuildInfo({ sourceBranch: 'develop/kcc-1.0', sourceCommit: SHA, version: '1.0.0', builtAt: 'not-a-date' }),
    /ISO-8601/
  )
})

test('CLI build-info writes metadata file without machine paths or usernames', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kcc-build-info-'))
  try {
    const out = path.join(dir, 'build-info.json')
    execFileSync(process.execPath, [
      'scripts/package-dev-lib.mjs', 'build-info',
      '--sha', SHA,
      '--branch', 'develop/kcc-1.0',
      '--now', '2026-09-08T00:00:00.000Z',
      '--out', out
    ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })

    const raw = readFileSync(out, 'utf8')
    const info = JSON.parse(raw)
    assert.equal(info.sourceCommit, SHA)
    assert.equal(info.sourceCommitShort, '44c6fa0')
    assert.equal(info.sourceBranch, 'develop/kcc-1.0')
    assert.equal(info.mode, 'development')
    assert.equal(typeof info.version, 'string')
    assert.ok(info.version.length > 0)
    assert.ok(!raw.includes(tmpdir()), 'metadata must not contain machine paths')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI parse-worktrees reads porcelain from stdin', () => {
  const output = execFileSync(process.execPath, ['scripts/package-dev-lib.mjs', 'parse-worktrees'], {
    cwd: new URL('..', import.meta.url),
    input: `worktree D:/x\nHEAD ${SHA}\ndetached\n\n`,
    encoding: 'utf8'
  })
  const worktrees = JSON.parse(output)
  assert.equal(worktrees.length, 1)
  assert.equal(worktrees[0].detached, true)
})
