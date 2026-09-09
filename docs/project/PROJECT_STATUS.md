# Project Status — Arckeep / KCC

Updated: 2026-09-09

## Executive status

KCC 1.0 remains the active product/runtime line. Arckeep 2.0 remains reserved/frozen.

Current phase: **KCC 1.0 stabilization before 5-day dogfood**.

Frozen execution order:

1. #25 deterministic development packaging — **CLOSED / PASS / MERGED**;
2. #19 startup/development package performance — **CLOSED / PASS / MERGED**;
3. #20 application identity swap to Arckeep — **RELEASED**;
4. 5-day dogfood — NOT STARTED.

Do not begin dogfood or resume Arckeep 2.0 until #20 is reviewed/merged unless the user explicitly changes sequence.

## Long-lived branches

- Stable / release: `main@c7afab44a9933cc9f32a27c26125479a6ff0b735`
- Active KCC 1.0 development: `develop/kcc-1.0`
- Reserved Arckeep 2.0 development: `develop/arckeep-2.0@a2b0636c5d0b22855b68d4c8a51d2c4ce646b4e1`

Branch model:
`main <- develop/kcc-1.0 <- feat/k1-* | fix/k1-*`

Parallel Agent work uses one short-lived branch + one dedicated sibling worktree per WorkPackage. Historical dirty local worktrees must not be destructively cleaned.

## Completed KCC 1.0 stabilization

### #17 Viewer realtime event delivery — CLOSED / PASS

Accepted behavior:
- MD / JSON artifact changes propagate in realtime;
- watcher and polling fallback share coherent change delivery.

### #18 CloudCLI auth/origin continuity — CLOSED / PASS

Accepted behavior:
- stable legitimate CloudCLI endpoint/origin reuse across normal KCC restarts;
- no false attach to unrelated listeners;
- existing local Claude/provider state remains reused.

Known upstream limitation: CloudCLI local JWT retains its own expiry semantics.

### #23 Viewer passive recording / session auto-arm — CLOSED / PASS / MERGED

Reviewed HEAD:
`e2624fa5cd18b5f4ad3bb140f66fc6a34471d090`

Merge SHA:
`48f435af797329d62fe552d5876e27bacd112465`

Accepted contract:

> Viewer recording is armed by the active Agent session/project, not Viewer visibility. Opening Viewer is review-only.

### #25 Deterministic development packaging — CLOSED / PASS / MERGED

Reviewed R1 HEAD:
`e50e82af2c52434afa6984976224f4f33128f32d`

Merge SHA:
`a6e0994362d9cc30919e0124ce2b42f391b7a83c`

Accepted contract:
- source fixed to exact fetched `origin/develop/kcc-1.0`;
- dedicated detached packaging worktree;
- dirty/conflicting packaging worktree fails closed;
- exact build provenance via `build-info.json`.

### #19 Startup & development package performance — CLOSED / PASS / MERGED

Reviewed R1 HEAD:
`1717714d833740a8edee6371b136521f73fac6a3`

Merge SHA:
`efaee29b81eadc97812d4bc75b505a85f2dc8efb`

Accepted results:
- startup median 708ms -> 622ms (-86ms / -12.1%); larger stored Viewer roots benefit more because initial snapshot/watcher no longer blocks shell creation;
- deterministic fast local iteration path 278.5s -> 153.4–196.1s (-45% / -30%);
- full zip path remains available and is not falsely claimed as optimized;
- dependency reuse fingerprint covers `package.json` + `package-lock.json` + Node/npm/platform and fails closed on manifest-only drift;
- real fresh Kimi session E2E passed after the startup-order change with Viewer never opened during work and artifact changes already present before first inspection.

Process safety rule from #19:
- Agents may terminate only PIDs spawned and explicitly tracked in the current probe;
- pre-existing KCC/Electron/Node/Kimi/CloudCLI/Agent processes and single-instance/profile locks require `HUMAN_ACTION_REQUIRED`.

## Active WorkPackage — #20 / K1-S0.5

### Arckeep application identity swap — RELEASED

Frozen taskbook:
`docs/tasks/kimicode/K1-S0.5-arckeep-identity.md`

Implementation branch:
`feat/k1-arckeep-identity`

Dedicated worktree:
`D:\_projects\tools\kcc-workbench-wt-k1-identity`

PR target:
`develop/kcc-1.0`

Product contract:
- keep the accepted KCC 1.0 Electron runtime/product shape;
- replace user-visible application identity with `Arckeep`;
- use the accepted repository Arckeep icon assets;
- do not redesign layout/colors/navigation;
- preserve Kimi / CloudCLI / Viewer behavior;
- preserve the **exact existing production KCC userData path** as an internal compatibility path rather than silently starting an empty Arckeep profile;
- do not perform a live-profile copy/move migration unless architecture review explicitly approves it.

Accepted Arckeep source assets:
- `arckeep/shell/assets/app-icon.png`
- `arckeep/shell/assets/app.ico`

Important stable internal identifiers unless proven necessary to change:
- repository/npm package name `kcc-workbench`;
- branch taxonomy `k1-*`;
- diagnostic names such as `KCC_PROFILE_STARTUP`;
- existing `appId` if not required for visible identity;
- legacy KCC userData directory name/path as compatibility storage.

## Repository normalization

Remote repository is organized around:
- `main`
- `develop/kcc-1.0`
- `develop/arckeep-2.0`

Legacy development refs are retired as baselines. Local historical worktrees/branches may remain where user changes exist and must not be destructively cleaned.

## Arckeep 2.0

Status: **RESERVED / FROZEN**.

The C# + WebView2 line remains preserved as architecture evidence but is not the active product line. Do not resume D0-05/D0-V or new 2.0 implementation without explicit user decision.

## Next gate

### 5-day dogfood — NOT STARTED

Begin only after #20 passes Architecture Review and the identity/user-state human gate. Then use the stabilized KCC 1.0 runtime under the Arckeep identity in real work for five days and record recurring friction before deciding whether to continue KCC 1.x evolution, resume Arckeep 2.0, or stop.

## Stabilization exit gate

Dogfood may begin only when:
- no known P0 blocker remains;
- Viewer passive recording remains proven in normal use;
- deterministic development packaging is available;
- startup/update loop is materially usable;
- Arckeep identity is correct without losing existing user state;
- Kimi / CloudCLI / Viewer switching and persistence work without debugging the shell.

## Current execution gate

**#20 / K1-S0.5 RELEASED.**

Do not begin 5-day dogfood or Arckeep 2.0 work until #20 is reviewed/merged.