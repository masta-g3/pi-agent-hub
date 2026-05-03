# Delete Session

## Summary

Added a safe delete flow for managed Pi sessions. Deletion removes only pi-sessions state and the tmux process; Pi conversation/session JSONL files are intentionally preserved.

## Implemented

- Added `removeSession(registry, id)` in `src/core/registry.ts` to remove a single registry row while preserving the remaining order.
- Added `deleteManagedSession(id)` in `src/app/delete-session.ts` as the shared CLI/TUI delete path:
  - resolves full session IDs from prefixes,
  - stops the tmux session if it still exists,
  - removes the registry row,
  - removes the heartbeat file if present,
  - ignores only missing heartbeat files.
- Added `pi-sessions delete <session-id>` CLI support and help text.
- Added TUI delete confirmation:
  - `d` opens the modal,
  - second `d` confirms,
  - Esc cancels,
  - async errors remain visible,
  - repeated confirms are ignored while deletion is in flight.
- Updated the refresh loop to expose `stop(): Promise<void>` so the TUI can pause refreshes and await any in-flight tick before deleting.
- Added `SessionsController.removeSession(id)` to update in-memory registry state and keep selection on a neighboring visible session.

## Verification

- Added registry, shared delete helper, CLI delete, refresh-loop, controller, and TUI keyboard-flow tests.
- Validated with `npm test`, `npm run build`, CLI smoke using temporary state, and TUI expect smoke for confirm/cancel/delete.
