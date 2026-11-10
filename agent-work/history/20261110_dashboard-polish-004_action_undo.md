# Action undo

**Feature:** dashboard-polish-004
**Branch:** main; no worktree

## Delivered

- `z` undoes the most recent Backlog, Archive (including Done/Abandoned), Restore/Reopen, Mark read, or Move group change.
- Four-second receipts identify the affected session. Help and the action palette expose the same catalog-owned command.
- One in-memory entry survives navigation, not a dashboard restart. No redo or persistent undo state.
- Undo restores only recorded lifecycle, group/order, or acknowledgement fields, including affected children. Missing rows, replaced Pi conversations, or later edits to recorded fields reject the entire undo.
- Successful undo selects and reveals the session without opening Pi or recreating closed pins.
- `z` is reserved; test-only configured shortcut examples use `L` instead.

## Implementation

`src/core/session-undo.ts` owns pure change capture/apply. Controller mutations return their lock-protected before/after rows. Existing action wrappers pass these to the view; dialogs and direct actions record receipts. Undo uses the existing serialized registry mutation path.

## Integration and validation

- Integrated origin/main through Mission control (`bc8970b`), preserving its reserved `C` key alongside `z`.
- Updated the palette test to verify literal `z` input, then search `undo`; a short palette need not display every match for `z`.
- Original implementation recorded successful typecheck, full tests, and isolated tmux receipt/registry checks.
- Final integration checks: `npm run typecheck` passed; `npm test` passed all 1,635 tests.

## Boundaries

Global group rename, delete, restart, fork, reorder, implicit reads, and pin reconstruction remain outside undo scope. Unrelated local mockups, browser artifacts, install evidence, session exports, and the pending README demo ticket are excluded from the feature commit.
