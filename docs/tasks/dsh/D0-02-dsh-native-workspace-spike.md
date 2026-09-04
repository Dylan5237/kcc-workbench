# D0-02 — DSH Windows Workspace Integration Spike

Agent Role: Backend / Integration Engineer
Default Harness: Claude Code
Status: **READY**
Architecture / Product Lead: ChatGPT
Parent: GitHub Issue `#5`

## 1. Goal

Prove the narrowest supported way to integrate DSH as a real, persistent Daily Driver workspace surface inside the Arckeep Windows application.

This is a **Windows host integration task against existing DSH capabilities**. It is not DSH plugin development, not Creator Mode work, and not ATW Team Mode.

## 2. Exact implementation baseline

Repository: `Dylan5237/kcc-workbench`

Baseline exact:

`014ab506dcfb6f9efe2154278cec4916cfc2f743`

Expected base branch:

`integration/arckeep-daily-driver`

Expected feature branch:

`feat/d0-02-dsh-integration`

Dedicated sibling worktree convention:

`../kcc-workbench-wt-d0-02`

The user may start this Agent session by selecting the normal shared `kcc-workbench` folder. That selected folder is only the **entry/control repository**. The Agent must create/reuse its own dedicated sibling worktree and move execution cwd there before any implementation.

Frozen worktree bootstrap rules:

`f9eab08d0f3b019b411c4d0418b9122295860657:docs/project/WORKTREE_EXECUTION.md`

Read them with exact-ref inspection, e.g. `git show f9eab08d0f3b019b411c4d0418b9122295860657:docs/project/WORKTREE_EXECUTION.md`.

Before work:

1. locate the actual GitHub remote;
2. `git fetch <GH_REMOTE> --prune` — do not `git pull`;
3. inspect `git worktree list --porcelain`;
4. create/reuse the dedicated sibling worktree for `feat/d0-02-dsh-integration` at the exact baseline according to `WORKTREE_EXECUTION.md`;
5. change cwd to that worktree;
6. verify there: HEAD == baseline, branch == expected feature branch, and worktree is clean;
7. do not switch/modify the shared entry repository or another Agent's worktree.

Mismatch => STOP `BASELINE_MISMATCH`.
Branch/path conflict => STOP with the corresponding worktree rule code.
If the Harness cannot access/create a sibling directory => STOP `WORKTREE_ACCESS_BLOCKED`; do not silently edit the shared repository.

## 3. Must-read sources

Read from exact baseline / explicit taskbook refs:

- `AGENTS.md`
- `docs/project/GOVERNANCE.md`
- `docs/project/HARNESS_TEAM.md`
- `docs/product/DAILY_DRIVER_D0.md`
- `docs/design/DESIGN_STATUS.md`
- `arckeep/README.md`

Reuse already-proven DSH integration evidence/patterns from:

- `Dylan5237/req-to-page`
- `Dylan5237/agent-team-workbench`

Use normal repository/code/runtime inspection and the installed DSH application's documented/supported surfaces.

**Do not invoke DSH Creator Mode by default.** Creator Mode is only for an explicitly authorized DSH plugin-development WorkPackage.

## 4. Required proof

### D1 — Existing DSH start / attach seam

Identify the narrowest supported way for a Windows host application to start or attach to the user's existing DSH installation.

Record:
- exact DSH version/build if discoverable through normal supported means;
- executable / command / process path;
- host/port or Web surface discovery;
- whether Arckeep should start DSH or attach to an already-running instance.

Prefer existing supported DSH behavior over any custom protocol.

### D2 — Health / readiness

Identify a deterministic readiness signal suitable for Arckeep.

Do not infer readiness from arbitrary sleeps when an existing health/service/page signal is available.

### D3 — Real Web surface

Prove that the existing DSH Web workspace can be loaded in an Arckeep/WebView2-compatible localhost surface.

Do not build a substitute DSH UI.

### D4 — Persistence across switching

Prove normal Arckeep hide/show or workspace switching can keep the DSH surface alive without intentional reload/session loss.

### D5 — Failure isolation

If DSH is unavailable or startup fails:

- Kimi/Claude/Viewer remain usable;
- Arckeep exposes a controlled product-level failure state;
- diagnostics stay secondary.

### D6 — Process ownership

If Arckeep starts DSH, define exact shutdown / attach / reuse semantics so Arckeep does not orphan its own process or kill a user-owned pre-existing DSH instance.

## 5. Architecture boundaries

- DSH remains owner of its existing Harness/runtime workspace.
- Arckeep owns shell/navigation/project context and the minimum Windows process/WebView2 integration seam.
- No DSH core modification.
- No DSH plugin development in this WorkPackage.
- No second workflow/state truth.
- No ATW collaboration semantics.

## 6. Authorized changes

Preferred outcome is evidence with minimal production change.

Allowed:

- normal C# Windows process/service/WebView2 integration probe;
- narrow DSH start/attach/readiness glue in Arckeep if needed to prove the seam;
- D0-02 report/evidence under `docs/acceptance/` or `docs/reuse/`.

## 7. Forbidden / exception rule

Forbidden:

- DSH core modification;
- DSH plugin creation/modification;
- DSH Creator Mode as a default execution environment;
- ATW Team Mode integration;
- generalized HarnessAdapter / Runtime Registry;
- Arckeep workflow controller;
- Kimi/Claude changes;
- Viewer migration;
- full visual redesign;
- changing D0 Product Contract.

If the investigation demonstrates that **existing DSH capabilities cannot provide the required Windows integration seam and a new/changed DSH plugin is genuinely necessary**, STOP:

`PLUGIN_REQUIRED`

Report the exact missing capability and evidence. Architecture Lead will decide whether to create a separate plugin WorkPackage using DSH Creator Mode.

Do not silently expand this task.

## 8. Verification

Report:

- exact baseline / HEAD;
- dedicated worktree absolute path;
- branch;
- DSH version/build evidence available through normal means;
- existing start/attach seam;
- readiness evidence;
- real WebView2 surface evidence;
- persistence/switching evidence;
- failure isolation behavior;
- process ownership/shutdown semantics;
- changed files;
- tests/build if code changed;
- limitations;
- `PLUGIN_REQUIRED` only if concrete evidence proves it.

Screenshots are not required from the coding Harness. Ask the user if visual evidence is needed.

## 9. Git / STOP

All implementation commits must be created inside the dedicated D0-02 worktree, never the shared entry repository.

Do not merge.

Open PR targeting:

`integration/arckeep-daily-driver`

Then STOP for Architecture Review.

Do not start D0-03 and do not implement ATW Team Mode.
