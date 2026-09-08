# Project Status — Arckeep / KCC

Updated: 2026-09-08

## Executive status

KCC 1.0 is the active product line. Arckeep 2.0 is reserved/frozen.

Current phase: **KCC 1.0 stabilization before 5-day dogfood**.

No new implementation task is released automatically after this status update.

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

Accepted mechanisms:
- all Viewer context sync paths serialize through one session-arm queue;
- stale async detection results cannot overwrite a newer Agent session;
- Kimi recording follows positively identified route session context;
- Kimi / CloudCLI context probes have bounded timeout behavior;
- same logical session/root re-sync does not reset the artifact baseline;
- real Windows acceptance passed with Viewer never opened during the work phase.

Known acceptance limitation:
- signed-in CloudCLI UI route-API detection was not exercised in the isolated test profile; CloudCLI fallback end-to-end passed. This remains a normal user smoke item, not a merge blocker.

## Repository normalization

Remote repository has been normalized around three long-lived branches:

- `main`
- `develop/kcc-1.0`
- `develop/arckeep-2.0`

Legacy development refs such as `feature/viewer-modes`, `integration/arckeep-daily-driver`, completed D0 branches and completed K1 fix branches are retired as development baselines.

Local historical worktrees/branches may still exist and must not be destructively cleaned while they contain user changes. They are not valid baselines for new work.

## Arckeep 2.0

Status: **RESERVED / FROZEN**.

The 2.0 line preserves the latest C# + WebView2 architecture candidate and associated evidence, but product development is paused. Do not resume D0-05/D0-V or new 2.0 implementation without explicit user decision.

Product-level conclusion from dogfood so far:
- KCC 1.0 Electron shell currently provides better day-to-day usability;
- 2.0 architecture work produced useful runtime contracts, but its incremental product value has not yet justified continued engineering investment.

## Remaining KCC 1.0 backlog

Not released:

1. `#19` Startup / package performance
   - measure startup critical path;
   - reduce unnecessary eager work;
   - improve update/build turnaround based on evidence.

2. `#20` Application identity swap
   - change KCC Workbench identity to Arckeep;
   - use Arckeep name/logo without losing existing local sessions/settings/auth state.

3. Development packaging workflow
   - development packages must be built from exact `origin/develop/kcc-1.0`;
   - build in a dedicated packaging worktree;
   - embed source branch/commit in build metadata;
   - release packages come from `main` or an explicit release tag.

4. 5-day dogfood
   - begin only after stabilization exit gate is satisfied;
   - use KCC 1.0 in real work and record only actual recurring friction;
   - use evidence to decide whether to continue KCC 1.x evolution, resume Arckeep 2.0, or stop the broader project.

## Stabilization exit gate

KCC 1.0 is dogfood-ready only when:

- no known P0 blocker remains;
- #23 passive Viewer recording passes normal user smoke;
- startup/update loop is materially usable or has a measured stable workaround;
- identity swap, if still desired, preserves existing user state;
- Kimi / CloudCLI / Viewer switching and persistence work without debugging the shell.

## Current decision gate

**PAUSED FOR PM / USER SEQUENCING DECISION.**

Do not automatically release #19, #20, packaging work, or Arckeep 2.0 work. The next WorkPackage must be selected explicitly.