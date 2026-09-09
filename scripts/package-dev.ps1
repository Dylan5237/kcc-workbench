#requires -Version 5.1
<#
.SYNOPSIS
  Deterministic Arckeep development packaging (K1-S0.3, issue #25).

.DESCRIPTION
  Orchestration wrapper around the existing build path (npm test + scripts/pack.mjs).
  The package source is ALWAYS the exact fetched origin/develop/kcc-1.0 SHA, built
  inside a dedicated detached packaging worktree -- never the caller's branch,
  worktree, or uncommitted changes.

  Modes:
    default  full deterministic zip (npm ci [stamp-validated], npm test, zip pack)
    -Fast    local iteration: unpacked app in dist-fast/, no tests, no zip;
             same frozen source, detached worktree, and build-info provenance

  Safety contract:
    - never checkout/switch/reset/clean/stash the control repo or any feature worktree
    - never git pull; fetch only
    - a dirty registered packaging worktree stops the run (fail-closed)
    - dependency reuse is keyed on package.json + package-lock.json SHA-256 and
      node/npm versions, never on a bare node_modules-exists check
      (-ForceInstall bypasses)

  Stop conditions (exit codes):
    10  STOP PACKAGING_WORKTREE_DIRTY
    11  STOP PACKAGING_WORKTREE_CONFLICT
    12  STOP PACKAGING_BASELINE_MISMATCH
    13  STOP PACKAGING_SCOPE_EXPANSION
     1  any other failure (fetch, install, test, build)

.EXAMPLE
  powershell -NoProfile -File scripts/package-dev.ps1
#>
[CmdletBinding()]
param(
  # Control repo used as the Git entry point. Default: the repo containing this script.
  # Its checked-out branch and working tree are never modified.
  [string]$RepoRoot = '',

  # Dedicated packaging worktree. Default: sibling of the control repo named
  # 'kcc-workbench-wt-package-dev'. Must be detached at the resolved SHA.
  [string]$PackagingWorktree = '',

  # Skip 'npm test' before packaging. Not recommended; acceptance runs tests.
  [switch]$SkipTests,

  # Fast local iteration (K1-S0.4 / #19): produce an unpacked runnable app in
  # dist-fast/ instead of the full zip, skipping the separate test phase (the
  # fast pack path never runs tests). The deterministic source freeze, detached
  # packaging worktree, and build-info provenance are unchanged. The full zip
  # path remains the default.
  [switch]$Fast,

  # Force 'npm ci' even when the validated dependency stamp matches. Reuse is
  # keyed on the exact package.json + package-lock.json content plus node/npm
  # runtime versions, never on a bare "node_modules exists" check.
  [switch]$ForceInstall
)

# Development package source is mechanically fixed. No CLI override exists on
# purpose: a caller must never be able to package a feature ref while labeling
# the metadata as develop. Future release packaging gets its own
# package-release.ps1 instead of a generic -SourceRef parameter here.
$SourceRef = 'origin/develop/kcc-1.0'
$SourceBranch = 'develop/kcc-1.0'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$script:Timings = [ordered]@{}
$script:RunStart = [Diagnostics.Stopwatch]::StartNew()

function Stop-Packaging([int]$Code, [string]$Token, [string]$Detail) {
  Write-Host ''
  Write-Host "STOP $Token"
  Write-Host $Detail
  exit $Code
}

function Invoke-Git([string]$WorkDir, [string[]]$GitArgs) {
  # Note: no 2>&1 here. Redirecting native stderr in PS 5.1 wraps lines as
  # ErrorRecords, which $ErrorActionPreference='Stop' would turn into fatal
  # NativeCommandError on ordinary git progress output. Let stderr pass through
  # to the console and judge by exit code only.
  # ($GitArgs, not $Args: a parameter named $Args collides with the automatic
  # variable and silently breaks splatting.)
  $output = & git -C $WorkDir @GitArgs
  if ($LASTEXITCODE -ne 0) {
    throw "git $($GitArgs -join ' ') failed (exit $LASTEXITCODE)"
  }
  return $output
}

function Test-GitOk([string]$WorkDir, [string[]]$GitArgs) {
  & git -C $WorkDir @GitArgs 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function ConvertTo-NormalizedPath([string]$Path) {
  return ([IO.Path]::GetFullPath($Path)).TrimEnd('\', '/').ToLowerInvariant()
}

function Measure-Phase([string]$Name, [scriptblock]$Block) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $Block
  $sw.Stop()
  $script:Timings[$Name] = [math]::Round($sw.Elapsed.TotalSeconds, 1)
}

# --- 1. Locate / validate the control repo (read-only; never modified) --------------
if (-not $RepoRoot) {
  if (-not (Test-GitOk $PSScriptRoot @('rev-parse', '--git-dir'))) {
    throw "cannot locate a Git repository from script location: $PSScriptRoot"
  }
  $RepoRoot = (Invoke-Git $PSScriptRoot @('rev-parse', '--show-toplevel')) | Select-Object -First 1
}
$RepoRoot = [IO.Path]::GetFullPath($RepoRoot)
if (-not (Test-GitOk $RepoRoot @('rev-parse', '--git-dir'))) {
  throw "RepoRoot is not a Git repository: $RepoRoot"
}

if (-not $PackagingWorktree) {
  $PackagingWorktree = Join-Path (Split-Path -Parent $RepoRoot) 'kcc-workbench-wt-package-dev'
}
$PackagingWorktree = [IO.Path]::GetFullPath($PackagingWorktree)

if ((ConvertTo-NormalizedPath $PackagingWorktree) -eq (ConvertTo-NormalizedPath $RepoRoot)) {
  Stop-Packaging 13 'PACKAGING_SCOPE_EXPANSION' "packaging worktree must not be the control repo itself: $PackagingWorktree"
}

$LibPath = Join-Path $PSScriptRoot 'package-dev-lib.mjs'
if (-not (Test-Path $LibPath)) { throw "missing helper: $LibPath" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is required on PATH' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required on PATH' }

Write-Host "control repo : $RepoRoot"
Write-Host "source ref   : $SourceRef"
Write-Host "packaging wt : $PackagingWorktree"

# --- 2. Fetch (never pull) -----------------------------------------------------------
Measure-Phase 'fetch' {
  Write-Host "`n> git fetch origin --prune"
  Invoke-Git $RepoRoot @('fetch', 'origin', '--prune') | Out-Host
}

# --- 3. Resolve and freeze the exact source SHA --------------------------------------
$SourceCommit = (Invoke-Git $RepoRoot @('rev-parse', '--verify', "$SourceRef^{commit}")) | Select-Object -First 1
if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
  Stop-Packaging 12 'PACKAGING_BASELINE_MISMATCH' "could not resolve $SourceRef to a full commit SHA (got: $SourceCommit)"
}
Write-Host "source commit: $SourceCommit  (frozen for this run)"

# --- 4/5/6/7. Packaging worktree lifecycle -------------------------------------------
# $script:worktreeEntry is assigned inside the Measure-Phase scriptblock, which runs
# in a child scope; use script scope so the value survives the block.
$script:worktreeEntry = $null
Measure-Phase 'worktree' {
  $porcelain = (Invoke-Git $RepoRoot @('worktree', 'list', '--porcelain')) -join "`n"
  $json = $porcelain | & node $LibPath parse-worktrees
  if ($LASTEXITCODE -ne 0) { throw "package-dev-lib parse-worktrees failed: $json" }
  # PS 5.1 returns a JSON array as one Object[] (no pipeline enumeration);
  # foreach unwraps it into real elements, and also handles the single-object case.
  $worktrees = @(foreach ($entry in (ConvertFrom-Json -InputObject ([string]$json))) { $entry })
  $wanted = ConvertTo-NormalizedPath $PackagingWorktree
  $script:worktreeEntry = $worktrees | Where-Object { (ConvertTo-NormalizedPath $_.path) -eq $wanted } | Select-Object -First 1

  if ($script:worktreeEntry -and ($script:worktreeEntry.prunable -or -not (Test-Path $PackagingWorktree))) {
    # Stale registration whose directory is gone; prune only removes dead admin
    # entries, never files on disk.
    Write-Host "worktree registration is stale; pruning and re-creating"
    Invoke-Git $RepoRoot @('worktree', 'prune') | Out-Null
    $script:worktreeEntry = $null
  }

  if ($script:worktreeEntry) {
    if ($script:worktreeEntry.branch) {
      Stop-Packaging 11 'PACKAGING_WORKTREE_CONFLICT' "path is registered as branch worktree '$($script:worktreeEntry.branch)', expected a detached packaging worktree: $PackagingWorktree"
    }
    if (-not $script:worktreeEntry.detached) {
      Stop-Packaging 11 'PACKAGING_WORKTREE_CONFLICT' "path is not a detached packaging worktree: $PackagingWorktree"
    }
    $dirty = Invoke-Git $PackagingWorktree @('status', '--porcelain')
    if ($dirty) {
      $listing = ($dirty | Select-Object -First 20) -join "`n"
      Stop-Packaging 10 'PACKAGING_WORKTREE_DIRTY' "packaging worktree has uncommitted changes; refusing to touch it.`n$PackagingWorktree`n$listing"
    }
    if ($script:worktreeEntry.head -ne $SourceCommit) {
      Write-Host "switching clean packaging worktree to $SourceCommit"
      Invoke-Git $PackagingWorktree @('checkout', '--detach', $SourceCommit) | Out-Host
    }
  } else {
    if (Test-Path $PackagingWorktree) {
      Stop-Packaging 11 'PACKAGING_WORKTREE_CONFLICT' "path exists but is not a registered Git worktree: $PackagingWorktree"
    }
    Write-Host "creating packaging worktree (detached at $SourceCommit)"
    Invoke-Git $RepoRoot @('worktree', 'add', '--detach', $PackagingWorktree, $SourceCommit) | Out-Host
  }
}

# Verify the packaging worktree is exactly the frozen SHA, detached and clean.
$wtHead = (Invoke-Git $PackagingWorktree @('rev-parse', 'HEAD')) | Select-Object -First 1
if ($wtHead -ne $SourceCommit) {
  Stop-Packaging 12 'PACKAGING_BASELINE_MISMATCH' "packaging worktree HEAD $wtHead != frozen source SHA $SourceCommit"
}
$wtBranch = (Invoke-Git $PackagingWorktree @('branch', '--show-current')) | Select-Object -First 1
if ($wtBranch) {
  Stop-Packaging 11 'PACKAGING_WORKTREE_CONFLICT' "packaging worktree is on branch '$wtBranch', expected detached HEAD"
}
$wtDirty = Invoke-Git $PackagingWorktree @('status', '--porcelain')
if ($wtDirty) {
  Stop-Packaging 10 'PACKAGING_WORKTREE_DIRTY' "packaging worktree became dirty before build: $PackagingWorktree"
}
Write-Host "worktree HEAD: $wtHead (detached, clean)"

# --- Dependencies: deterministic install from the lockfile ---------------------------
# npm ci remains the default. A validated reuse stamp (#19) may skip it: the stamp is
# written only by a successful npm ci and is matched against a fingerprint of the
# frozen source's package.json AND package-lock.json (SHA-256 each) plus the node/npm
# runtime versions -- so a package.json edit that forgot to sync the lockfile still
# invalidates the stamp and lets npm ci fail closed. A bare "node_modules exists"
# check is never sufficient; -ForceInstall bypasses the stamp.
Measure-Phase 'install' {
  $stampPath = Join-Path $PackagingWorktree 'node_modules\.kcc-dep-stamp'
  $nodeVersion = (& node --version)
  $npmVersion = (& npm --version)
  $fingerprint = (& node $LibPath dep-fingerprint `
    --pkg (Join-Path $PackagingWorktree 'package.json') `
    --lock (Join-Path $PackagingWorktree 'package-lock.json') `
    --node $nodeVersion --npm $npmVersion --os 'win32-x64') | Select-Object -First 1
  if ($LASTEXITCODE -ne 0) { throw "dep-fingerprint failed: $fingerprint" }
  $stamp = if (Test-Path $stampPath) { (Get-Content $stampPath -Raw).Trim() } else { '' }
  if (-not $ForceInstall -and $stamp -eq $fingerprint) {
    Write-Host "`n> reusing node_modules (package.json+package-lock SHA-256 + node/npm runtime fingerprint match; -ForceInstall to override)"
  } else {
    Write-Host "`n> npm ci (deterministic install from package-lock.json)"
    & npm ci --prefix $PackagingWorktree | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
    Set-Content -Path $stampPath -Value $fingerprint -NoNewline -Encoding ascii
  }
}

# --- Tests ----------------------------------------------------------------------------
# Fast mode never runs tests here or in pack.mjs; it is the local iteration path.
if ($SkipTests -or $Fast) {
  Write-Host "`n> skipping npm test$(if ($Fast) { ' (-Fast)' } else { ' (-SkipTests)' })"
  $script:Timings['test'] = 0
} else {
  Measure-Phase 'test' {
    Write-Host "`n> npm test"
    & npm test --prefix $PackagingWorktree | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm test failed (exit $LASTEXITCODE)" }
  }
}

# --- Package via the existing pack.mjs path (test step already handled above) --------
$distDir = Join-Path $PackagingWorktree $(if ($Fast) { 'dist-fast' } else { 'dist' })
Measure-Phase 'pack' {
  if ($Fast) {
    Write-Host "`n> npm run pack -- fast (unpacked local iteration build)"
    & npm run pack --prefix $PackagingWorktree -- fast | Out-Host
  } else {
    Write-Host "`n> npm run pack -- --no-test"
    & npm run pack --prefix $PackagingWorktree -- --no-test | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { throw "npm run pack failed (exit $LASTEXITCODE)" }
}

# --- Build metadata -------------------------------------------------------------------
$buildInfoPath = Join-Path $distDir 'build-info.json'
& node $LibPath build-info --sha $SourceCommit --branch $SourceBranch --pkg (Join-Path $PackagingWorktree 'package.json') --out $buildInfoPath
if ($LASTEXITCODE -ne 0) { throw 'failed to write build-info.json' }

if ($Fast) {
  $artifact = Get-ChildItem -Path (Join-Path $distDir 'win-unpacked') -Filter *.exe -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $artifact) { throw "no exe artifact found under $distDir\win-unpacked" }
} else {
  $artifact = Get-ChildItem -Path $distDir -Recurse -Filter *.zip -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $artifact) { throw "no zip artifact found under $distDir" }
}

$wtHeadAfter = (Invoke-Git $PackagingWorktree @('rev-parse', 'HEAD')) | Select-Object -First 1

$script:RunStart.Stop()
$totalSec = [math]::Round($script:RunStart.Elapsed.TotalSeconds, 1)
$artifactMb = [math]::Round($artifact.Length / 1MB, 1)

Write-Host ''
Write-Host '================ package-dev summary ================'
Write-Host "source      : $SourceBranch @ $SourceCommit"
Write-Host "worktree    : $PackagingWorktree (detached, HEAD $wtHeadAfter)"
Write-Host "mode        : $(if ($Fast) { 'fast (unpacked local iteration)' } else { 'full (zip)' })"
Write-Host "output      : $distDir"
Write-Host "artifact    : $($artifact.Name) ($artifactMb MB)"
Write-Host "build-info  : $buildInfoPath"
$timingText = ($script:Timings.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)s" }) -join ' | '
Write-Host "timings     : $timingText | total ${totalSec}s"
Write-Host '====================================================='
