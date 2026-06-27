# Archive/backlog sessions

Implemented dashboard-only lifecycle buckets for managed sessions:

- Added optional `ManagedSession.bucket` (`backlog` / `archived`) and `bucketChangedAt`; absence means Active.
- Added `A` Archive, `B` Backlog, and `U` Restore shortcuts, wired through the existing TUI mutation queue.
- Rendered session lists as Active, Backlog, and Archived sections when non-active rows exist, preserving group headers and user-controlled order inside each section.
- Kept all-active dashboards compact by suppressing section headers.
- Scoped group reorder/append behavior by lifecycle section so rows do not move across Active/Backlog/Archived unintentionally.
- Cascaded parent bucket moves/restores to subagent rows; direct subagent lifecycle actions are blocked.
- Added archive expiry display and 72-hour auto-pruning for archived rows.
- Made pruning safe with tri-state tmux presence: archived cascades and stale subagent rows are removed only when tmux is confirmed missing; unknown tmux failures retain rows.
- Archive pruning removes Hub registry rows, heartbeat files, session metadata, and owned multi-repo workspace state only; it never stops tmux/Pi and never deletes Pi conversation/session files.
- Reserved `A`, `B`, and `U` from custom dashboard shortcut configuration.
- Updated README, feature docs, structure docs, and project agent guidance for the new lifecycle behavior.

Validation:

- `git diff --check`
- `npx tsc -p tsconfig.json --noEmit`
- `npm test` → 377 passing
- Delegate smoke test passed for lifecycle shortcuts, sectioned rendering, footer/help copy, and conservative pruning.
