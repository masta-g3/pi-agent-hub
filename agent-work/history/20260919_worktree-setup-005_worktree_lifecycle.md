# Worktree lifecycle

## Outcome

Implemented a cross-repository worktree lifecycle for Pi Agent Hub and Rules.

- Rules creates or explicitly registers agent-owned worktrees in a configurable external root.
- Workflow metadata binds to the exact durable worktree record and reads ticket and plan state from its authored root.
- Rules publishes optional producer-neutral lifecycle metadata through the existing Hub context bridge.
- Hub derives active state from its canonical mappings, retains only partial or terminal evidence, and never grants ownership controls from producer metadata.
- Hub Finish and Discard retain one stopped Archived parent with cleanup evidence instead of deleting the session record.
- The dashboard uses compact lifecycle markers and shows detailed per-repository evidence in the existing action workspace.

## Ownership and state model

Hub-owned and Rules-owned worktrees stay independent.

- Hub-owned worktrees remain under Hub's existing state root and Finish/Discard operations.
- Rules-owned worktrees use one external `worktree.json` record under `AGENT_WORKTREES_DIR`, defaulting to `~/.local/share/agent-worktrees`.
- Existing worktrees are registered only by explicit path. The helper does not scan, migrate, infer, or move them.
- Producer lifecycle metadata is optional. Hub works without Rules, and Rules works without Hub.
- Workflow completion, merge or discard outcome, directory cleanup, and branch deletion are separate facts.

Lifecycle states are:

- `active`
- `awaiting-merge`
- `cleanup-pending`
- `check-needed`
- `cleaned`

A cleaned repository requires finite verification evidence. Producer reset tombstones retain producer and record identity with a newer revision so stale data cannot resurrect cleared state.

## Rules implementation

Added `skills/_lib/worktrees.sh` and dependency-free `worktrees.py` operations for create, register, inspect/verify, state changes, and removal.

The durable record includes exact source and worktree paths, branch and integration target, primary/additional role, authored root, lifecycle state, revision, outcomes, issues, artifact dispositions, and verification timestamps. Writes are atomic and serialized by a per-record file lock.

Safety rules include:

- source and worktree paths must equal canonical Git top-level roots and remain distinct;
- repositories in one record cannot share a Git common directory;
- the durable record must remain outside every managed worktree and source repository;
- mappings must match Git registration, common directory, and expected branch;
- cleanup uses ordinary verified `git worktree remove`, without force, stash, broad deletion, or branch `-D`;
- every untracked or ignored artifact root needs one exact `dispose` or verified external `preserve` decision;
- tracked paths, traversal, `.git`, root paths, and symlink-parent escapes are rejected;
- partial cleanup preserves completed repository evidence, immutable outcome, and prior artifact decisions;
- surviving source ticket and archived plan pointers are verified before deletion.

The workflow runtime persists only the exact record path. It rereads the authoritative ticket and current `plan_file`, publishes lifecycle snapshots with stable `producer: rules` identity and monotonic revisions, rejects stale asynchronous reads after rebinding, and reports broken bindings as `check-needed` without falling back to the source checkout. Ticket unlink, task replacement, workflow completion, fork/reset, and lifecycle cleanup remain independent.

Plan, Execute, Commit, and orchestrator guidance now use the exact external helper and distinguish Hub ownership from Rules ownership.

## Hub implementation

Extended the existing generic context parser with an independently validated optional worktree snapshot. Malformed lifecycle data is omitted without hiding valid ticket, attention, or liveness data.

Controller retention requires:

- matching current Pi conversation identity;
- rejection of the outgoing identity during restart-new;
- stable producer and record identity;
- monotonic revision;
- persisted reset tombstones that remain hidden from rendering.

Hub-owned active lifecycle is derived from `ManagedSession.worktrees`. Stored lifecycle evidence is used only when mappings cannot represent partial or terminal history.

Finish and Discard now:

1. preflight cleanliness before stopping tmux;
2. process additional repositories before the primary repository;
3. retain stage-aware merge, removal, branch and failure evidence;
4. reload the latest exact parent cascade after Git work;
5. stop and verify current tmux targets;
6. reject mapping, cascade, or genuine restart conflicts while preserving harmless concurrent title, group, heartbeat, and version updates;
7. retain the parent as stopped and Archived with source-root cwd values;
8. remove obsolete child rows, workspaces, heartbeats, and name commands while preserving Pi conversation files.

Partial failure keeps completed repository history and unresolved canonical mappings. Ordinary Delete and archive pruning remain unchanged.

## Dashboard

The established worktree marker position now shows:

- `⎇` active
- `⎇…` awaiting merge
- `⎇!` cleanup or verification needed
- `⎇✓` cleanup verified

Markers use a fixed display width. The existing action workspace shows owner, branch, source and worktree paths, per-repository state, outcome, verification age, retained branch, and issue text. Help and feature documentation distinguish verified directory cleanup from merged/discarded outcome, branch deletion, and workflow completion.

## Verification

- Hub `npm run typecheck`: passed.
- Hub full suite: 1,031 tests passed.
- Hub package check and dry pack: passed.
- Hub review-focused lifecycle, controller, parser, render, and Git suites: 188 tests passed.
- Rules full suite: 82 tests passed.
- Rules Python compilation: passed.
- Both repository diffs passed `git diff --check`.
- Temporary Git integration verified external creation, authoritative worktree plan progress, Rules-to-Hub `awaiting-merge`, verified removal, and cleaned read-back.
- Final cross-repository critic returned PASS after the last closeout-race and durable-record-placement fixes.

## Boundaries

This work did not install or reload live applications, migrate existing worktrees, alter unrelated sessions, add automatic discovery or cleanup, generate IDE workspaces, resolve branch conflicts, transfer ownership, or introduce a shared package. Harness availability failures that remain useful for reproduction are retained in `agent-work/tickets/worktree-setup-005/papercuts.md`.
