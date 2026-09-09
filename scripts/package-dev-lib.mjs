#!/usr/bin/env node
// Pure helpers for scripts/package-dev.ps1 (deterministic development packaging).
// PowerShell orchestration calls these through the small CLI at the bottom so the
// logic stays unit-testable with `node --test` (see test/package-dev-lib.test.js).
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FULL_SHA_RE = /^[0-9a-f]{40}$/

export function isFullSha(value) {
  return typeof value === 'string' && FULL_SHA_RE.test(value)
}

export function shortSha(sha) {
  if (!isFullSha(sha)) {
    throw new Error(`expected a 40-char lowercase hex SHA, got: ${JSON.stringify(sha)}`)
  }
  return sha.slice(0, 7)
}

// Parse `git worktree list --porcelain` output into structured records.
// Each block: `worktree <path>` / `HEAD <sha>` / one of `branch <ref>`|`detached`|`bare`,
// optionally followed by `locked` / `prunable <reason>`.
export function parseWorktreePorcelain(text) {
  const worktrees = []
  let current = null
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), head: null, branch: null, detached: false, bare: false, prunable: false, locked: false }
      worktrees.push(current)
    } else if (!current) {
      continue
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length)
    } else if (line === 'detached') {
      current.detached = true
    } else if (line === 'bare') {
      current.bare = true
    } else if (line.startsWith('prunable')) {
      current.prunable = true
    } else if (line.startsWith('locked')) {
      current.locked = true
    }
  }
  return worktrees
}

// Normalize a worktree path for comparison across Git Bash / PowerShell styles.
export function normalizeWorktreePath(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()
}

// Build the machine-readable metadata emitted next to the dev package artifact.
// Only non-sensitive fields are allowed; no usernames, machine paths, or tokens.
export function makeBuildInfo({ sourceBranch, sourceCommit, version, mode = 'development', builtAt }) {
  if (typeof sourceBranch !== 'string' || !sourceBranch) {
    throw new Error('sourceBranch is required')
  }
  if (!isFullSha(sourceCommit)) {
    throw new Error(`sourceCommit must be a 40-char lowercase hex SHA, got: ${JSON.stringify(sourceCommit)}`)
  }
  if (typeof version !== 'string' || !version) {
    throw new Error('version is required')
  }
  const timestamp = builtAt ?? new Date().toISOString()
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`builtAt must be an ISO-8601 timestamp, got: ${JSON.stringify(timestamp)}`)
  }
  return {
    sourceBranch,
    sourceCommit,
    sourceCommitShort: shortSha(sourceCommit),
    version,
    mode,
    builtAt: timestamp
  }
}

// Dependency-reuse fingerprint (#19 R1): any change to package.json OR
// package-lock.json OR the node/npm runtime must invalidate the stamp, so a
// package.json edit that forgot to sync the lockfile still falls through to
// `npm ci`, which then fails closed on the manifest/lockfile mismatch.
export function makeDependencyFingerprint({ packageJsonPath, packageLockPath, nodeVersion, npmVersion, platform }) {
  for (const [name, value] of [['nodeVersion', nodeVersion], ['npmVersion', npmVersion], ['platform', platform]]) {
    if (typeof value !== 'string' || !value) throw new Error(`${name} is required`)
  }
  const sha256 = filePath => createHash('sha256').update(readFileSync(filePath)).digest('hex')
  return [
    `package=${sha256(packageJsonPath)}`,
    `lock=${sha256(packageLockPath)}`,
    `node=${nodeVersion}`,
    `npm=${npmVersion}`,
    `os=${platform}`
  ].join('|')
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1]
      i++
    }
  }
  return args
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'parse-worktrees') {
    const input = readFileSync(0, 'utf8')
    process.stdout.write(JSON.stringify(parseWorktreePorcelain(input)))
    return
  }
  if (command === 'build-info') {
    const args = parseArgs(rest)
    // --pkg lets the orchestrator point at the *packaging* worktree's package.json,
    // which may differ from the checkout this script file itself lives in.
    const pkgPath = args.pkg ?? path.resolve(import.meta.dirname, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const info = makeBuildInfo({
      sourceBranch: args.branch,
      sourceCommit: args.sha,
      version: pkg.version,
      builtAt: args.now
    })
    if (args.out) {
      writeFileSync(args.out, JSON.stringify(info, null, 2) + '\n')
    } else {
      process.stdout.write(JSON.stringify(info, null, 2) + '\n')
    }
    return
  }
  if (command === 'dep-fingerprint') {
    const args = parseArgs(rest)
    // --pkg/--lock point at the *packaging* worktree's manifests (frozen source).
    process.stdout.write(makeDependencyFingerprint({
      packageJsonPath: args.pkg,
      packageLockPath: args.lock,
      nodeVersion: args.node,
      npmVersion: args.npm,
      platform: args.os
    }))
    return
  }
  console.error('usage: package-dev-lib.mjs <parse-worktrees|build-info|dep-fingerprint> [--sha X --branch Y --pkg P --lock L --node V --npm V --os O --out Z --now ISO]')
  process.exit(2)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
