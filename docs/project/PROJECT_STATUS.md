# Project Status — Arckeep / KCC

Updated: 2026-09-08

## Executive status

KCC 1.0 is the active product line. Arckeep 2.0 is reserved/frozen.

Current phase: **KCC 1.0 stabilization before 5-day dogfood**.

Frozen execution order:

1. #25 deterministic development packaging — **CLOSED / PASS / MERGED**;
2. #19 startup/development package performance — **RELEASED**;
3. #20 application identity swap to Arckeep — NOT RELEASED;
4. 5-day dogfood — NOT STARTED.

Do not start #20 or dogfood until #19 is reviewed/merged unless the user explicitly changes sequence.

## Long-lived branches

- Stable / release: `main@c7afab44a9933cc9f32a27c26125479a6ff0b735`
- Active KCC 1.0 development: `develop/kcc-1.0`
- Reserved Arckeep 2.0 development: `develop/arckeep-2.0@a2b0636c5d0b22855b68d4c8a51d2c4ce646b4e1`

Branch model:
`main <- develop/kcc-1.0 <- feat/k1-* | fix/k1-*`

Parallel Agent work uses one short-lived branch + one dedicated sibling worktree per WorkPackage. Short-lived branches are deleted after merge/closure.

## Completed KCC 1.0 stabilization

### #17 Viewer realtime event delivery — CLOSED / PASS

Accepted behavior:
- MD / JSON artifact changes propagate in realtime;
- file tree refresh and active preview refresh from Viewer change events;
- watcher and polling fallback share coherent change delivery.

### #18 CloudCLI auth/origin continuity — CLOSED / PASS

Accepted behavior:
- CloudCLI legitimate local auth state persists across normal KCC restarts;
- KCC positively identifies and reuses an existing compatible CloudCLI endpoint;
- KCC does not attach to an unrelated listener merely because a port is open;
- Claude provider auth continues to reuse the user's existing local Claude state.

Known upstream limitation: CloudCLI local JWT still has its own expiry semantics.

### #23 Viewer passive recording / session auto-arm — CLOSED / PASS / MERGED

Reviewed implementation HEAD:
`e2624fa5cd18b5f4ad3bb140f66fc6a34471d090`

Merge SHA:
`48f435af797329d62fe552d5876e27bacd112465`

Accepted product contract:

> Viewer recording is armed by the active Agent session/project, not by Viewer visibility. Opening Viewer is review-only.

Known acceptance limitation:
- signed-in CloudCLI UI route-API detection was not exercised in the isolated test profile; CloudCLI fallback end-to-end passed. This remains a normal user smoke item, not a merge blocker.

### #25 Deterministic development packaging — CLOSED / PASS / MERGED

Reviewed R1 HEAD:
`e50e82af2c52434afa6984976224f4f33128f32d`

Merge SHA:
`a6e0994362d9cc30919e0124ce2b42f391b7a83c`

Accepted contract:
- development source is mechanically fixed to exact fetched `origin/develop/kcc-1.0`;
- build runs in a dedicated detached packaging worktree;
- user/Agent control and feature worktrees are not mutated or used as package source;
- dirty/conflicting packaging worktree fails closed;
- `npm ci` is unconditional until a later source/lockfile-aware cache is proven;
- adjacent `build-info.json` records exact source SHA/version/time/mode.

Captured performance baseline for #19:
- total package run: ~334–418s;
- `npm ci`: ~28–62s;
- tests: ~13–20s;
- pack/electron-builder + zip: ~290–338s (dominant);
- zip: ~416.3 MB.

## Active WorkPackage — #19 / K1-S0.4

### Startup & development package performance — RELEASED

Frozen taskbook:
`docs/tasks/kimicode/K1-S0.4-performance-stabilization.md`

Implementation branch:
`fix/k1-startup-package-performance`

Dedicated worktree:
`D:\_projects\tools\kcc-workbench-wt-k1-performance`

PR target:
`develop/kcc-1.0`

Execution discipline:
- measure real Windows startup and package phases before changing behavior;
- classify dominant causes mechanically;
- implement only measured low-risk wins;
- preserve #25 deterministic provenance;
- preserve #17 realtime Viewer, #18 CloudCLI auth/origin continuity, and #23 passive Viewer recording.

Current startup hypothesis to test:
- `app.whenReady()` awaits Viewer server startup before `createMainWindow()`;
- Viewer server startup currently waits for initial watcher/snapshot of the stored root;
- this work may be blocking first-shell visibility.

Current packaging hypothesis to test:
- the ~290–338s `pack` stage is the dominant cost;
- existing unpacked fast mode and zip/staging composition should be measured before any dependency/package pruning.

## Repository normalization

Remote repository is organized around three long-lived lines:

- `main`
- `develop/kcc-1.0`
- `develop/arckeep-2.0`

Legacy development refs are retired as baselines. Local historical worktrees/branches may remain where user changes exist and must not be destructively cleaned.

## Arckeep 2.0

Status: **RESERVED / FROZEN**.

The 2.0 line preserves the latest C# + WebView2 architecture candidate and associated evidence, but product development is paused.

Current product judgement: KCC 1.0 Electron shell is the better day-to-day baseline. Do not resume D0-05/D0-V or new 2.0 implementation without explicit user decision.

## Next gates

### #20 Application identity swap — NOT RELEASED

After #19:
- change KCC Workbench identity to Arckeep;
- use Arckeep name/logo;
- preserve existing sessions/settings/auth/user state across the identity transition.

### 5-day dogfood — NOT STARTED

Begin only after stabilization exit gate is satisfied. Use KCC 1.0 in real work, record recurring friction, then decide whether to continue KCC 1.x evolution, resume Arckeep 2.0, or stop the broader project.

## Stabilization exit gate

KCC 1.0 is dogfood-ready only when:

- no known P0 blocker remains;
- #23 passive Viewer recording passes normal user smoke;
- deterministic development packaging is available;
- startup/update loop is materially usable or has a measured stable workaround;
- identity swap preserves existing user state;
- Kimi / CloudCLI / Viewer switching and persistence work without debugging the shell.

## Current execution gate

**#19 / K1-S0.4 RELEASED.**

Do not start #20, dogfood, or Arckeep 2.0 until #19 is reviewed/merged.