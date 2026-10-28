**Feature:** new-session-ux-006 → Collapsed tier reveal
**Session:** 01a17fbc-7578-740f-a631-c9f773d685a2
**Worktree:** none (`main`)
**Discovered from:** new-session-ux-005

# Show revealed sessions inside collapsed tiers

No plan file: small bug fix executed directly from the ticket.

## Problem

A palette jump to a session in a collapsed Status tier selected a row that never rendered. `buildDashboardProjection` kept the revealed tree, but `cockpitSectionsForSessions` emptied every collapsed tier's groups. Archived reveals worked only through a workaround that passed `filterActive: true`.

## Change

- `src/tui/render-model.ts`: a collapsed tier keeps its group when the projection passed rows through (`collapsed && !filterActive && !sectionSessions.length ? []`). The header stays folded; only the revealed tree shows.
- Removed the Archived-reveal special case from both `filterActive` call sites; the general rule covers it.
- A revealed waiting owner is visible, so the 005 `◐ N unread` count excludes it.

## Verification

- New test in `test/render-model.test.ts`: reveal a subagent in collapsed QUIET; the folded section renders parent and child with row targets and omits the other quiet session. Failed before, passed after.
- `npm run typecheck` clean; `npm test` 1307/1307; code-critic found no issues.

## Reflection

No guidance changes: existing FEATURES.md text already promised palette reveal.
