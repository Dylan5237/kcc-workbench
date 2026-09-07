# K1-P1 — Viewer Passive Recording / Session Auto-Arm

Parent: #16  
Issue: #23  
Owner role: Global / Runtime Engineer  
Default Harness: KimiCode  
Architecture Review: ChatGPT

## Status

RELEASED

## Exact implementation baseline

The implementation baseline is the commit that contains this taskbook on `develop/kcc-1.0`.

The implementation branch must fast-forward to that exact commit before any code change.

## Branch / worktree

- Branch: `fix/k1-viewer-session-recording`
- Dedicated worktree: `D:\_projects\tools\kcc-workbench-wt-k1-viewer-recording`
- PR target: `develop/kcc-1.0`

## Product contract

**Viewer recording is armed by the active Agent session/project, not by Viewer visibility.**

Opening Viewer is review-only. It must never be the action that starts recording.

The user must be able to:

1. enter or switch to an Agent conversation;
2. work for the entire task without ever opening Viewer;
3. open Viewer only after the task is complete;
4. see the changes already recorded for that conversation.

## Confirmed current facts

At the current KCC 1.0 line:

- Viewer server starts during KCC startup.
- `createBackgroundContextSync()` starts after the main window is created.
- Background sync requests immediately on start and every 3000 ms.
- Kimi navigation/focus events request context sync.
- CloudCLI navigation/focus events request context sync.
- engine switching explicitly awaits `syncViewerConversationContext()`.
- switching to the Viewer tab also explicitly awaits `syncViewerConversationContext()`.
- `syncViewerConversationContext()` only arms the Viewer when a valid `projectDirectory` is detected.
- `viewerServer.setConversationContext(...)` can change the session id/root.
- resetting/changing artifact context snapshots the current documents as the baseline.

Therefore the intended architecture is already background-first, but real dogfood proves the background path is not reliable enough. Viewer activation is acting as a de-facto recovery trigger.

## Do not pre-decide the root cause

Reproduce first and classify the failure mechanically.

At minimum distinguish:

1. **session detection miss** — background sync cannot resolve current session/project until Viewer activation;
2. **SPA transition miss** — session switches without a reliable event/route signal and polling still observes stale context;
3. **detector instability** — route/session id is known but project directory lookup is missing/stale;
4. **late context apply** — correct context is eventually detected, but only after artifacts already exist;
5. **baseline reset loss** — `setConversationContext` / `resetArtifactSession` takes a fresh snapshot that converts already-produced task artifacts into baseline state;
6. **session identity churn** — repeated context ids cause unnecessary session reset/snapshot;
7. another concrete lifecycle defect.

## Mandatory before-fix evidence

Use a real Windows Electron run, not only a server fixture.

Create a small fixture project with unique marker files and use a fresh Agent conversation.

### Case A — never open Viewer

1. start KCC;
2. enter a fresh Kimi conversation for fixture project A;
3. **never open Viewer**;
4. wait long enough to cross multiple background poll intervals;
5. create/modify/delete representative `.md` / `.json` artifacts through the Agent or controlled fixture action;
6. inspect `viewer-context.log`, `/api/root`, `/api/artifacts` and Time Machine state before Viewer activation if possible;
7. only after task completion open Viewer.

Capture:

- Kimi route/session id over time;
- every `context-miss` / `context-applied` timestamp;
- detected session id/project directory;
- when Viewer root changed;
- artifact-session id/startedAt;
- first artifact event timestamp;
- whether opening Viewer causes the first successful context apply.

### Case B — session A -> B without Viewer

1. KCC remains open;
2. session A is armed and produces one marker change;
3. switch to fresh session B;
4. never open Viewer during B;
5. produce B-only marker changes;
6. open Viewer only at the end.

Prove whether background state changed from A to B before B artifacts were produced.

### Case C — CloudCLI where practical

Repeat the same principle for a real CloudCLI session/project if the existing stable auth state allows it without destructive profile actions.

Do not modify/reset real auth/profile data. Any destructive auth/profile action requires `HUMAN_ACTION`.

## Preferred repair principles

Use the narrowest lifecycle seam proven by reproduction.

Preferred direction:

1. make active session/project transition an explicit main-process event/contract;
2. arm Viewer immediately when that transition is positively known;
3. keep the 3-second poll as recovery/fallback, not as the primary correctness mechanism;
4. preserve session/root positive verification;
5. do not require Viewer tab visibility;
6. avoid resetting artifact baseline when the same logical session/root is already armed;
7. if background context arrives late, do not silently erase already-observable task changes by taking a new baseline unless that behavior is explicitly justified.

Possible narrow seams:

- `src/main/viewer-context-sync.js`
- `src/main/main.js`
- existing Kimi/CloudCLI navigation/session detection helpers
- `src/viewer/server.cjs` only if baseline/reset semantics are proven to be part of the defect
- focused test/probe hooks

## Important non-goals

Do not:

- redesign Viewer UI;
- rewrite Time Machine;
- replace `fs.watch`/SSE infrastructure;
- introduce a generalized Agent/session framework;
- touch Arckeep 2.0;
- perform #19 startup/package optimization;
- perform #20 rename/logo work;
- make opening Viewer a required workaround;
- add broad polling intervals as the "fix" without proving why lifecycle events are insufficient.

## Required acceptance

### A. Kimi — zero Viewer activation during work

1. start KCC;
2. enter fresh Kimi session A on project A;
3. never open Viewer;
4. create `a.md`;
5. modify `a.md`;
6. create/modify `b.json`;
7. delete one artifact;
8. only then open Viewer.

PASS only if Viewer already contains the coherent recorded changes from session A.

### B. Kimi session switch

1. while KCC remains open, switch A -> fresh B;
2. never open Viewer during B;
3. produce B-specific artifacts;
4. open Viewer only at the end.

PASS only if B is the active artifact session and B changes are recorded; no empty session and no stale A masquerading as B.

### C. Engine switch

Where real CloudCLI session context is available:

Kimi -> CloudCLI (or reverse), do not open Viewer during the destination session, produce artifact changes, then open Viewer.

PASS only if the destination engine's project/session is already armed and recorded.

### D. Existing realtime behavior

After the correct session is armed:

- MD create/modify/delete remains realtime;
- JSON realtime remains correct;
- Viewer current file refresh remains correct;
- Time Machine regression remains green.

### E. No reload/session destruction

Do not intentionally reload or destroy Kimi/CloudCLI workspaces merely to arm Viewer.

## Deterministic regression coverage

Add focused tests around the actual reproduced defect.

At minimum test the chosen lifecycle contract for:

- background start;
- rapid session transition A -> B;
- repeated sync of same logical session does not reset baseline;
- stale detection result cannot overwrite a newer session if async detection races are possible;
- Viewer visibility is not a prerequisite to context application.

Prefer injected detector/scheduler seams over long sleeps.

## Required commands

Run:

```bash
npm test
npm run build
```

Then run the real Windows acceptance described above.

## Scope STOP conditions

STOP and report before expanding scope if the only viable repair appears to require:

- Kimi Web/CloudCLI upstream patch or fork;
- new generalized session/event framework;
- Time Machine redesign;
- persistent database/schema migration unrelated to the reproduced defect;
- destructive user profile/auth mutation.

Use one of:

- `STOP VIEWER_ARM_UPSTREAM_LIMIT`
- `STOP VIEWER_ARM_SCOPE_EXPANSION`
- `HUMAN_ACTION_REQUIRED`

## Delivery

Commit and push `fix/k1-viewer-session-recording` and open a PR to `develop/kcc-1.0`.

Report:

- exact implementation baseline;
- exact HEAD;
- before-fix reproduction timeline;
- confirmed root cause;
- changed files;
- final session-arm lifecycle;
- Case A evidence;
- Case B evidence;
- Case C evidence or exact reason it was not applicable;
- evidence that Viewer was never opened during the work phase;
- artifact-session/root timestamps;
- realtime regression;
- `npm test` result;
- `npm run build` result;
- limitations.

Do not merge. Do not start #19 or #20. STOP for ChatGPT Architecture Review.
