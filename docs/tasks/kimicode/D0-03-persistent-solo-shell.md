# D0-03 — Persistent Solo Shell

Agent Role: Global / Runtime Engineer
Default Harness: KimiCode
Status: **READY**
Architecture / Product Lead: ChatGPT
Parent: GitHub Issue `#6`

## 1. Goal

Turn the already-proven D0 surfaces into one real always-open Windows workspace.

Required human loop:

`Project -> KimiCode / ClaudeCode / DSH / Viewer -> back to Project`

This WorkPackage is integration, not a redesign and not a new runtime framework.

Accepted input seams are already frozen:

- Kimi: existing `KimiWebService` + current ACP behavior in Arckeep;
- Claude: **cdesktop** selected by D0-01;
- DSH: `DshService` selected by D0-02;
- Viewer: `ViewerService -> standalone.cjs -> existing KCC Viewer` selected by D0-04.

## 2. Exact implementation baseline

Repository: `Dylan5237/kcc-workbench`

Implementation baseline exact:

`b2a76722cf7c3e5db994acadf9d210edfaf42ffd`

Expected base branch:

`integration/arckeep-daily-driver`

Expected feature branch:

`feat/d0-03-persistent-solo-shell`

Dedicated sibling worktree:

`../kcc-workbench-wt-d0-03`

The user may start the Agent session in the normal shared `kcc-workbench` folder. That folder is entry/control only. The Agent must follow:

`f9eab08d0f3b019b411c4d0418b9122295860657:docs/project/WORKTREE_EXECUTION.md`

Create/reuse the dedicated sibling worktree yourself, switch cwd there, and verify exact baseline/branch/clean state before implementation.

Do not `git pull`. Do not reset/stash/clean the user's shared repository.

## 3. Must-read accepted inputs

Read these from the baseline / merged integration history before editing:

- `AGENTS.md`
- `docs/product/DAILY_DRIVER_D0.md`
- `docs/design/DESIGN_STATUS.md`
- `arckeep/README.md`
- `arckeep/shell/ShellWindow.cs`
- `arckeep/shell/KimiWebService.cs`
- `arckeep/shell/DshService.cs`
- `arckeep/shell/ViewerService.cs`
- `docs/reuse/D0-01-claude-surface-reuse-gate.md`
- `docs/acceptance/d0-02-dsh-integration-spike.md`
- `docs/acceptance/D0-04-viewer-integration.md`

Architecture facts to preserve:

1. Kimi Web + ACP already work; do not casually rewrite them.
2. cdesktop is the selected Claude visual surface. CloudCLI is no longer the D0 primary path.
3. DSH is an ordinary Windows-hosted workspace here; no Creator Mode / Plugin / ATW.
4. Viewer is Arckeep-owned and cross-agent; cdesktop Diff does not replace it.
5. Previous visual design authority is reset. Use neutral/utilitarian integration UI only.

## 4. Required product behavior

### S1 — Four first-class workspace destinations

The running Arckeep window must expose clear switching between:

- Project
- Kimi
- Claude
- DSH
- Viewer

Viewer already exists and may keep its existing titlebar trigger if that is the lowest-risk path, but the user must be able to reach all four work surfaces plus Project without opening separate apps manually.

Do not build a new design system. Minimal titlebar/rail controls are sufficient for D0-03.

### S2 — Persistent WebView2 surfaces

Use separate persistent WebView2 instances for Kimi, Claude/cdesktop, DSH, and Viewer.

Ordinary workspace switching must be visibility/layout switching, not destruction/recreation/reload.

Requirements:

- Kimi page/session survives switching away/back;
- Claude/cdesktop page/session survives switching away/back;
- DSH page/session survives switching away/back;
- Viewer remains independently reachable;
- inactive WebViews remain alive unless their own service actually failed.

Do not create a generalized `AgentAdapter`, `RuntimeRegistry`, or generic workspace framework merely to reduce a few conditionals.

### S3 — Project continuity

Every workspace launch uses the current explicit Arckeep project root.

Project selection/switching must remain deterministic.

- Kimi starts against current project root;
- Claude/cdesktop workspace must be opened/created against current project root using cdesktop's existing concepts/API, without importing its Team/Worktree domain into Arckeep;
- DSH starts/attaches using current project root for Arckeep-owned startup;
- Viewer root stays synchronized using the accepted Viewer seam.

Do not invent cross-agent context synchronization in this WP.

### S4 — Kimi integration

Preserve existing `KimiWebService` and ACP behavior.

D0-03 may separate "open Kimi workspace" from "deliver Brief through ACP" if necessary so the user can use Kimi as a normal workspace, but must not break the existing Brief/ACP path.

Do not replace Kimi native Web UI.

### S5 — Claude / cdesktop host seam

Implement the minimum C# host glue required for cdesktop.

Accepted D0-01 facts:

- cdesktop exact validated version: `0.2.3` / binary tag `v0.2.3-20260519022845`;
- local loopback service;
- dynamic port;
- actual port discoverable from stdout and `%TEMP%\cdesktop\cdesktop.port`;
- `/api/health` and real Web surface work in WebView2;
- real Claude Code executor/session works using existing user auth/environment;
- cdesktop auto-opens an external browser on cold start; no tested no-open switch exists.

Required host behavior:

1. Prefer attach/reuse if a live cdesktop instance can be safely discovered from its port file + positive cdesktop health/surface evidence.
2. Otherwise start cdesktop as Arckeep-owned.
3. Determine the actual localhost URL deterministically; no fixed sleep.
4. Distinguish Attached vs Owned process semantics.
5. Arckeep exit must never kill a user-owned existing cdesktop.
6. An Arckeep-owned cdesktop must be cleaned up on normal exit and post-spawn startup failure.
7. Service failure must produce a controlled Claude-unavailable state without killing Kimi/DSH/Viewer/Project.
8. Do not patch/fork cdesktop merely to suppress browser auto-open. If an already-supported no-open seam is found, it may be used; otherwise record the one-browser-popup limitation for D0.

A narrow `CdesktopService.cs` is expected and preferred over generic abstractions.

### S6 — DSH wiring

Wire the already-merged `DshService` into the real ShellWindow.

Do not redesign/rewrite `DshService` unless actual integration uncovers a concrete compatibility defect.

Preserve:

- attach verified existing DSH when possible;
- owned `dsh web --port 0` fallback;
- deterministic readiness;
- Attached/Owned shutdown semantics;
- post-spawn cleanup guarantee.

### S7 — Failure isolation

The real Arckeep shell must remain usable when any one optional surface fails.

At minimum prove independently:

- Claude unavailable -> Project + Kimi + DSH + Viewer still reachable;
- DSH unavailable -> Project + Kimi + Claude + Viewer still reachable;
- Viewer unavailable -> Project + Kimi + Claude + DSH still reachable;
- Kimi Web unavailable -> Project + Claude + DSH + Viewer still reachable.

Do not require all external services to succeed before the main window becomes usable.

### S8 — Shutdown ownership

On Arckeep exit:

- clean only child/service processes Arckeep explicitly owns;
- do not kill user-owned attached cdesktop;
- do not kill user-owned attached DSH;
- preserve current Kimi/ACP shutdown correctness;
- Viewer sidecar follows its accepted lifecycle.

No broad `taskkill` by image name is acceptable in production code.

## 5. Integration shape — preferred, not speculative framework

The expected minimal shape is approximately:

```text
ShellWindow
├─ Project UI WebView2
├─ Kimi WebView2        -> KimiWebService
├─ Claude WebView2      -> CdesktopService
├─ DSH WebView2         -> DshService
└─ Viewer WebView2      -> ViewerService
```

A small enum/string for active workspace and a few explicit switch methods are fine.

Do not introduce a generalized provider/runtime/plugin architecture in D0-03.

## 6. Visual scope

This WP is **not D0-05**.

Allowed UI work:

- minimal workspace switch controls;
- minimal loading/unavailable states;
- preserve understandable current-project context;
- neutral utilitarian styling only.

Forbidden:

- new comprehensive design system;
- brand redesign;
- full information-architecture rewrite;
- aesthetic polish unrelated to workspace usability.

Final visual judgment belongs to User + ChatGPT after screenshots from the real machine.

## 7. Required verification

Use real Windows execution, not mocks alone.

### V1 — Cold launch

Prove one Arckeep launch reaches usable Project UI without waiting for all external surfaces.

### V2 — Real workspace switching

With real Kimi, cdesktop/Claude, DSH, Viewer available:

`Project -> Kimi -> Claude -> DSH -> Viewer -> Claude -> Kimi -> Project`

Prove switching does not intentionally reload inactive surfaces.

Use page markers / `performance.timeOrigin` / session identifiers where useful.

### V3 — Real Claude continuation

Create or resume a real Claude Code session through the embedded cdesktop surface, switch away and back, and prove the session can continue.

### V4 — Real DSH persistence

Switch away/back and prove the same DSH page/session state remains.

### V5 — Real Kimi preservation

Existing Kimi Web + ACP smoke path still works after the multi-surface changes.

At minimum preserve the existing real Brief delivery / follow-up behavior or its current automated hook equivalent.

### V6 — Viewer regression

Viewer still loads the current project and existing Viewer tests remain green.

### V7 — Failure isolation

Exercise at least controlled failure for Claude and DSH in the real ShellWindow; prove the rest of the shell remains navigable.

Do not damage user auth/data merely to manufacture failure.

### V8 — Shutdown

Prove Arckeep-owned cdesktop/DSH/Viewer processes are gone after exit while attached user-owned instances, if used in the test, remain alive.

## 8. Tests / evidence

Required before delivery:

- `dotnet build -c Release` under `arckeep/shell`;
- `npm test` for repository regression unless an exact documented environment blocker prevents it;
- focused service/integration probes or automated hooks for the new cdesktop host glue and multi-surface switching;
- real-machine evidence under `docs/acceptance/` and/or `spike/results/`.

Report:

- exact baseline;
- exact HEAD;
- branch/worktree;
- changed files;
- service ownership matrix;
- launch/attach URLs and versions;
- persistence evidence for Kimi/Claude/DSH;
- Viewer regression;
- failure isolation evidence;
- shutdown evidence;
- build/test results;
- known limitations.

Screenshots are not a coding-Harness acceptance responsibility. If needed, ask the user for explicit screenshots after implementation.

## 9. Explicit STOP gates

STOP `CDESKTOP_INTEGRATION_BLOCKED` if the accepted cdesktop seam cannot be hosted in the real Arckeep shell without patching/forking cdesktop or redesigning product scope.

STOP `DSH_INTEGRATION_BLOCKED` if the already-accepted DshService cannot be wired without changing DSH Plugin/Core/Creator Mode.

STOP `KIMI_REGRESSION` if preserving the current Kimi Web + ACP path requires a broad rewrite.

STOP `ARCHITECTURE_EXCEPTION` before introducing:

- generalized AgentAdapter / Runtime Registry;
- plugin architecture;
- ATW / Team Mode;
- cross-agent context/session unification;
- broad visual redesign;
- cdesktop Team/Worktree domain adoption;
- custom Claude UI;
- DSH Plugin/Creator Mode.

## 10. Git / delivery

Commit and push only from the dedicated D0-03 worktree.

Open PR:

`feat/d0-03-persistent-solo-shell -> integration/arckeep-daily-driver`

Do not merge.

Then STOP for ChatGPT Architecture Review.

Do not start D0-05 or D0-V from this WorkPackage.
