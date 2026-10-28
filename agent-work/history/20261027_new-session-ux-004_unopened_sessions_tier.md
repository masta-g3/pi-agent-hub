**Feature:** new-session-ux-004 → Unopened sessions tier
**Session:** 01a17fbc-7578-740f-a631-c9f773d685a2
**Worktree:** none (`main`)

# Unopened sessions tier

## Problem

New and forked sessions got lost. They started in ACTIVE, then moved to QUIET after their first turn; the user keeps both collapsed. The `new` badge expired after 60 seconds.

## Decisions

- Status fleet tier **NEW** for unopened Active-lifecycle parents. Always expanded, never persisted as collapsed.
- Order and precedence: NEEDS YOU, HEALTH, NEW, ACTIVE, QUIET, ARCHIVED. Attention, error, and Archived outrank NEW. Backlog parents and subagents are never NEW themselves; subagents inherit their owner's tier.
- Signal: optional registry field `ManagedSession.unopened: true`, set by `createSessionRecord` (create and fork). `markInteracted` clears it on the user's first open, pin focus, answer, or send. `lastActivityAt` was rejected because heartbeats also advance it. Rows without the field are never NEW, so no migration.
- Opening counts as seeing; create and fork only select and reveal.
- The `new` badge follows the same flag with no expiry. It is hidden under the Status NEW heading (outside pin mode) and shown in Repo grouping, the board, pin mode, and higher Status tiers.
- NEW chip uses accent tone and drops after ACTIVE, before HEALTH. Evidence reads "not opened yet".

## Implementation

- `src/core/{types,registry,status}.ts`: flag, set on create, cleared by `markInteracted` (via `updateSession` so `updatedAt` advances).
- `src/tui/render-model.ts`: `"new"` tier, `unopened` placement, `isUnopened`, shared `alwaysExpanded()`, `RenderSession.unopened` replaces `fresh`; `FRESH_SESSION_MS` removed.
- `src/tui/layout.ts`, `sessions-view.ts`, `status-evidence.ts`: tone, label, chip drop order, navigation order, evidence text.
- Review fix: `src/app/side-pane-lifecycle.ts` gained a `touchSession` dependency called in `revealAndAcknowledge` and on observed active-pin changes, so mouse, spatial, and hidden-pin-handoff focus also clear NEW. New pin creation does not.

## Verification

- `test/unopened-sessions.test.ts` (flag lifecycle, heartbeat refresh plus reload, tier placement, always expanded, badge per view), plus updates to tier-order, chip, badge, coaching, and side-pane tests.
- `npm run typecheck` clean; `npm test` 1283/1283.
- Installed globally together with the uncommitted `split-view-012` follow-pane work that was already installed (combined staging 1299/1299). Evidence is in `agent-work/tickets/new-session-ux-004/`.

## Follow-up

- `new-session-ux-005` Quiet unread count: finished replies hide in a collapsed QUIET.
