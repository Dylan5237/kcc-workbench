# D0-03 R3 — Human-Visible Surface Composition Repair

Parent: #6 / D0 Daily Driver #3

Owner Role: Global / Runtime Engineer
Default Harness: KimiCode
Architecture Review: ChatGPT
Visual Acceptance: User + ChatGPT

## Implementation baseline exact

`ffaf5ad946d36a92b965400535232c2c7f4d882f`

## Why R3 exists

R0–R2 proved process lifecycle, project binding, persistence and internal WebView2 loading. Human real-machine screenshots after merge exposed a host-composition defect that those probes did not test:

- Kimi is visibly usable inside Arckeep.
- Claude / DSH / Viewer tabs can become active while the Arckeep window still visibly shows the Project/Rail UI (`R.1`–`R.5`) instead of the selected embedded surface.
- Existing probes can execute JS against a loaded WebView2 even when that control is behind another control, therefore "page loaded" is not sufficient evidence that the user can see/interact with it.

Current shell shape places `_uiView`, `_agentView`, `_claudeView`, `_dshView`, `_viewerView` inside one `TableLayoutPanel`; Claude/DSH/Viewer are added into the same table cell/span and rely on `Visible + BringToFront` for full overlay. This must be replaced by a deterministic host composition seam.

## R3 goal

Make the accepted five destinations mechanically true in the human-visible window:

`Project / Kimi / Claude / DSH / Viewer`

When Claude, DSH or Viewer is active, that surface must actually occupy the application content area and receive input. The Project/Rail UI must not visually cover it.

Preserve all accepted R2 semantics.

## Preferred minimal shape

Do not introduce a new UI framework.

Prefer a dedicated content host where full-surface overlays are siblings of the Project/Kimi split layout, e.g.:

```text
ShellWindow
├─ titleBar
└─ contentHost (Dock.Fill)
   ├─ projectKimiLayout
   │  ├─ Kimi WebView2
   │  └─ Arckeep UI WebView2
   ├─ Claude WebView2
   ├─ DSH WebView2
   └─ Viewer WebView2
```

The exact WinForms container may differ, but the resulting z-order must be deterministic. Do not keep a composition that depends on multiple controls occupying the same `TableLayoutPanel` cell if that is the cause.

## Required behavior

### H1 Project

Project shows the existing Arckeep Project UI.

### H2 Kimi

Kimi continues to use the accepted split/rail layout and existing Kimi project binding/session behavior.

### H3 Claude

Selecting Claude visibly displays the cdesktop WebView across the intended content area. The Project/Rail WebView must not cover it.

### H4 DSH

Selecting DSH visibly displays the real DSH WebView across the intended content area.

### H5 Viewer

Selecting Viewer visibly displays the real KCC Viewer WebView across the intended content area.

### H6 Switching

`Project -> Kimi -> Claude -> DSH -> Viewer -> Claude -> Kimi -> Project`

must preserve the previously accepted no-reload/session behavior. R3 changes composition/z-order only, not lifecycle semantics.

### H7 Hit target / z-order evidence

Add a focused non-visual probe that verifies, for each active destination:

- selected WebView is `Visible=true`;
- selected WebView bounds equal the intended content host bounds (within deterministic layout constraints);
- selected WebView is the topmost interactive child in the content host / has the expected child index or equivalent host z-order proof;
- an inactive Project/Rail control is not topmost over Claude/DSH/Viewer;
- DOM probe for the selected surface still succeeds.

The purpose is to prevent the previous false positive where JS could run in a loaded but visually occluded WebView.

### H8 Human evidence gate

Coding Agent does **not** self-approve screenshots or visual design.

After implementation is architecture-accepted, User captures real screenshots of Project/Kimi/Claude/DSH/Viewer. ChatGPT performs the human-visible acceptance.

## Preserve / forbidden

Preserve:
- R2 fail-closed project binding;
- generation/root guards;
- Kimi/Claude binding semantics;
- DSH attached/owned safety;
- Viewer sidecar reuse;
- process ownership and shutdown;
- failure isolation;
- ordinary no-reload switching.

Forbidden:
- D0-05 visual redesign;
- redesigning Project IA in this repair;
- changing native Kimi/cdesktop/DSH/Viewer UI;
- AgentAdapter / RuntimeRegistry;
- ATW / Team Mode;
- DSH Creator Mode / Plugin/Core;
- custom Claude UI;
- broad framework migration.

## Verification

Must run:

- `cd arckeep/shell && dotnet build -c Release`
- repo root `npm test`
- focused host-composition/z-order probe for all five destinations
- existing affected workspace-switch persistence regression
- project A->B/C binding regression only if R3 touches project-binding code (prefer not to)

Do not redo expensive Claude paid-session tests if lifecycle/session code is untouched.

## Delivery

Branch: `fix/d0-03-r3-surface-composition`

Dedicated sibling worktree: `../kcc-workbench-wt-d0-03-r3`

PR target: `integration/arckeep-daily-driver`

Report:
- exact baseline;
- exact HEAD;
- changed files;
- root cause;
- final content-host/z-order shape;
- H1-H7 evidence;
- ordinary switching persistence regression;
- build/test results;
- limitations.

Do not merge. Do not start D0-05 or D0-V. STOP for ChatGPT Architecture Review.