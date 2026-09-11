# Functional validation

Date: 2026-09-10
Result: PASS

## Isolation and source integrity

- Reviewed `run.mjs`, `provider.ts`, `tui.mjs`, and `retry.mjs` before execution.
- The fixtures use Pi 0.85.1 with a deterministic zero-cost provider. The provider blocks `globalThis.fetch`.
- Each run uses a fresh private `HOME`, `PI_CODING_AGENT_DIR`, `PI_AGENT_HUB_DIR`, Pi session directory, project directory, and tmux socket under `/tmp`.
- The scripts target this worktree's existing `dist` and the matching Rules worktree. They do not rebuild or edit either source tree.
- SHA-256 checks before and after each scenario confirmed that every source conversation was unchanged. Fork startup used a distinct conversation file.
- Successful prepared conversations contained the producer reset marker, removed inherited workflow task/execution fields and Hub ticket/attention, and resumed without another provider call.

## Real Pi / extension API scenarios

Executed copied scripts in a fresh temporary directory, in this order:

1. `node run.mjs` — PASS
   - Hub-first extension order: ready, compacted (`acb2a9d8-c66d-4c3c-a7c8-8a6a1482ad77`).
   - Rules-first extension order: ready, compacted (`03dec1dc-7f4e-4be6-adeb-bd32cdf98a2b`).
   - Short history: ready, `not-needed`; no model request.
   - Model failure: terminal error, `Summarization failed: Deterministic provider failure`.
   - Producer cancellation: terminal error, `Compaction cancelled`.
   - Missing producer extension: terminal error, `Task reset was not confirmed; update the workflow extension or retry`.
   - Delayed provider: remained in `compacting` after 15.5 seconds; full two-call compaction took 34,007 ms and then became ready.
2. `node tui.mjs` — PASS
   - Dashboard showed the new child as `Compacting`.
   - Exact-title palette navigation selected `Other` while compaction continued.
   - CLI start of the preparing child was blocked. A different fixture session started and accepted `fixture unrelated prompt` while the child stayed in `compacting`.
   - Dashboard quit/restart did not interrupt preparation. Child `4d751998-96e0-4ae3-b09d-859a8363dbd0` later became ready and compacted.
3. `node retry.mjs` — PASS
   - Dashboard displayed `Preparation failed` and `Open to inspect` after the deterministic model error.
   - `Retry preparation` retried the live failed child after confirmation.
   - Retry kept the same child and Pi conversation, created a new attempt ID, did not add a registry row, preserved the source, and became ready/compacted (`a3b953fe-98ae-49b7-b717-67c1667b3851`).

All script assertions passed. Both private tmux servers reported no server running after cleanup.

## Final automated checks

- `npm test`: 934 Hub tests passed.
- Rules `env -u PI_AGENT_HUB_PRIMARY_CWD uv run --with pytest pytest -q tests/test_workflow_runtime.py`: both wrappers passed.
- `npm run package:check`: passed, run sequentially after the Hub tests.
- Both worktree diffs passed `git diff --check`.
- After the real-process run, focused regressions tightened old-attempt shutdown rejection and finalizer/checkpoint failure handling. The full suite passed with those checks included.
- No installed package or deployed Rules extension was changed.

## Review verification

- Failing-first regressions confirmed missing row-version advances, destructive normal-fork cleanup, malformed operation-phase acceptance, and deferred launch after an explicit stop.
- `npm test`: 937 tests passed after fixes. The final narrow normal-fork guard adjustment then passed 37 focused lifecycle, heartbeat, and preparation tests, including TypeScript compilation.
- Rules wrapper suites: both passed again.
- Second code-critic pass: LGTM.
- Both worktree diffs passed `git diff --check`. Review did not deploy, commit, archive, or change the backlog.
