# D0-04 — Reuse KCC Viewer as Arckeep First-Class Review Surface

Agent Role: Global / Runtime Engineer
Default Harness: KimiCode
Status: **READY**
Architecture / Product Lead: ChatGPT
Parent: GitHub Issue `#7`

## 1. Goal

Reuse the already-proven KCC Viewer as an Arckeep-owned, first-class, cross-agent review surface for D0 Daily Driver.

This task should preserve working Viewer capability rather than redesign or rewrite it.

## 2. Exact implementation baseline

Repository: `Dylan5237/kcc-workbench`

Baseline exact:

`014ab506dcfb6f9efe2154278cec4916cfc2f743`

Expected base branch:

`integration/arckeep-daily-driver`

Expected feature branch:

`feat/d0-04-viewer`

Before work:

1. locate the actual GitHub remote;
2. `git fetch <GH_REMOTE> --prune` — do not `git pull`;
3. create/use a dedicated worktree from exact baseline;
4. verify HEAD equals baseline;
5. do not switch/modify another Agent's worktree.

Mismatch => STOP `BASELINE_MISMATCH`.

## 3. Must-read sources

Read from exact baseline:

- `AGENTS.md`
- `docs/project/GOVERNANCE.md`
- `docs/product/DAILY_DRIVER_D0.md`
- `docs/design/DESIGN_STATUS.md`
- `arckeep/README.md`
- `docs/VIEWER_MODES_DESIGN.md`
- `docs/VIEWER_BENCHMARK.md`
- `src/viewer/server.cjs`
- `src/viewer/diff.cjs`
- `src/viewer/time-machine.cjs`
- `src/viewer/public/**`
- relevant Viewer tests in the KCC v1 tree.

Important current fact: `src/viewer/server.cjs` is a standalone Node HTTP module using Node core APIs and exports `startServer`; it is not inherently an Electron UI component. Treat that as a reuse opportunity, but verify the real lifecycle/auth/startup seam before choosing the host strategy.

## 4. Product invariant

Viewer belongs to Arckeep, not to any one Agent UI.

`Kimi / Claude / DSH / future ATW -> produce work -> Arckeep Viewer -> human review`

Do not make cdesktop or another Agent surface the canonical Arckeep Viewer merely because it has its own Diff panel.

## 5. Required D0 capability

At minimum retain/reuse:

- current project file tree;
- Markdown rendering;
- JSON rendering;
- HTML preview where existing Viewer supports it;
- Diff/review capability;
- project-root / artifact context synchronization with Arckeep.

Time Machine/checkpoint remains a valuable KCC capability, but it may be deferred from the first D0 integration only if preserving it materially blocks the Daily Driver. If deferred, prove that the existing code is not deleted and record the exact follow-up seam.

## 6. Reuse Gate

Before rewriting any Viewer layer, evaluate the narrowest working reuse seam.

Preferred order:

1. Reuse existing `src/viewer/server.cjs` + `src/viewer/public/**` as a local Viewer service and embed its real surface in WebView2.
2. Adapt only the minimum startup/auth/project-root bridge required by the C# Arckeep shell.
3. BUILD/port Viewer logic to C# or a new frontend only if concrete incompatibility evidence shows the existing local service cannot meet D0.

If option 3 appears necessary, STOP `REUSE_GATE_EXCEPTION` and wait for Architecture Review before large rewrite.

## 7. Required proof

### V1 — Standalone Viewer service

Prove the existing Viewer can start outside the Electron product lifecycle, or identify the minimum decoupling required.

Record:
- Node process/service entry;
- localhost/port discovery;
- auth token/cookie setup;
- config directory ownership.

### V2 — Real WebView2 load

Load the real Viewer surface in an Arckeep/WebView2-compatible host.

### V3 — Project-root sync

Selecting/changing the Arckeep project must deterministically set Viewer root to the same intended project without arbitrary filesystem authority expansion.

### V4 — Real content

Prove at least:
- file tree;
- one Markdown document;
- one JSON document;
- one Diff path;
- HTML preview if supported by current Viewer and available in the test project.

### V5 — Isolation / lifecycle

Viewer failure must not crash the Kimi/Claude/DSH work surfaces. Define start/reuse/shutdown semantics for any Viewer sidecar process.

## 8. Authorized changes

Allowed:

- narrow Arckeep C# Viewer service/process/WebView2 bridge;
- minimum additive Viewer startup/export seam if required;
- project-root synchronization;
- Viewer integration tests;
- D0-04 report/evidence under `docs/acceptance/` or `docs/reuse/`.

Preserve existing KCC Viewer behavior unless a narrow compatibility repair is justified by evidence.

## 9. Forbidden

- broad KCC v1 migration/restructure;
- replacement Viewer rewrite without `REUSE_GATE_EXCEPTION`;
- making an Agent UI the Viewer truth owner;
- adopting ATW/workflow state into Viewer;
- DSH/Claude integration;
- broad visual redesign;
- changing the D0 Product Contract;
- expanding Time Machine semantics while only trying to preserve/reuse them.

Need for any forbidden expansion => STOP `ARCHITECTURE_EXCEPTION`.

## 10. Verification

Report:

- exact baseline / HEAD;
- branch/worktree;
- changed files;
- selected reuse seam;
- service/WebView2 evidence;
- project-root sync evidence;
- file/Markdown/JSON/Diff/HTML evidence;
- Viewer auth/process lifecycle behavior;
- KCC Viewer regression tests;
- Arckeep shell build/tests if changed;
- Time Machine preserved/included/deferred status;
- limitations.

Screenshots are not required from the coding Harness. User + ChatGPT own final visual/product acceptance.

## 11. Git / STOP

Do not merge.

Open PR targeting:

`integration/arckeep-daily-driver`

Then STOP for Architecture Review.

Do not start D0-03 or D0-05 from this task.
