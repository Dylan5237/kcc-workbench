# Arckeep Harness Team Template

This file defines the default engineering team topology for Arckeep. It is adapted from the multi-Harness operating model already used successfully in `Dylan5237/req-to-page`.

## 1. Core rule

`Role ≠ Harness Identity`

A role is an engineering responsibility. A Harness/Agent is a current runtime binding for that role.

Default bindings may change when capability, availability, or task fit changes. The task contract must not depend on a brand name unless the task is specifically about that Harness.

## 2. Default team

| Role | Default Harness | Primary responsibility |
|---|---|---|
| Chief Architect / PM / Orchestrator | ChatGPT | Product direction, architecture, phase planning, taskbooks, scope control, review, acceptance, project truth maintenance |
| Global / Runtime Engineer | KimiCode | Cross-module implementation, shell/runtime work, complex local integration, broad repairs |
| Backend / Integration Engineer | Claude Code | Host/backend, adapters, protocols, process/service integration, focused repairs |
| Product UI Engineer | Cursor | Product UI implementation, information architecture, presentation repairs |
| Independent Verifier | Codex | Adversarial review, independent verification, exact-ref evidence, regression / negative cases |
| DSH Native Specialist | DSH Creator Mode | DSH-native APIs, plugin/slot/provider/session inspection and integration |
| Visual / Product Acceptance | User + ChatGPT | Real screenshots/operation evidence, visual hierarchy/usability judgment, final product acceptance |

## 3. Assignment rules

1. Architecture and acceptance authority stays with the Chief Architect / PM; implementation Harnesses do not self-authorize architecture changes.
2. Independent Verifier does not repair the implementation it is currently verifying. Findings become a separate repair task.
3. Product UI Engineer does not receive screenshot-reading or visual-judgment tasks. User supplies screenshots; ChatGPT converts findings into text implementation instructions.
4. DSH Native Specialist owns questions that require actual DSH runtime/Creator Mode inspection; do not ask another Harness to guess DSH seams.
5. If a default Harness is unavailable or clearly weaker for a WorkPackage, substitute the binding while preserving the Role and Frozen Contract.

## 4. Proven operating pattern inherited from req-to-page

The repository history demonstrates a useful split:

- KimiCode handled high-density Runtime / backend projection and stabilization work.
- Claude Code handled backend / transport / bridge implementation and focused repair work.
- Cursor handled static/product UI implementation and visual-presentation repairs.
- Codex carried evidence-only independent functional/adversarial verification.
- ChatGPT / Architecture Lead kept phase gates, exact refs and final acceptance separate from Agent self-report.

Arckeep adopts the operating pattern, not req-to-page's business/domain assumptions.

## 5. WorkPackage contract template

Every significant WorkPackage should state at least:

- Parent Phase / Issue
- Owner Role
- Default Harness
- Architecture / Product Reviewer
- Exact baseline SHA
- Expected branch/worktree
- Goal
- Required scope
- Forbidden scope
- Acceptance evidence
- STOP / exception conditions

Implementation should not begin when the baseline or contract is ambiguous.
