# Arckeep Local Multi-Agent Worktree Execution

Status: **ACTIVE PROJECT RULE**

## 1. User operating model

The user does **not** pre-create per-Agent worktrees.

For local Harnesses such as KimiCode / Claude Code, the user may do only this:

1. select/open the normal `kcc-workbench` repository folder;
2. create a new Agent session;
3. paste the WorkPackage prompt.

Therefore **workspace isolation is the executing Agent's responsibility**.

The initially selected `kcc-workbench` folder is an **entry/control repository**, not the implementation workspace for a parallel WorkPackage.

## 2. Required execution model

For every parallel WorkPackage:

`shared entry repo -> inspect/fetch -> create dedicated sibling git worktree -> change cwd to worktree -> implement/test/commit there`

Do not implement directly in the user-selected shared repository when the WorkPackage requires an isolated worktree.

Do not ask the user to manually create a worktree unless the Harness is technically unable to access/create a sibling directory.

## 3. Sibling worktree convention

Use a sibling directory of the selected repository, not a nested directory inside the existing working tree.

D0 convention:

- D0-01: `../kcc-workbench-wt-d0-01`
- D0-02: `../kcc-workbench-wt-d0-02`
- D0-04: `../kcc-workbench-wt-d0-04`

On Windows these may resolve to paths such as:

`D:\Projects\kcc-workbench-wt-d0-01`

when the selected repository is:

`D:\Projects\kcc-workbench`

The exact parent directory may vary; the invariant is that each WorkPackage gets a distinct linked Git worktree.

## 4. Mandatory bootstrap algorithm

Given:

- `BASELINE=<exact SHA from Taskbook>`
- `BRANCH=<expected feature branch>`
- `WT=<dedicated sibling worktree path>`

The Agent must:

1. Confirm the selected folder belongs to `Dylan5237/kcc-workbench` and locate the actual GitHub remote.
2. Run `git fetch <GH_REMOTE> --prune`. Never use `git pull` for bootstrap.
3. Record the entry repository root with `git rev-parse --show-toplevel`.
4. Inspect `git worktree list --porcelain` before creating anything.
5. Verify `BASELINE` exists locally after fetch.
6. Inspect whether local `BRANCH` already exists.
   - If it does not exist, create it at `BASELINE`.
   - If it exists, it must point to `BASELINE` before implementation starts and must not already be checked out by another unexpected worktree.
   - Otherwise STOP `BRANCH_STATE_CONFLICT`.
7. Inspect `WT`.
   - If absent, create the linked worktree for `BRANCH` at `WT`.
   - If already present, reuse it only when Git reports it as the expected linked worktree for the expected branch/baseline and it is safe for this WorkPackage.
   - Otherwise STOP `WORKTREE_PATH_CONFLICT`.
8. Change execution cwd to `WT`.
9. From `WT`, verify all three:
   - `git rev-parse HEAD` == `BASELINE`;
   - current branch == `BRANCH`;
   - `git status --short` is clean before implementation.
10. Only then begin product/spike work.

If exact baseline validation fails => STOP `BASELINE_MISMATCH`.

If the Harness cannot create/access a sibling worktree because of an actual filesystem/sandbox restriction => STOP `WORKTREE_ACCESS_BLOCKED` and report the required path/access. Do not silently fall back to editing the shared entry repository.

## 5. Shared entry repository safety

The user-selected root may contain unrelated local state.

Rules:

- do not `reset --hard` the shared entry repository;
- do not clean, stash, discard, or rewrite unrelated user changes;
- do not switch its branch merely to execute a WorkPackage;
- do not commit WorkPackage implementation from the shared entry repository;
- source-root dirtiness is not permission to mutate or clean it; create the linked worktree from the exact commit instead.

## 6. Parallel-session isolation

Multiple Agent sessions may all be opened by the user against the same original `kcc-workbench` folder.

That is expected.

Isolation comes from each Agent moving itself to its own linked worktree before implementation:

- Claude session A -> D0-01 worktree
- Claude session B -> D0-02 worktree
- KimiCode session -> D0-04 worktree

Agents must not read implementation changes from another WorkPackage worktree unless a later integration Taskbook explicitly authorizes it.

## 7. Commit / push / PR

Implementation commits are created only inside the dedicated WorkPackage worktree.

Push the named feature branch to the actual GitHub remote and open the PR against the Taskbook-specified integration branch.

Do not merge without Architecture Lead authorization.

## 8. Cleanup

Do not remove another Agent's worktree.

Worktree removal is not part of implementation acceptance unless explicitly instructed. Preserve accepted worktrees until integration/cleanup is authorized.
