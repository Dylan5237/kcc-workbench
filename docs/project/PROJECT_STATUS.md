# Project Status — Arckeep / KCC

Updated: 2026-09-09

## Executive status

KCC 1.0 remains the active product/runtime line under the **Arckeep** user-visible identity. Arckeep 2.0 remains reserved/frozen.

Current phase: **5-day real-work dogfood validation — Day 1 ACTIVE**.

Accepted dogfood runtime baseline:
`8a067fa29e32af68634660cfe24797c930a76584`

The repository has later docs-only control-plane commits after the accepted runtime baseline. They do not change runtime behavior and do not require repackaging. The dogfood executable remains pinned to the already smoke-tested `8a067fa...` build.

Execution history:

1. #25 deterministic development packaging — **CLOSED / PASS / MERGED**;
2. #19 startup/development package performance — **CLOSED / PASS / MERGED**;
3. #20 application identity swap to Arckeep — **CLOSED / PASS / MERGED**;
4. #34 Dogfood Quick Capture + Start Menu launcher — **CLOSED / PASS / MERGED / ACTIVATED**;
5. #33 5-day dogfood — **DAY 1 ACTIVE**.

## Dogfood activation

Post-merge activation completed on 2026-09-09.

Accepted dogfood build:
- source branch at build time: `develop/kcc-1.0`;
- source commit: `8a067fa29e32af68634660cfe24797c930a76584`;
- executable: `D:\_projects\tools\kcc-workbench-wt-package-dev\dist-fast\win-unpacked\Arckeep.exe`;
- Start Menu shortcut: current-user `Arckeep.lnk` pointing exactly to that executable;
- final Start Menu launch smoke passed under the real compatibility profile;
- Kimi loaded normally;
- Dogfood note button and icon-only refresh present;
- Dogfood Inbox persisted to `%APPDATA%\KCC Workbench\dogfood\`;
- capture provenance correctly recorded the accepted runtime SHA.

The earlier pre-#34 Day-1 marker is not counted. Day 1 starts from this activation-complete state.

## Dogfood operating rule

Use Arckeep in real daily work. Capture evidence first in Dogfood Inbox:
- `问题`;
- `想法`;
- `正向反馈`.

Do not interrupt dogfood for every observation. Create/fix immediately only for P0/P1, auth/state/data-integrity risks, or recurring friction severe enough to block normal use.

Watch closely:
1. Startup / reopen usability.
2. Kimi ↔ CloudCLI switching without session loss.
3. CloudCLI auth/origin continuity (#18).
4. Viewer passive recording without opening Viewer during work (#23).
5. Viewer realtime delivery (#17).
6. Existing userData/session/window/settings continuity under Arckeep identity (#20).
7. Deterministic update/package loop (#25/#19).
8. Dogfood Inbox must not disrupt Agent surfaces or Viewer recording (#34).

## Long-lived branches

- Stable / release: `main@c7afab44a9933cc9f32a27c26125479a6ff0b735`
- Active KCC 1.0 development: `develop/kcc-1.0`
- Accepted dogfood runtime: `8a067fa29e32af68634660cfe24797c930a76584`
- Reserved Arckeep 2.0 development: `develop/arckeep-2.0@a2b0636c5d0b22855b68d4c8a51d2c4ce646b4e1`

Branch model:
`main <- develop/kcc-1.0 <- feat/k1-* | fix/k1-*`

Parallel Agent work uses one short-lived branch + one dedicated sibling worktree per WorkPackage. Historical dirty local worktrees/branches must not be destructively cleaned.

## Completed KCC 1.0 stabilization

- #17 Viewer realtime event delivery — CLOSED / PASS
- #18 CloudCLI auth/origin continuity — CLOSED / PASS
- #23 Viewer passive recording / session auto-arm — CLOSED / PASS / MERGED
- #25 deterministic development packaging — CLOSED / PASS / MERGED
- #19 startup/development package performance — CLOSED / PASS / MERGED
- #20 Arckeep application identity swap — CLOSED / PASS / MERGED
- #34 Dogfood Quick Capture + Start Menu launcher — CLOSED / PASS / MERGED / ACTIVATED

## Process safety

- destructive mutation of real user auth/profile data requires explicit HUMAN_ACTION approval;
- Agents may terminate only PIDs spawned and explicitly tracked in the current probe;
- pre-existing Arckeep/KCC/Electron/Node/Kimi/CloudCLI/Agent processes and single-instance/profile locks require `HUMAN_ACTION_REQUIRED`;
- no force-kill of unknown/pre-existing process trees.

## Arckeep 2.0

Status: **RESERVED / FROZEN**.

Do not resume D0-05/D0-V or new 2.0 implementation without explicit user decision. The five-day dogfood evidence determines whether deeper architecture work is justified.

## Current execution gate

**#33 / K1-D1 — DAY 1 ACTIVE.**

After five actual usage days, synthesize recurring friction, stable positive paths, workarounds, and product-direction evidence before deciding what happens next.