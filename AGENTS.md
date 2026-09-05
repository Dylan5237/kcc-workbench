# KCC Workbench / Arckeep Agent Guide

## Project authority

Arckeep is the active product direction in this repository. KCC Workbench v1 remains a proven capability donor, especially for Viewer and other already-validated assets.

For current project state, do not infer from chat history. Read GitHub Command Center / Phase / WorkPackage issues and the exact taskbook refs supplied there.

## Current D0 objective

`D0 — Daily Driver`

Make Arckeep a Windows application the user is willing to keep open all day as the primary AI engineering workspace.

Required D0 surfaces:

- Project continuity
- KimiCode
- Claude Code visual workspace
- DSH workspace
- Arckeep-owned KCC Viewer reuse

Long-term top-level product modes remain:

`Project / Solo / Team`

ATW Team Mode is deferred and does not block D0.

## Commands / legacy KCC v1

- Install: `npm ci`
- Test: `npm test`
- Run: `npm start`
- Isolated demo: `npm run demo -- --demo-profile=<name>`
- Build unpacked app: `npm run build`
- Build portable app: `npm run pack`

Use Node.js 22 for KCC v1 development and packaging. Legacy CloudCLI currently starts through a compatible system Node runtime.

## Active Arckeep implementation

- `arckeep/` is the active Windows product implementation.
- Host stack remains C# thin shell + WebView2 for the current walking skeleton.
- Existing Kimi Web + ACP behavior is proven and should not be casually rewritten.
- Runtime prerequisites: Windows 10/11, WebView2 Runtime, .NET SDK 7+, kimi CLI >= 0.39 on PATH, and Node.js on PATH (KCC Viewer sidecar, D0-04). Claude surface reuses cdesktop 0.2.3 (binary auto-downloaded under `~/.cdesktop/bin/` on first `npx cdesktop`; D0-03); DSH workspace reuses the user's `dsh` CLI when present (D0-02), both attach-first and optional — Arckeep must stay usable without them.
- `src/` is KCC v1 legacy/product code and a capability donor during D0; do not perform broad migration/restructure unless explicitly authorized.
- `src/viewer/**` is a high-value reuse source for the Arckeep Viewer WorkPackage.

## Project-management rules

Canonical workflow:

`Contract Freeze → Implementation → Independent Verification → Architecture Lead Acceptance → CLOSED`

- ChatGPT = Chief Architect / PM / Orchestrator.
- Agent self-report ≠ acceptance.
- PR merge ≠ Phase PASS.
- One significant WorkPackage = one dedicated branch/worktree/PR.
- Fetch the actual GitHub remote; do not blindly `git pull`.
- Exact baseline / exact HEAD / diff / tests / evidence must be traceable.
- Implementation Harnesses do not self-authorize architecture expansion.
- Preserve unrelated dirty files.
- Coding Agents do not own screenshot reading or final visual judgment. User supplies screenshots; ChatGPT performs visual/product acceptance.

## Harness team

Read `docs/project/HARNESS_TEAM.md` for current role bindings.

Core principle:

`Role ≠ Harness Identity`

Important DSH rule:

**DSH Creator Mode is only for explicitly authorized DSH plugin development or plugin-internal implementation work. It is not the default tool for integrating the existing DSH application into the Arckeep Windows host.**

Normal Windows process / localhost / WebView2 / lifecycle integration with existing DSH capabilities belongs to the regular Backend / Integration or Global / Runtime engineering role.

If existing DSH capabilities prove insufficient and a plugin change is actually required, STOP `PLUGIN_REQUIRED` and request an Architecture Exception before using Creator Mode.

## Design authority

Current state:

`DESIGN RESET`

The user rejected the previous Arckeep visual/design system as the forward authority.

Therefore:

- `docs/brand/**` and old Arckeep visual prototypes are historical references only;
- do not treat them as mandatory visual authority for new D0 UI;
- no replacement comprehensive Design System is frozen yet;
- first integrate the real Daily Driver surfaces, then use real user screenshots and operation feedback to converge information architecture, density, hierarchy, navigation and visual language.

See `docs/design/DESIGN_STATUS.md`.

## D0 scope discipline

Before Daily Driver is accepted, do not introduce without a proven blocker:

- generalized AgentAdapter / Runtime Registry;
- new Domain Core rewrite;
- full new Design System framework;
- deep ATW integration;
- broad KCC v1 migration;
- custom replacement UI for an existing reusable Agent/Harness surface.

Reuse mature existing surfaces first.

## Legacy KCC v1 architecture notes

These remain relevant when reusing capability:

- `src/main/`: Electron main process, Kimi/CloudCLI services, settings, quota, Viewer context synchronization.
- `src/renderer/`: legacy KCC renderer.
- `src/viewer/`: local authenticated Viewer server/frontend.
- `test/`: Node test suite; tests must use isolated temporary data.
- Kimi and CloudCLI used separate persistent `WebContentsView` instances; normal engine switching did not reload either surface.
- Viewer diagnostics must never log auth tokens or cookies.

Legacy KCC v1 was released and has proven real signed-in Kimi / Claude Code / Codex sessions and Viewer behavior. Reuse those facts as capability evidence, not as a requirement to retain the Electron product architecture.
