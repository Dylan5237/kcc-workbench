# D0-02 — DSH Native Workspace Integration Spike

Agent Role: DSH Native Specialist
Default Harness: DSH Creator Mode
Status: **READY**
Architecture / Product Lead: ChatGPT
Parent: GitHub Issue `#5`

## 1. Goal

Prove the narrowest supported way to integrate DSH as a real, persistent Daily Driver workspace surface inside Arckeep.

This DSH surface is for the user to directly work in a Harness workspace. It is **not** ATW Team Mode and must not add workflow authority to Arckeep.

## 2. Exact implementation baseline

Repository: `Dylan5237/kcc-workbench`

Baseline exact:

`014ab506dcfb6f9efe2154278cec4916cfc2f743`

Expected base branch:

`integration/arckeep-daily-driver`

Expected feature branch:

`feat/d0-02-dsh-integration`

Before work:

1. locate the actual GitHub remote;
2. `git fetch <GH_REMOTE> --prune` — do not `git pull`;
3. create/use a dedicated worktree from exact baseline;
4. verify worktree HEAD equals baseline;
5. do not switch/modify another Agent's worktree.

Mismatch => STOP `BASELINE_MISMATCH`.

## 3. Must-read sources

Read from exact baseline:

- `AGENTS.md`
- `docs/project/GOVERNANCE.md`
- `docs/project/HARNESS_TEAM.md`
- `docs/product/DAILY_DRIVER_D0.md`
- `docs/design/DESIGN_STATUS.md`
- `arckeep/README.md`

Reuse evidence/patterns from the already proven DSH integrations in:

- `Dylan5237/req-to-page`
- `Dylan5237/agent-team-workbench`

Inspect the installed/current DSH runtime using Creator Mode before inventing any host seam.

## 4. Required proof

### D1 — Native start / attach seam

Identify the narrowest supported DSH local start or attach path for the installed DSH version.

Record:
- exact DSH version;
- command/process path;
- host/port discovery;
- whether Arckeep should start DSH or attach to an existing instance.

Prefer reuse of official/native behavior over custom process protocol.

### D2 — Health / readiness

Identify a deterministic readiness signal suitable for Arckeep.

Do not infer readiness from arbitrary sleep timers if a supported health/service signal exists.

### D3 — Real Web surface

Prove the actual DSH Web workspace can be loaded in an Arckeep/WebView2-compatible localhost surface.

Do not build a substitute DSH UI.

### D4 — Persistence across switching

Prove normal Arckeep hide/show or workspace switching can keep the DSH surface alive without intentional reload/session loss.

### D5 — Failure isolation

If DSH is unavailable or fails startup:

- Kimi/Claude/Viewer must remain conceptually usable;
- return a controlled product-level status;
- diagnostics may exist secondarily but must not dominate the user surface.

### D6 — Process ownership

If Arckeep starts DSH, define exact shutdown/attach/reuse semantics to avoid orphan processes and accidental termination of a user-owned existing DSH instance.

## 5. Architecture boundaries

- DSH remains the Harness/runtime workspace owner.
- Arckeep owns only shell/navigation/project context and process embedding/attachment as needed.
- No DSH core patch.
- No second workflow/state truth.
- No ATW collaboration semantics in D0-02.

## 6. Authorized changes

Preferred outcome is evidence with minimal production change.

Allowed:

- narrow DSH probe/integration glue required to establish the seam;
- minimal C# process/WebView2 host proof;
- D0-02 report/evidence under `docs/acceptance/` or `docs/reuse/`.

## 7. Forbidden

- DSH core modification
- ATW Team Mode integration
- generalized HarnessAdapter/Runtime Registry
- Arckeep workflow controller
- Kimi/Claude changes
- Viewer migration
- full visual redesign
- changing D0 Product Contract

Need for any above => STOP `ARCHITECTURE_EXCEPTION`.

## 8. Verification

Report:

- exact baseline / HEAD;
- branch/worktree;
- exact DSH version;
- native seam inspected;
- launch/attach/readiness evidence;
- real WebView2 surface evidence;
- persistence/switching evidence;
- failure isolation behavior;
- process ownership/shutdown semantics;
- changed files;
- tests/build if code changed;
- limitations.

Screenshots are not required from the Harness. Ask the user if visual evidence is needed.

## 9. Git / STOP

Do not merge.

Open PR targeting:

`integration/arckeep-daily-driver`

Then STOP for Architecture Review.

Do not start D0-03 and do not implement ATW Team Mode.
