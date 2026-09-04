# Arckeep / KCC Repository Agent Guide

## Active product

**Arckeep is the active product.**

Current project control plane:

- Command Center: GitHub Issue `#2`
- Current Phase: GitHub Issue `#3` — D0 Daily Driver
- D0 integration branch: `integration/arckeep-daily-driver`
- D0 source baseline: `8e08efd8e35bd9d42466a0bda27631fc95b36d65`
- Governance: `docs/project/GOVERNANCE.md`
- Harness team: `docs/project/HARNESS_TEAM.md`
- D0 product contract: `docs/product/DAILY_DRIVER_D0.md`
- Visual authority status: `docs/design/DESIGN_STATUS.md`

GitHub + exact refs are the cross-session project truth. Chat is interaction/orchestration only.

## Product direction

Long-term primary modes:

`Project / Solo / Team`

D0 goal: make Arckeep the user's always-open Daily Driver with real KimiCode + ClaudeCode + DSH workspaces and the KCC Viewer as a first-class cross-agent review surface.

ATW Team Mode is deferred until the Daily Driver and ATW First Usable paths are independently ready.

## Repository generations and boundaries

- `arckeep/`: **active Arckeep product implementation** — C# thin shell + WebView2 + project continuity / ACP seams.
- `src/`: **KCC Workbench v1 legacy implementation and capability donor** — Electron Kimi/CloudCLI/Viewer/Quota/Time Machine code. Do not broadly migrate or reorganize it during D0 merely for cleanliness.
- `src/viewer/`: approved KCC Viewer capability source. Viewer is required for Arckeep D0.
- `docs/`: mixed historical and current design material. Current authority is determined by the project/governance files above, not file age or filename version alone.

## Arckeep commands

```bash
cd arckeep/shell
dotnet build -c Release
./bin/Release/net7.0-windows/Arckeep.exe
```

Current prerequisites include Windows 10/11, WebView2 Runtime, .NET SDK 7+, kimi CLI >= 0.39 on PATH, and Node.js on PATH (KCC Viewer sidecar, D0-04) unless a WorkPackage explicitly changes them.

## KCC v1 donor commands

Use only when working on/reusing the legacy KCC capability tree:

- Install: `npm ci`
- Test: `npm test`
- Run: `npm start`
- Isolated demo: `npm run demo -- --demo-profile=<name>`
- Build unpacked app: `npm run build`
- Build portable app: `npm run pack`

KCC v1 development/packaging expects Node.js 22. Existing CloudCLI integration is a proven fallback for Claude/Codex visual access, but D0 first evaluates cdesktop reuse before inventing a new Claude UI.

## Current visual authority

**DESIGN RESET.**

The user explicitly rejected the previous Arckeep design system as the forward visual authority.

Historical references remain in the repository, including:

- `docs/brand/**`
- `docs/prototypes/arckeep-visual-v0.4.html`
- visual styling currently embedded in `arckeep/ui/`

Do not delete them, but do **not** treat them as mandatory D0 styling authority.

No comprehensive replacement design system is frozen yet. D0 first integrates real Daily Driver surfaces, then visual/product convergence is driven by real screenshots and user feedback. See `docs/design/DESIGN_STATUS.md`.

## Harness team

Default role bindings are defined in `docs/project/HARNESS_TEAM.md`.

Key rule:

`Role != Harness Identity`

Typical bindings:

- ChatGPT — Chief Architect / PM / Orchestrator / final architecture-product review
- KimiCode — Global / Runtime Engineer
- Claude Code — Backend / Integration Engineer
- Cursor — Product UI Engineer
- Codex — Independent Verifier
- DSH Creator Mode — DSH Native Specialist
- User + ChatGPT — real-machine Visual / Product Acceptance

Do not hard-code implementation contracts to a named Harness unless the WorkPackage specifically concerns that Harness.

## D0 active WorkPackages

- `#4` D0-01 Claude visual surface reuse gate — cdesktop first, CloudCLI fallback
- `#5` D0-02 DSH native workspace integration spike
- `#6` D0-03 Persistent Solo Shell — KimiCode + ClaudeCode + DSH
- `#7` D0-04 KCC Viewer integration
- `#8` D0-05 Product visual reset on real surfaces
- `#9` D0-V Independent Daily Driver verification
- `#10` D0-00 Project control reset

Do not start downstream WorkPackages before their dependency/review gates are satisfied.

## Project / Git rules

Arckeep follows:

`Contract Freeze -> Implementation -> Independent Verification -> Architecture Lead Acceptance -> CLOSED`

- Agent self-report != acceptance.
- PR merge != phase PASS.
- One WorkPackage normally uses one dedicated branch/worktree/PR.
- Start from an exact recorded SHA.
- `git fetch <actual GitHub remote> --prune`; do not use blind `git pull` as synchronization.
- Do not switch or overwrite another Agent's worktree.
- Baseline mismatch => STOP `BASELINE_MISMATCH`.
- Architecture violation / required scope expansion => STOP `ARCHITECTURE_EXCEPTION`.
- Coding Agents do not perform screenshot reading or final visual review. User provides screenshots; ChatGPT reviews and issues text repair instructions.
- Preserve unrelated dirty files and historical evidence.

## Existing proven Arckeep facts

The current `arckeep/` walking skeleton already includes real project-folder state, `.arckeep/` read/write, Kimi Web embedding, ACP session/prompt flow, persistent WebView2 concepts, quota migration work, and a C# process/window host. Preserve working behavior unless the current WorkPackage requires a narrow compatibility repair.

See `arckeep/README.md` for implementation notes and known WebView2/Windows pitfalls.

## D0 STOP discipline

Before Daily Driver acceptance, do not introduce without a demonstrated blocker:

- generalized AgentAdapter / Runtime Registry
- complete Domain/Core rewrite
- deep ATW Team Mode integration
- replacement Claude UI built from scratch
- broad KCC v1 migration
- comprehensive new Design System framework
- speculative infrastructure for later Team Mode
