**Feature:** fork-compact-001 → Fork compact handoff
**Session:** 01a06967-b69f-796a-830e-8ea5cac9f540
**Worktree:** none
**Start branch:** main
**PR target:** n/a

## Outcome

Fork-and-compact now creates a fresh task branch while preserving useful product decisions from the prior discussion. It resets inherited Hub-visible ticket and workflow context through the existing producer-neutral startup cutoff, without adding a producer-specific `wf-clear` command.

The Hub extension passes one fixed, bounded handoff instruction to Pi compaction. The instruction says the branch continues from the prior conversation, another agent continues the prior work, discussion-only product decisions and unresolved context must be preserved, and the session must wait for a new user task.

The extension publishes a transient `fork-compact` heartbeat operation with `running`, `complete`, or `error` phases. Compaction uses Pi's `customInstructions`, `onComplete`, and `onError` API. Runtime status is `running` during compaction and returns to the prior state after completion.

`forkManagedSession(..., { compact: true })` waits for a valid completion heartbeat from the exact child session. It uses a bounded timeout, reports errors clearly, and leaves the child session running for inspection on timeout or failure. Normal forks remain start-only. Group, bucket, ordering, cwd, and other unrelated lifecycle state are unchanged.

## Implementation

- Added `HeartbeatOperation` typing and independent bounded heartbeat parsing.
- Updated extension compaction lifecycle and metadata reset handling.
- Added lifecycle completion polling through `readHeartbeat`.
- Added extension, heartbeat, and lifecycle regression coverage.
- Updated `docs/STRUCTURE.md` and `docs/FEATURES.md`.

## Verification

- `npm run typecheck`
- `git diff --check`
- `npm test` — 886 tests passed.
