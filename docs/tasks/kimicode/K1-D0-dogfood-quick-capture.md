# K1-D0 — Dogfood Quick Capture + Start Menu launcher

Parent control plane: #2  
Parent stabilization: #16  
WorkPackage: #34  
Dogfood gate: #33  
Owner role: Global / Runtime Engineer  
Default Harness: KimiCode  
Architecture Review: ChatGPT  
Human visual acceptance: User + ChatGPT

## Status

RELEASED after the exact implementation baseline is recorded in issue #34.

## Product goal

Before the five-day dogfood clock starts, add one deliberately small capture mechanism so the user can record real friction and ideas without leaving Arckeep or turning each observation into a GitHub issue.

This WP also adds a stable user Start Menu launcher for the deterministic merged dogfood build.

## Existing UI/runtime facts

Current shell titlebar contains a Kimi-only restart button rendered as `↻ 重启首页` plus the quota pill. `shell.html` itself occupies only the titlebar height. Primary Kimi/CloudCLI/Viewer/Settings surfaces are separate `WebContentsView`s managed by `src/main/main.js`.

Therefore a capture drawer that must remain visible over the active Agent workspace should use the existing `WebContentsView` composition rather than trying to grow the titlebar DOM over the content views.

## Scope A — titlebar actions

1. Change the restart control from text + icon to **icon only**.
2. Preserve the same restart behavior and Kimi-only visibility.
3. Tooltip / accessible label should read `重启首页` (or equivalent precise wording); removing visible text must not remove accessibility.
4. Add a **notebook/note icon-only button immediately to the left of the restart control**.
5. The capture button is a global Arckeep action, not Kimi-only: it remains available on Kimi, CloudCLI, Viewer and Settings.
6. Do not add an icon dependency merely for this WP. Reuse current icon strategy or a minimal inline SVG compatible with the existing CSP.

## Scope B — Dogfood Inbox drawer

Clicking the note button opens a lightweight right-side drawer/overlay.

Required interaction:
- underlying active workspace remains mounted; do not reload, detach/reattach for correctness, or destroy the current Kimi/CloudCLI/Viewer session merely to open capture;
- no full-screen modal and no shell redesign;
- drawer appears on the right below the titlebar, approximately 360–440 px wide as appropriate for the current shell;
- close via explicit close control and `Escape`;
- opening the drawer focuses the text editor;
- closing should return focus to the previously active workspace when practical;
- opening Dogfood Inbox should close the quota popup if it would overlap; opening quota may close Dogfood Inbox if needed for a single-overlay invariant.

### Capture form

Keep the form deliberately minimal:
- type: `问题` / `想法` / `正向反馈`;
- one Markdown-friendly plain-text textarea;
- one primary `记录` action;
- no required severity, reproduction steps, labels, assignee, GitHub issue, or other ceremony.

A normal capture should take under ~10 seconds.

After successful save:
- clear the editor;
- keep the drawer open;
- show the new record in today's list.

### Today list

Show records for the current local date, newest first.

Allow only minimal management:
- edit text/type;
- delete with a lightweight confirmation;
- no search/filter/tagging system in this WP.

## Scope C — automatic context

Every create record must contain:
- stable record id;
- created timestamp (ISO-8601);
- local calendar date used by the Today list;
- type;
- text;
- active engine (`kimi` / `cloudcli`) when known;
- active Arckeep tab when known;
- app version;
- source build commit when it can be read reliably from the deterministic build metadata.

Best-effort optional context:
- current positively-bound project root;
- current positively-bound Agent session id.

Important:
- **missing context must never block capture**;
- do not start a fresh Kimi/CloudCLI detector request solely because the user pressed `记录`;
- if session/project context is included, reuse already-known / successfully-applied context from the existing lifecycle rather than changing #23 session-arm semantics;
- do not expose auth tokens, cookies, prompts, environment secrets or arbitrary filesystem contents.

### Build provenance

For packaged dogfood builds, read build provenance only from known safe adjacent deterministic metadata locations (for example the `build-info.json` associated with `dist-fast/win-unpacked/Arckeep.exe`). If unavailable, store `sourceCommit: null` and continue.

Do not weaken #25 deterministic packaging to make provenance easier.

## Scope D — local persistence

Store dogfood evidence under the existing KCC-compatible userData path, logical directory:

`<userData>/dogfood/`

Preferred files:
- `inbox.jsonl` — source-of-truth append log;
- `inbox.md` — regenerated human-readable snapshot/export after successful mutations.

### JSONL contract

Use a small append-only event log so a partial write does not require rewriting the whole history.

Minimum event forms:
- `create` — full record payload;
- `update` — record id + permitted patch (`type`, `text`, updated timestamp);
- `delete` — record id + deleted timestamp.

On load, fold events in order to derive current records.

Requirements:
- malformed trailing line must fail safely without destroying earlier valid entries;
- writes must not touch auth/profile/session files outside the dogfood directory;
- no network sync;
- no GitHub auto-post;
- no AI classification/summarization during capture.

`inbox.md` is derivative, not authoritative. Regenerate it atomically from folded current records when practical.

## Scope E — keyboard shortcut

Add:

`Ctrl + Shift + N`

Behavior:
- from any primary Arckeep workspace WebContentsView, opens Dogfood Inbox and focuses the editor;
- if already open, focus the editor rather than creating another view;
- must not conflict with the existing `Alt+Q` engine switch;
- do not use a system-global hotkey. This shortcut is app-local only.

Register it consistently across Shell, Kimi, CloudCLI, Viewer, Settings and the Dogfood view itself using the existing `before-input-event` style where appropriate.

## Scope F — Start Menu launcher helper

Add a small Windows helper, recommended path:

`scripts/install-start-menu-shortcut.ps1`

Purpose: create/update the current user's Start Menu shortcut for Arckeep without introducing an installer/updater architecture.

### Required behavior

Inputs:
- `-ExecutablePath` — explicit Arckeep.exe path; required or otherwise unambiguously resolved;
- optional `-ShortcutName` default `Arckeep`;
- optional `-StartMenuRoot` test seam. Production default is the current user's `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs`.

The script must:
- fail if the executable does not exist;
- resolve the target to an absolute path;
- create/update only `<ShortcutName>.lnk` in the chosen Start Menu root;
- set TargetPath to the exact Arckeep executable;
- set WorkingDirectory to its containing directory;
- use the executable itself as IconLocation where suitable;
- require no administrator privileges;
- not modify machine-wide Start Menu locations;
- not delete unrelated shortcuts;
- report the created shortcut path and resolved target.

### PR-time safety

During implementation/review, machine-test the helper using a **temporary StartMenuRoot** and disposable target. Do not point the user's real Start Menu at a short-lived feature worktree.

### Post-merge activation

After ChatGPT Architecture Review passes and #34 is merged:
1. fetch `origin/develop/kcc-1.0`;
2. run deterministic `scripts/package-dev.ps1 -Fast`;
3. verify `build-info.json` points to the merged develop SHA;
4. install/update the real user Start Menu shortcut `Arckeep` to the stable deterministic packaging-worktree executable, expected to be under the dedicated package worktree `dist-fast\\win-unpacked\\Arckeep.exe`;
5. verify the `.lnk` target resolves to that exact stable path.

This post-merge local activation is part of #34 completion, but must not occur before merge.

## Architecture seams

Expected primary seams only:
- `src/renderer/shell.html`
- `src/renderer/shell.js`
- `src/renderer/shell.css`
- `src/preload/shell.cjs`
- `src/main/main.js`
- new Dogfood Inbox renderer/preload files under existing `src/renderer` / `src/preload`
- a small dogfood persistence service under `src/main` if useful for testing
- focused tests
- `scripts/install-start-menu-shortcut.ps1`

Do not turn this into a generalized panel framework, plugin system, note service, database layer, or shell rewrite.

## Regression gates

Must preserve:
- #17 Viewer realtime;
- #18 CloudCLI endpoint/origin/auth continuity;
- #23 Viewer passive auto-arm (opening/closing Dogfood Inbox cannot become a prerequisite for recording);
- #25 deterministic package provenance;
- #19 fast local packaging/startup behavior;
- #20 Arckeep identity + stable KCC-compatible userData path and explicit `--user-data-dir` isolation.

Especially verify:
- active Kimi/CloudCLI session survives repeated open/close of Dogfood Inbox;
- underlying Agent WebContentsView is not reloaded by capture UI;
- Viewer passive recording still arms in the background when Dogfood Inbox is never opened;
- capture persistence under `--user-data-dir=<TEMP>` stays inside that temp profile, not real KCC userData.

## Required tests

At minimum:
- deterministic unit tests for JSONL fold/create/update/delete and malformed trailing line handling;
- IPC sender validation for new dogfood handlers;
- focused shell/shortcut behavior tests where current test style permits;
- `npm test`;
- `npm run build`;
- real Windows app smoke using disposable `--user-data-dir` for capture persistence;
- real Start Menu helper smoke against a temporary StartMenuRoot.

## Human visual gate

Agent must not do screenshot-based visual acceptance.

After machine checks pass, User + ChatGPT visually verify:
- refresh control is icon-only;
- notebook button is immediately to its left;
- drawer width/placement does not redesign the shell;
- editor and three capture types are obvious;
- underlying work surface remains visible;
- no accidental KCC primary branding returns.

## Process safety

Carry forward:
- terminate only PIDs spawned and explicitly tracked by the current probe;
- never force-kill pre-existing Arckeep/KCC/Electron/Node/Kimi/CloudCLI/Agent/terminal processes;
- pre-existing single-instance/profile locks require `HUMAN_ACTION_REQUIRED`;
- destructive auth/profile mutation requires explicit human approval.

## Non-goals

Do not implement:
- general notes application;
- rich text/WYSIWYG;
- screenshots/attachments;
- severity workflow;
- GitHub sync;
- AI auto-classification/summarization;
- search/tag system;
- task management;
- installer/updater;
- Arckeep 2.0;
- unrelated shell redesign.

## Delivery

Implementation branch:
`feat/k1-dogfood-quick-capture`

Dedicated sibling worktree:
`D:\\_projects\\tools\\kcc-workbench-wt-k1-dogfood-capture`

PR target:
`develop/kcc-1.0`

Delivery report must include:
- exact implementation baseline and HEAD;
- changed files;
- final overlay/view lifecycle;
- persistence schema/path;
- malformed-log behavior;
- context fields and any unavailable fields;
- shortcut behavior and exact key chord;
- `npm test` / `npm run build`;
- disposable-profile real capture smoke;
- temporary StartMenuRoot shortcut smoke;
- #17/#18/#23/#25/#19/#20 regression evidence;
- limitations;
- PR number/URL.

Do not merge. Do not begin the five-day dogfood clock. STOP for ChatGPT Architecture Review.