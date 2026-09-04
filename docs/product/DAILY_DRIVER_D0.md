# D0 Product Contract — Arckeep Daily Driver

Status: **FROZEN FOR D0**

Parent Phase: GitHub Issue `#3`

Source baseline: `8e08efd8e35bd9d42466a0bda27631fc95b36d65`

Integration branch: `integration/arckeep-daily-driver`

## 1. Product intent

D0 is successful when Arckeep becomes the user's default, always-open AI engineering workspace and materially reduces frequent switching among separate Agent/Harness clients.

The phase optimizes for real daily usefulness before architectural completeness.

## 2. Long-term primary modes

Arckeep's long-term top-level product model is:

- `Project` — where am I, why, what changed, what next
- `Solo` — direct work with individual Agent/Harness workspaces
- `Team` — governed multi-Agent work, later powered by ATW

D0 primarily delivers Project + Solo + Viewer. Team is not a D0 blocker.

## 3. Required D0 surfaces

### Project

Arckeep owns project continuity and explicit project-root context.

### Solo

D0 must make these real workspaces available without requiring the user to manage separate apps as the normal path:

- KimiCode
- ClaudeCode visual workspace
- DSH

The preferred strategy is reuse of native/existing work surfaces, not reimplementation.

### Viewer

KCC Viewer is a required first-class Arckeep-owned surface.

Viewer is cross-agent: it exists for the human to inspect project files, artifacts and diffs regardless of whether work was produced by KimiCode, ClaudeCode, DSH or future ATW workers.

At minimum D0 should retain/reuse:

- project file tree
- Markdown view
- JSON view
- HTML preview where already proven
- Diff/review path
- current project/artifact context

Time Machine/checkpoint features remain important but may be deferred within D0 if they materially block the Daily Driver loop.

## 4. Daily Driver loop

The target human loop is:

`Open Arckeep → select/return to project → work in KimiCode / ClaudeCode / DSH → inspect with Viewer → return to workspace`

Ordinary workspace switching should preserve the work surface rather than intentionally destroy/reload it.

## 5. Resilience

- One unavailable/failed work surface must not make the entire Arckeep unusable.
- Startup/failure states must be understandable at product level.
- Processes started by Arckeep need explicit ownership and shutdown behavior.
- Existing stable Kimi behavior should not be rewritten without necessity.

## 6. Visual direction

The previous visual/brand system is not the forward D0 visual authority. See `docs/design/DESIGN_STATUS.md`.

D0 must first integrate real work surfaces. Visual convergence follows real screenshots and user operation rather than mock-heavy design speculation.

## 7. Explicit non-goals

D0 does not authorize:

- deep ATW Team Mode integration
- generalized AgentAdapter / Runtime Registry
- complete Domain/Core rewrite
- replacement Claude UI built from scratch
- broad KCC v1 codebase migration
- full cross-agent session/context synchronization
- comprehensive new Design System framework
- speculative infrastructure for later phases

## 8. Acceptance

D0 closes only after:

1. functional implementation evidence;
2. independent verification;
3. user real-machine operation/screenshots;
4. ChatGPT architecture review;
5. user + ChatGPT product/visual acceptance.

PR merge alone is insufficient.
