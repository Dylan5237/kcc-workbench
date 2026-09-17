# Architecture Review Gate

Status: Normative
Applies to: KCC Workbench / Arckeep runtime implementation
Source issue: #38

## 1. Purpose

This document defines the mandatory architecture review gate for implementation changes.

The goal is to preserve three project-level qualities at the same time:

- elegant implementation;
- extreme runtime performance;
- complete product behavior.

A feature is not architecturally acceptable merely because it works functionally. Runtime placement, ownership, scheduling, isolation, boundedness, and failure behavior are part of correctness.

Issue #36 exposed the motivating failure class: background filesystem work could be functionally correct while still being placed on an interaction-critical Electron path and freeze unrelated UI surfaces. This gate exists to catch that class of defect before merge.

## 2. Governing principle

> Background or non-interaction-critical work MUST NOT have the ability to block the user interaction path.

Corollaries:

1. Electron main / UI interaction loops coordinate; they do not perform unbounded heavy work.
2. Background work must be bounded, cancellable where practical, observable, and isolated.
3. Expensive work must be placed in an appropriate Worker Thread, child process, dedicated service, or other non-blocking execution unit.
4. Every spawned runtime unit must have explicit ownership and lifecycle semantics.
5. Periodic work must be recovery-oriented and bounded; unbounded whole-tree polling is a default architecture failure.
6. Large or unusual workspaces are valid input. Performance safety must not depend on the assumption that users only open small projects.

## 3. Review trigger

Architecture review is mandatory when a PR changes one or more of the following:

- Electron main process, renderer process, WebContents/WebContentsView lifecycle;
- Worker Thread, child process, subprocess, external runtime, shell command lifecycle;
- filesystem watchers, recursive traversal, indexing, hashing, diffing, parsing, search;
- timers, polling, retry loops, queues, schedulers, background jobs;
- IPC, HTTP, SSE, WebSocket, local service boundaries;
- session/project lifecycle, process ownership, shutdown, restart, reuse, adoption;
- persistence, cache, startup work, migration, background compaction;
- security/trust-boundary runtime behavior;
- any change that can materially affect latency, memory, CPU, disk, process count, or failure isolation.

Pure documentation, visual-only, copy-only, and non-runtime metadata changes may declare `ARCH_REVIEW: N/A` with a short reason.

## 4. Mandatory review dimensions

### 4.1 Execution Topology

For every non-trivial runtime task, identify:

- process;
- thread / event loop;
- trigger;
- owner;
- lifetime;
- cancellation mechanism;
- failure domain.

The implementation MUST make clear what can block what.

### 4.2 Blocking and I/O

The reviewer must flag, unless tightly bounded and justified:

- synchronous recursive filesystem traversal on Electron main or renderer interaction paths;
- long CPU-bound loops on interaction-critical event loops;
- blocking waits or sleeps;
- unbounded JSON parsing, diffing, hashing, compression, indexing, tree construction;
- network operations without timeout/deadline;
- large synchronous serialization/deserialization in IPC handlers;
- disk work whose cost scales with workspace size and runs on a shared interaction loop.

### 4.3 Lifecycle and Ownership

Every Worker, child process, watcher, timer, queue, and external runtime must have an owner.

Review must verify:

- who starts it;
- who stops it;
- behavior on graceful shutdown;
- behavior on crash/abnormal termination;
- orphan-process risk;
- reuse/adoption semantics;
- restart semantics;
- cleanup of timers/listeners/resources;
- ownership after reuse is unambiguous.

### 4.4 Concurrency, Ordering, and Backpressure

Review must verify where relevant:

- no uncontrolled overlapping poll/work cycles;
- bounded concurrency;
- debounce/coalescing where event bursts are expected;
- bounded queue growth;
- stale-result protection, generation tokens, sequence/version checks;
- cancellation when session/project/context changes;
- race handling between startup, shutdown, restart, and navigation;
- slow consumers cannot create unbounded producer pressure.

### 4.5 Explicit Runtime Budgets

Background work must have relevant hard or soft bounds. Depending on the task, declare:

- max wall-clock slice or deadline;
- max entries/files/items;
- max bytes read/processed;
- max memory or retained state;
- max retries;
- max concurrency;
- timeout;
- queue bound;
- polling interval and overlap policy;
- cancellation condition.

A periodic task whose cost grows with the entire workspace and has no explicit bound is a blocker by default.

### 4.6 Failure Isolation

Heavy work or failure in Viewer, Kimi, CloudCLI, indexing, search, logging, snapshotting, or another subsystem must degrade that subsystem rather than freezing or terminating the whole shell unless the product explicitly requires otherwise.

Review must ask:

- what happens if this task takes 100x longer than expected?;
- what happens if the workspace has 100x more files?;
- what happens if the child process hangs?;
- what happens if the network never responds?;
- what happens if the user switches context while work is in flight?;
- what unrelated surfaces are affected by this failure?.

### 4.7 IPC and Trust Boundaries

Review must verify:

- minimal IPC surface;
- input validation at process/service boundaries;
- no auth token/cookie/secret leakage;
- no unnecessary privilege expansion;
- expensive work is not routed through Electron main merely because main owns IPC;
- renderer data is not trusted implicitly;
- local HTTP/SSE endpoints preserve existing authentication contracts.

### 4.8 Observability

Runtime-sensitive changes must expose enough privacy-safe evidence to diagnose regressions.

Where material, prefer recording:

- duration;
- item/entry count;
- queue depth;
- worker/process ownership;
- timeout/retry classification;
- cancellation reason;
- high-level error class.

Do not log secrets, auth tokens, cookies, private conversation content, or unnecessary file contents.

### 4.9 Scope Discipline

Architecture review must also reject:

- unrelated refactors bundled into the task;
- generalized frameworks not needed by the proven problem;
- replacement of mature infrastructure without evidence;
- complexity added without measurable product value;
- behavior changes disguised as performance refactors;
- product-contract changes without explicit architecture/product approval.

## 5. Electron-specific default rules

For the current KCC/Arckeep Electron runtime:

### Electron main process SHOULD contain

- window/view lifecycle coordination;
- lightweight routing/orchestration;
- lightweight IPC validation and dispatch;
- process/worker ownership management;
- small configuration/state transitions.

### Electron main process SHOULD NOT contain

- recursive workspace scans;
- large synchronous filesystem traversal;
- heavy diff/index/hash/search work;
- unbounded parsing/serialization;
- periodic work with cost proportional to workspace size;
- long-running loops;
- work that can be isolated in a Worker Thread or child process.

Exceptions require explicit boundedness and evidence that worst-case execution cannot create perceptible interaction stalls.

## 6. Filesystem observation principles

Workspace observation should prefer:

1. event-driven change notification as the primary path;
2. incremental work on changed paths;
3. bounded recovery/fallback scans;
4. Worker/isolated execution for expensive traversal;
5. cancellation when workspace/session changes;
6. protection against stale scan results overwriting newer context;
7. explicit budgets independent of project size assumptions.

A wide workspace such as a user home directory is valid input. The application may enter a degraded/bounded observation mode, but MUST remain responsive.

## 7. Required PR declaration

Runtime-relevant PRs must complete the `Execution Topology` and `Runtime Budget` sections in `.github/PULL_REQUEST_TEMPLATE.md`.

The declaration is evidence input, not proof. The architecture reviewer must verify it against the diff and code paths.

If not applicable, the author must explicitly state why.

## 8. Verdict contract

The automated architecture reviewer emits exactly one top-level verdict.

### `PASS`

No architecture blocker is found.

Non-blocking notes are allowed but must not contradict PASS.

### `REQUEST_CHANGES`

Concrete architecture defects exist and can be corrected within the current task scope.

Every blocker must include:

- file/path or subsystem;
- violated rule;
- concrete failure mode;
- minimum acceptable correction;
- evidence required for re-review.

### `ESCALATE_TO_ARCH`

Escalate only when a real decision is required from the human owner + Chief Architect, including:

- product contract change;
- architecture boundary change;
- intentional exception to a hard rule;
- meaningful performance/functionality trade-off;
- scope expansion;
- conflict between normative project documents;
- a fix requiring upstream fork/patch or destructive user-state behavior.

Do not escalate merely because code is complicated.

## 9. Pre-existing issues

The reviewer must distinguish new defects from existing debt.

- Do not block a PR for an unrelated pre-existing defect it does not worsen or depend on.
- Do block a PR that expands, relies on, or makes an existing unsafe pattern harder to remove.
- Record relevant pre-existing debt as a non-blocking note with a pointer when useful.

## 10. Evidence expectations

Architecture-sensitive changes should provide evidence proportional to risk, for example:

- focused unit/integration tests;
- `npm test`;
- `npm run build` when runtime/packaging behavior is affected;
- benchmark or timing evidence for performance-sensitive work;
- real Windows Electron acceptance when the defect depends on Electron/runtime behavior;
- process/worker lifecycle evidence when ownership changes;
- large-workspace or stress fixture where data-size sensitivity matters.

Passing tests do not override an architecture blocker.

## 11. Operating flow

Normal flow:

`Implementation Agent -> tests/build/runtime evidence -> SpaceAI Grokbot architecture review -> PASS -> merge/release gate`

Only `ESCALATE_TO_ARCH` or a disputed `REQUEST_CHANGES` returns to the human owner + ChatGPT Chief Architect.

## 12. Non-goals of this gate

This gate is not responsible for:

- product prioritization;
- UX/visual review;
- rewriting the implementation;
- general code-style review;
- naming/formatting preferences without architecture impact;
- inventing new requirements not present in the task or project contract.

Its job is narrow: prevent runtime architecture, scheduling, ownership, isolation, and performance mistakes from reaching the product.
