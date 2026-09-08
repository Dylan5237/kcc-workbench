import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Contract tests for scripts/package-dev.ps1 (K1-S0.3 R1):
// the development package source and the dependency install path must not be
// caller-overridable.
const scriptPath = fileURLToPath(new URL('../scripts/package-dev.ps1', import.meta.url))
const scriptText = readFileSync(scriptPath, 'utf8')

function paramBlock(text) {
  const match = text.match(/param\(([\s\S]*?)\n\)/)
  assert.ok(match, 'package-dev.ps1 must have a param block')
  return match[1]
}

test('package-dev.ps1 exposes no SourceRef/SourceBranch override', () => {
  const block = paramBlock(scriptText)
  assert.ok(!/\$SourceRef/.test(block), 'param block must not declare $SourceRef')
  assert.ok(!/\$SourceBranch/.test(block), 'param block must not declare $SourceBranch')
  // preserved safe path parameters
  assert.match(block, /\$RepoRoot/)
  assert.match(block, /\$PackagingWorktree/)
})

test('development source and metadata branch are fixed inside the script', () => {
  assert.ok(
    scriptText.includes("$SourceRef = 'origin/develop/kcc-1.0'"),
    'source ref must be hardcoded to origin/develop/kcc-1.0'
  )
  assert.ok(
    scriptText.includes("$SourceBranch = 'develop/kcc-1.0'"),
    'metadata branch must be hardcoded to develop/kcc-1.0'
  )
})

test('no SkipInstall escape hatch exists anywhere in the script', () => {
  assert.ok(!/SkipInstall/.test(scriptText), 'SkipInstall must be fully removed')
  assert.ok(!/SkipInstall/.test(paramBlock(scriptText)))
})

test('PowerShell parses the script and confirms the public parameter surface', () => {
  const output = execFileSync('powershell', [
    '-NoProfile', '-Command',
    `(Get-Command '${scriptPath.replace(/'/g, "''")}').Parameters.Keys -join ','`
  ], { encoding: 'utf8' }).trim()
  const params = output.split(',').filter(Boolean)
  assert.ok(params.includes('RepoRoot'), `RepoRoot missing in: ${output}`)
  assert.ok(params.includes('PackagingWorktree'), `PackagingWorktree missing in: ${output}`)
  for (const removed of ['SourceRef', 'SourceBranch', 'SkipInstall']) {
    assert.ok(!params.includes(removed), `${removed} must not be a public parameter (got: ${output})`)
  }
})
