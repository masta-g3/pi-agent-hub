# Action workspace cleanup

**Feature:** cockpit-011 — Action workspace cleanup
**Completed:** 2026-08-29
**Worktree:** none

## Goal

Make the selected-session workspace answer two questions at a glance: what is this session doing, and what action should the maintainer take? Remove default-state narration, duplicate status, internal provenance labels, and empty blocks. Keep technical evidence available through `i` in the same workspace.

## Final behavior

The workspace uses one positive-only hierarchy at sidebar and full-screen widths:

1. session identity and runtime status;
2. compact ticket and group metadata;
3. explicit producer request when present;
4. complete task subtitle, or description when no subtitle exists;
5. plain workflow position when present;
6. exceptional guidance when it changes a decision;
7. catalog-owned actions with one `▸` primary action;
8. optional `LIVE DETAILS` appended after normal content.

Missing categories render no rows. Routine running, idle, Backlog, Archived, and selected-subagent states do not add generated advice. The workspace does not render separate state, context, workflow, or tree blocks.

## Implementation

- Changed workspace command selection from mandatory recommendations to optional guidance.
- Aligned guidance with the first available action: Details for errors, Restart for stopped sessions, Open for ready handoffs, and Send text for questions or blockers.
- Renamed `Explain status` to `Details` and made stopped/error Open descriptors display `Restart`.
- Rebuilt the action workspace around conditional identity, request, task, workflow, guidance, actions, and evidence content.
- Removed the second full-screen `WORKSPACE` header and retained exact command row targets.
- Reused the same renderer for the compact pinned decision strip.
- Kept one action label bound to one exact command target per actionable row.
- Made short-height compaction preserve identity, the primary action, and requested evidence, then use remaining capacity for decision content and additional evidence.
- Kept result evidence for exceptional runtime and placement causes while suppressing routine tautologies.
- Shortened TUI evidence labels without changing shared CLI evidence semantics.

## Review corrections

- Fixed a pinned-strip row that displayed both Open and Actions while targeting only Open.
- Removed the pinned strip's duplicate status and empty-request grammar.
- Centralized exceptional result-evidence relevance in `status-evidence.ts`.
- Used spare compact rows for more requested evidence.
- Prevented dangling task fragments by preferring the complete subtitle instead of concatenating subtitle and description.
- Suppressed exceptional guidance when its matching primary action is unavailable.
- Replaced stale workspace wording in user and architecture documentation.

The final code-critic and docs-critic passes returned `LGTM`.

## Verification

- Full test suite: 818 passed, 0 failed.
- Focused workspace tests: 318 passed, 0 failed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Functional terminal validation covered 34-cell, 44-cell, full-width, explicit-request, error, stopped, Details, short-height, pinned-strip, and exact mouse-target states.

## Files

### Runtime

- `src/tui/dashboard-commands.ts`
- `src/tui/layout.ts`
- `src/tui/sessions-view.ts`
- `src/tui/status-evidence.ts`

### Tests

- `test/dashboard-commands.test.ts`
- `test/fixtures/cockpit-frames.ts`
- `test/render-model.test.ts`
- `test/sessions-view.test.ts`
- `test/status-evidence.test.ts`

### Documentation

- `AGENTS.md`
- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`

## Discovered work

None.
