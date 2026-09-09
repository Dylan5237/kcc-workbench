# Project Status — Arckeep / KCC

Updated: 2026-09-09

## Executive status

KCC 1.0 remains the active product/runtime line under the **Arckeep** user-visible identity. Arckeep 2.0 remains reserved/frozen.

Current phase: **pre-dogfood tooling insert before 5-day real-work validation**.

Execution order:

1. #25 deterministic development packaging — **CLOSED / PASS / MERGED**;
2. #19 startup/development package performance — **CLOSED / PASS / MERGED**;
3. #20 application identity swap to Arckeep — **CLOSED / PASS / MERGED**;
4. #34 Dogfood Quick Capture + Start Menu launcher — **RELEASED / ACTIVE**;
5. #33 5-day dogfood — **PAUSED BEFORE DAY 1**.

Do not count the five-day dogfood window until #34 is reviewed/merged, a deterministic merged Arckeep dogfood build exists, and the Start Menu shortcut points at that stable build.

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
- startup median 708ms -> 622ms (-86ms / -12.1%);
- deterministic fast local iteration 278.5s -> 153.4–196.1s (-45% / -30%);
- full zip path remains available;
- dependency reuse fingerprint covers `package.json` + `package-lock.json` + Node/npm/platform;
- real fresh Kimi session E2E passed after the startup-order change with Viewer never opened during work.

### #20 Arckeep application identity swap — CLOSED / PASS / MERGED

Reviewed R1 HEAD:
`efc550584cf34cbfb9460c51a12dec280f5b2c81`

Merge SHA:
`db8b3cf320be1407eb417313b6e2744f85410af2`

Accepted:
- user-visible identity is Arckeep;
- accepted Arckeep icon is used;
- stable `appId` and `%APPDATA%\\KCC Workbench` userData compatibility path remain internal identifiers;
- explicit `--user-data-dir` isolation takes precedence over the normal compatibility pin;
- Kimi / CloudCLI / Viewer state continuity preserved;
- Human Visual Gate passed on 2026-09-09: Arckeep name/icon correct, no residual primary KCC branding, no layout redesign.

## Active WorkPackage — #34 / K1-D0

### Dogfood Quick Capture + Start Menu launcher — RELEASED

Frozen taskbook:
`docs/tasks/kimicode/K1-D0-dogfood-quick-capture.md`

Implementation branch:
`feat/k1-dogfood-quick-capture`

Dedicated worktree:
`D:\\_projects\\tools\\kcc-workbench-wt-k1-dogfood-capture`

PR target:
`develop/kcc-1.0`

Product contract:
- titlebar restart action becomes refresh-icon-only;
- a global note button opens a lightweight right-side Dogfood Inbox without reloading the active Agent surface;
- capture types are `问题` / `想法` / `正向反馈` with Markdown-friendly text;
- records persist locally under `<userData>/dogfood/` and capture timestamp + best-effort runtime/build context;
- `Ctrl+Shift+N` opens/focuses capture from primary workspaces;
- no GitHub sync, AI classification, task system, rich-text editor or shell redesign;
- add a user-level Start Menu shortcut helper, but the real shortcut must only be installed after merge and must target the deterministic merged packaging-worktree build, never the feature worktree.

## 5-day dogfood — #33

Status: **PAUSED BEFORE DAY 1**.

The previously created Day-1 marker is not counted. Restart Day 1 only after #34 passes Architecture Review, merges, deterministic `develop/kcc-1.0` packaging succeeds, and the real Start Menu shortcut points to that merged Arckeep build.

During dogfood, record friction first and only interrupt for P0/P1 or integrity-risk defects.

## Process safety

- destructive mutation of real user auth/profile data requires explicit HUMAN_ACTION approval;
- Agents may terminate only PIDs spawned and explicitly tracked in the current probe;
- pre-existing Arckeep/KCC/Electron/Node/Kimi/CloudCLI/Agent processes and single-instance/profile locks require `HUMAN_ACTION_REQUIRED`;
- no force-kill of unknown/pre-existing process trees.

## Repository normalization

Remote repository is organized around:
- `main`
- `develop/kcc-1.0`
- `develop/arckeep-2.0`

Legacy development refs are retired as baselines. Local historical worktrees/branches may remain where user changes exist and must not be destructively cleaned.

## Arckeep 2.0

Status: **RESERVED / FROZEN**.

The C# + WebView2 line remains preserved as architecture evidence but is not the active product line. Do not resume D0-05/D0-V or new 2.0 implementation without explicit user decision.

## Current execution gate

**#34 / K1-D0 RELEASED.**

Do not begin the five-day dogfood clock or Arckeep 2.0 work until #34 is reviewed/merged and post-merge deterministic launcher activation is complete.