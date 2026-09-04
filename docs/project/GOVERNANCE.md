# Arckeep Project Governance

## 1. Canonical project truth

GitHub is the cross-session project control plane.

- Command Center Issue: `#2`
- Current Phase Issue: `#3` — D0 Daily Driver
- Active integration branch: `integration/arckeep-daily-driver`
- D0 source baseline: `feature/viewer-modes@8e08efd8e35bd9d42466a0bda27631fc95b36d65`

Chat is for discussion and orchestration, not long-term project truth.

## 2. What belongs where

| Information | Canonical location |
|---|---|
| Current project / phase status | GitHub Command Center / Phase Issue |
| Work assignment and acceptance contract | WorkPackage Issue + frozen taskbook when needed |
| Implementation | dedicated branch / worktree / PR |
| Architecture decisions | `docs/architecture/` |
| Stable product contracts | `docs/product/` / `docs/contracts/` |
| Harness team policy | `docs/project/HARNESS_TEAM.md` |
| Visual authority status | `docs/design/DESIGN_STATUS.md` |
| Independent verification | verification issue / evidence report |
| Historical material | retained as history; move to `docs/archive/` gradually when useful |

Do not create ad-hoc `PROGRESS.md`, `BLOCKED.md`, or chat-only task authority for D0.

## 3. Phase lifecycle

Arckeep follows the governance pattern already validated in req-to-page:

`Contract Freeze → Implementation → Independent Verification → Architecture Lead Acceptance → CLOSED`

Rules:

1. Agent self-report is not acceptance.
2. PR merge is not phase acceptance.
3. User visual/product acceptance is separate from mechanical verification.
4. Exact baseline, exact HEAD, diff scope, tests and evidence must remain reconstructable.
5. Coding Agents do not perform screenshot interpretation or final visual acceptance.

## 4. Git / worktree discipline

- One WorkPackage normally maps to one dedicated branch/worktree/PR.
- Start from an explicitly recorded exact SHA.
- `git fetch <actual GitHub remote> --prune`; do not use blind `git pull` as project synchronization.
- Do not switch or reuse another Agent's worktree.
- If expected baseline does not match, STOP with `BASELINE_MISMATCH`.
- Architecture exceptions require an explicit STOP and review rather than silent scope expansion.

## 5. Active product vs legacy capability donor

For D0:

- `arckeep/` = active product implementation.
- `src/` = KCC Workbench v1 legacy implementation and capability donor.
- KCC Viewer is an approved donor and a required Arckeep product capability.
- Do not perform a broad KCC directory migration merely for cleanliness during D0.

The legacy tree may be archived or reorganized after the required capabilities have been adopted and First Daily Driver use has stabilized.

## 6. D0 scope discipline

D0 exists to produce a Daily Driver, not a complete platform architecture.

Required real surfaces:

- Project continuity
- KimiCode
- ClaudeCode visual workspace
- DSH workspace
- Arckeep/KCC Viewer

Deferred unless a real blocker proves otherwise:

- ATW Team Mode integration
- generalized AgentAdapter / Runtime Registry
- Domain Core redesign
- complete session unification
- complete design-system engineering
- broad KCC v1 migration
- speculative abstractions for future Team Mode

## 7. Acceptance ownership

- Mechanical / adversarial verification: Independent Verifier (default Codex)
- Architecture / product contract acceptance: ChatGPT
- Real-machine visual evidence: User
- Visual/product acceptance: User + ChatGPT

Only the Command Center and Phase Issue may declare a phase CLOSED after these gates are satisfied.
