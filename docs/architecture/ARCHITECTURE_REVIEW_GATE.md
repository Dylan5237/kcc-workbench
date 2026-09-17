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

Issue #36 exposed the motivating failure class: background filesystem work could be functionally correct while still being placed on an interaction-critical Electron path and freeze unrelated UI surfaces. The confirmed reproduction was workspace-sensitive: a small project remained responsive, while arming Viewer on a very wide but valid workspace (`C:\Users\howyo`) could make the entire shell unresponsive; once armed, background observation continued even after leaving Viewer. This gate exists to catch that class of defect before merge.

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