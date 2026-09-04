# D0-01 — Claude Visual Surface Reuse Gate

Agent Role: Backend / Integration Engineer
Default Harness: Claude Code
Status: **READY**
Architecture / Product Lead: ChatGPT
Parent: GitHub Issue `#4`

## 1. Goal

Select and prove the shortest reliable Claude Code visual workspace for Arckeep Daily Driver.

Primary candidate: `cdesktop`

Fallback: the existing KCC v1 CloudCLI integration already proven in this repository.

This is a reuse gate, not a custom Claude UI task.

## 2. Exact implementation baseline

Repository: `Dylan5237/kcc-workbench`

Baseline exact:

`014ab506dcfb6f9efe2154278cec4916cfc2f743`

Expected base branch:

`integration/arckeep-daily-driver`

Expected feature branch:

`feat/d0-01-claude-surface`

Dedicated sibling worktree convention:

`../kcc-workbench-wt-d0-01`

The user may start this Agent session by selecting the normal shared `kcc-workbench` folder. That selected folder is only the **entry/control repository**. The Agent must create/reuse its own dedicated sibling worktree and move execution cwd there before any implementation.

Frozen worktree bootstrap rules:

`f9eab08d0f3b019b411c4d0418b9122295860657:docs/project/WORKTREE_EXECUTION.md`

Read them with exact-ref inspection, e.g. `git show f9eab08d0f3b019b411c4d0418b9122295860657:docs/project/WORKTREE_EXECUTION.md`.

Before work:

1. locate the actual GitHub remote;
2. `git fetch <GH_REMOTE> --prune` — do not `git pull`;
3. inspect `git worktree list --porcelain`;
4. create/reuse the dedicated sibling worktree for `feat/d0-01-claude-surface` at the exact baseline according to `WORKTREE_EXECUTION.md`;
5. change cwd to that worktree;
6. verify there: HEAD == baseline, branch == expected feature branch, and worktree is clean;
7. do not switch/modify the shared entry repository or another Agent's worktree.

Mismatch => STOP `BASELINE_MISMATCH`.
Branch/path conflict => STOP with the corresponding worktree rule code.
If the Harness cannot access/create a sibling directory => STOP `WORKTREE_ACCESS_BLOCKED`; do not silently edit the shared repository.

## 3. Must-read sources

Read from exact baseline or explicit exact refs:

- `AGENTS.md`
- `docs/project/GOVERNANCE.md`
- `docs/project/HARNESS_TEAM.md`
- `docs/product/DAILY_DRIVER_D0.md`
- `docs/design/DESIGN_STATUS.md`
- `arckeep/README.md`
- existing KCC CloudCLI integration under `src/main/cloud-cli-service.js`

Also inspect upstream/current `cdesktop` source/docs sufficient to establish current launch, localhost, session and licensing/integration facts. Do not turn this into a general market survey.

## 4. Required spike

Prove on the user's Windows environment, in order:

### C1 — Local service

`cdesktop` can start as a local web service with a stable discoverable localhost URL suitable for a host shell.

Record exact package/version/command and process lifecycle.

### C2 — Real Claude Code

Create or resume a real Claude Code session through cdesktop using the user's existing valid environment/auth path.

Do not claim PASS from demo/mock data.

### C3 — WebView2 compatibility

Prove that the real cdesktop web surface can load inside an Arckeep/WebView2-compatible host without a product-blocking issue involving origin, auth, navigation, websocket/API routing, or browser restrictions.

A minimal isolated WebView2 probe is allowed if the current Arckeep shell cannot prove this without unrelated edits.

### C4 — Persistence across switching

Prove that hide/show or moving away/back does not require destroying the active Claude session/workspace surface.

### C5 — Failure isolation

Document a controlled startup/failure path. A failed Claude surface must not imply Arckeep/Kimi/DSH must fail.

## 5. Decision rule

If C1-C5 pass:

`DECISION = REUSE_CDESKTOP`

If a concrete hard blocker prevents cdesktop from satisfying the Daily Driver surface:

1. record exact blocker evidence;
2. inspect/reuse the existing KCC CloudCLI path;
3. prove the minimum equivalent launch/WebView2/session behavior;
4. decision may become `FALLBACK_CLOUDCLI`.

Do not evaluate a third framework unless both paths have concrete blocking evidence and Architecture Lead authorizes expansion.

## 6. Authorized changes

Preferred outcome is evidence with little/no production change.

Allowed:

- narrow spike/probe code under an explicitly named D0 spike/test area;
- minimal Arckeep host glue only if required to prove WebView2 compatibility;
- D0-01 evidence/report under `docs/acceptance/` or `docs/reuse/`.

## 7. Forbidden

- custom Claude chat/composer/transcript UI
- generalized AgentAdapter / Runtime Registry
- adopting cdesktop Worktree/Team domain into Arckeep
- DSH changes
- Viewer migration
- ATW integration
- broad Arckeep visual redesign
- broad KCC v1 migration
- changing the D0 Product Contract

Need for any above => STOP `ARCHITECTURE_EXCEPTION`.

## 8. Verification

At minimum report:

- exact baseline and HEAD;
- dedicated worktree absolute path;
- branch;
- cdesktop exact version/ref or resolved npm version;
- exact launch command/URL behavior;
- real Claude session evidence;
- WebView2 load evidence;
- persistence/switching evidence;
- process lifecycle/failure behavior;
- changed files;
- build/tests if code changed;
- final `REUSE_CDESKTOP` or `FALLBACK_CLOUDCLI` decision;
- limitations.

Screenshots are not required from the coding Harness. If screenshots are needed for visual review, ask the user.

## 9. Git / STOP

All implementation commits must be created inside the dedicated D0-01 worktree, never the shared entry repository.

Do not merge.

Open a PR targeting:

`integration/arckeep-daily-driver`

Then STOP for Architecture Review.

Do not start D0-03.
