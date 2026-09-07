# Repository Branching Model

Status: **FROZEN — 2026-09-07**

This repository uses a small three-level branch model optimized for multiple local AI Agents working in parallel.

## 1. Long-lived branches

### `main`

Stable / releasable line.

Rules:
- no direct feature development;
- no Agent works directly on `main`;
- promotion to `main` happens only from an accepted development line after review;
- release packages come from `main` or an explicit release tag.

### `develop/kcc-1.0`

Active KCC 1.0 optimization and stabilization line.

Rules:
- this is the default baseline for current product work;
- every KCC 1.0 feature/fix branch starts from the exact current HEAD of `develop/kcc-1.0`;
- accepted PRs merge back to `develop/kcc-1.0`;
- daily/dogfood packaging must use this branch, never an arbitrary working branch;
- direct feature coding on this branch is forbidden except narrow repository-control/documentation commits approved by the project lead.

### `develop/arckeep-2.0`

Reserved Arckeep 2.0 line.

Rules:
- currently frozen / reserved;
- no normal feature work is released from this branch until the product-value decision explicitly resumes 2.0;
- the branch preserves the latest 2.0 candidate work, but it is not a release/stable claim;
- when 2.0 resumes, new 2.0 feature branches must start from the exact then-current HEAD of this branch.

## 2. Short-lived feature/fix branches

KCC 1.0 work:

- `feat/k1-<module>-<slug>`
- `fix/k1-<module>-<slug>`

Arckeep 2.0 work, only after explicit resume:

- `feat/a2-<module>-<slug>`
- `fix/a2-<module>-<slug>`

Rules:
- one WorkPackage = one branch = one dedicated worktree = one primary Agent execution thread;
- feature/fix branches are created from an exact development-branch SHA, never from `main` and never from another feature branch;
- `git fetch <remote> --prune`; do not `git pull` inside execution worktrees;
- PR target is the corresponding development branch;
- merge only after Architecture Review / acceptance;
- delete the short-lived remote branch after merge/closure;
- parallel Agents must use sibling worktrees and must not share one writable worktree.

## 3. Packaging contract

Development package:

`origin/develop/kcc-1.0 -> dedicated packaging worktree -> build/package`

Release package:

`main` or an explicit release tag -> dedicated packaging worktree -> build/package

The packaging script must not switch/reset/pull the user's current worktree. It should fetch the target ref, resolve an exact SHA, prepare a dedicated packaging worktree, and embed branch + commit SHA in the produced build metadata/artifact name.

## 4. 2026-09-07 normalization sources

KCC 1.0 accepted source before normalization:

`feature/viewer-modes@14bd171f80950a660bc9323e10b933619a821dcf`

Arckeep 2.0 retained candidate source before normalization:

`fix/d0-03-r3-surface-composition@a701525a58fb77fc33d1d5da420029475b0d979f`

Important 2.0 status:
- R3 code had Architecture PASS;
- the former H8 human-visible acceptance gate was not completed before 2.0 was paused;
- retaining that code in `develop/arckeep-2.0` is archival/development continuity, not a release acceptance claim.

## 5. Legacy branch retirement

After the two development branches are verified, the following old refs are retired and should not be used as baselines:

- `feature/viewer-modes`
- `integration/arckeep-daily-driver`
- `feat/d0-01-claude-surface`
- `feat/d0-02-dsh-integration`
- `feat/d0-03-persistent-solo-shell`
- `feat/d0-04-viewer`
- `fix/d0-03-r3-surface-composition`
- `fix/k1-s0-1-viewer-realtime`
- `fix/k1-s0-2-cloudcli-auth`
- `tmp/noop` (accidental temporary ref created during repository normalization)

Exact historical commits remain documented in issues/PRs. These branch names must not be reused for new development.
