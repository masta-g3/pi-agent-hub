**Feature:** ticket-identity-004 → Ticket identity, title, and unlinking
**Worktree:** `agent-work/worktrees/ticket-identity-004/pi-agent-hub`
**Branch:** `ticket-identity-004` from `main`
**PR target:** `main`

## Product decisions

- Keep Pi session title independent from producer ticket identity.
- Workflow `ticketId` wins over generic context `ticket.id`.
- Matching generic context supplies subtitle and description.
- Unlink is an explicit Hub action that sends `/wf-clear` to the exact live session.
- The producer clears workflow and generic ticket metadata. Hub does not edit Pi conversation history.
- Fork-and-compact continues to ignore inherited ticket metadata and reset the new title to the primary repository basename.

## Implemented

- Added `src/core/ticket-identity.ts` as the shared pure canonical ticket projection and searchable fields.
- Reused the projection in render rows, workspace/search/filter paths, and sidebar pane chrome.
- Added the palette/workspace **Unlink ticket** action with live/main/ticket/send-transport guards.
- Routed unlink through the existing exact-session message transport.
- Preserved session title and session record after unlink; metadata disappears after a fresh producer heartbeat confirms the clear.
- Added regression coverage for precedence, search, availability, exact `/wf-clear` dispatch, session preservation, and pane chrome conflicts.
- Updated `docs/CONFIG.md`, `docs/FEATURES.md`, and `docs/STRUCTURE.md` with the identity and clear protocol.

## Verification

- `npm run typecheck` passed.
- `npm test` passed: 893 tests, 0 failures.
- `git diff --check` passed.
