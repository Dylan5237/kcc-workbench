# Deterministic Development Packaging (K1-S0.3 / #25)

Development packages must be reproducible against one unambiguous source: the exact
fetched `origin/develop/kcc-1.0` SHA. Whichever branch, worktree, or uncommitted
state the user (or a parallel agent) currently has open must never influence the
result.

## Usage

```powershell
powershell -NoProfile -File scripts/package-dev.ps1
```

Optional parameters:

- `-RepoRoot <path>` — control repo used as the Git entry point (default: the repo
  containing the script). Its branch and working tree are never modified.
- `-PackagingWorktree <path>` — default: sibling of the control repo named
  `kcc-workbench-wt-package-dev`.
- `-SkipTests` — skip `npm test` before packaging (not recommended).

The development source is **not** a parameter. It is hardcoded to
`origin/develop/kcc-1.0` (metadata branch `develop/kcc-1.0`) so a caller can never
package a feature ref while labeling it as develop. Future release packaging will
ship as a separate `package-release.ps1` rather than a generic source override here.

Likewise there is no install skip: `npm ci` runs unconditionally on every run,
because an existing `node_modules` cannot prove it matches the frozen SHA's
lockfile. A source/lockfile-aware validated cache is #19 scope.

## Architecture

`scripts/package-dev.ps1` is an orchestration/control wrapper around the existing
build path, not a new packager. Per run it:

1. locates/validates the control repo without touching its checkout;
2. runs `git fetch origin --prune` (never `git pull`);
3. resolves `origin/develop/kcc-1.0` to an exact SHA and freezes it for the run
   (if develop advances mid-build, this run still packages the frozen SHA);
4. prepares the dedicated packaging worktree (see lifecycle below), detached at the
   frozen SHA;
5. runs `npm ci` (deterministic lockfile install), `npm test`, and
   `npm run pack -- --no-test` (reuses `scripts/pack.mjs` / electron-builder zip);
6. writes `dist/build-info.json` next to the artifact and prints a summary with
   per-phase timings.

Pure, testable logic (worktree porcelain parsing, SHA validation, build-info
construction) lives in `scripts/package-dev-lib.mjs` and is covered by
`test/package-dev-lib.test.js`.

## Packaging worktree lifecycle

Default path: `D:\_projects\tools\kcc-workbench-wt-package-dev` (sibling of the
control repo). It is always a **detached HEAD** worktree at the frozen source SHA —
never a feature branch.

- Not registered + path absent → `git worktree add --detach <path> <sha>`.
- Registered, detached, clean, same SHA → reuse as-is.
- Registered, detached, clean, older SHA → `git checkout --detach <sha>` (safe
  because cleanliness was verified first).
- Registered but stale (directory gone) → `git worktree prune` (removes only dead
  admin entries) then re-add.
- Registered but **dirty** → `STOP PACKAGING_WORKTREE_DIRTY` (exit 10). The script
  never resets/cleans/stashes it; the marker files stay exactly as they were.
- Registered but on a branch, or path exists without being the expected Git
  worktree → `STOP PACKAGING_WORKTREE_CONFLICT` (exit 11).

## Build metadata

`dist/build-info.json`, adjacent to the zip artifact:

```json
{
  "sourceBranch": "develop/kcc-1.0",
  "sourceCommit": "<40-char SHA>",
  "sourceCommitShort": "<short SHA>",
  "version": "<package version>",
  "mode": "development",
  "builtAt": "<ISO-8601>"
}
```

No usernames, machine paths, tokens, or auth state are recorded. A bug report can
always name the exact build as `develop/kcc-1.0 @ <sourceCommitShort>`.

## Stop conditions

| Exit | Token | Meaning |
| ---- | ----- | ------- |
| 10 | `STOP PACKAGING_WORKTREE_DIRTY` | packaging worktree has uncommitted changes |
| 11 | `STOP PACKAGING_WORKTREE_CONFLICT` | path is not the expected detached packaging worktree |
| 12 | `STOP PACKAGING_BASELINE_MISMATCH` | source ref did not resolve to a full SHA, or worktree HEAD drifted |
| 13 | `STOP PACKAGING_SCOPE_EXPANSION` | packaging worktree points at the control repo itself |
| 1 | (generic) | fetch/install/test/build failure |

The script never silently repairs user Git state.

## Performance boundary (#19)

Per-phase timings (`fetch`, `worktree`, `install`, `test`, `pack`, `total`) are
printed on every run as measurement input for #19. No install caching, dependency
pruning, `asarUnpack` changes, or package-size optimization is done here —
correctness comes first; #19 owns optimization.

## Future release packaging (contract only, not implemented)

- development package source = `origin/develop/kcc-1.0` (this script);
- release package source = `main` or an explicit release tag (future
  `package-release.ps1`);
- both reuse the same mechanics: isolated detached worktree, exact frozen SHA,
  lockfile install, adjacent build metadata.
