**Feature:** new-session-ux-005 → Quiet unread count
**Session:** 01a17fbc-7578-740f-a631-c9f773d685a2
**Worktree:** none (`main`)

# Unread count on collapsed tier headers

## Problem

A finished reply without an explicit request leaves its session `waiting` (yellow `◐`) in QUIET, or in ACTIVE while a subagent runs. The user keeps both collapsed, so the reply was invisible.

## Decisions (user-confirmed)

- Signal: a parent owner with display status `waiting`, the same rows that show the yellow `◐`. No new state.
- Count parent owners only; waiting subagents never count.
- Status view ACTIVE and QUIET headers only. Not HEALTH, ARCHIVED, NEEDS YOU, NEW, Repo view, the board, or the top FLEET chips.
- Only while collapsed and the rows are actually hidden.
- Right-side header slot, warning tone, `◐ N unread`.

## Implementation

- `src/tui/render-model.ts`: `RenderSection.hiddenUnreadCount` counts waiting parent owners in the tier that the header does not render as rows. This covers expansion, filter reveal, Archived reveal (whose bypass flag would otherwise mislead), and filter-local re-collapse without a separate gate.
- `src/tui/layout.ts`: `cockpitHeadingRight` keeps `?N child` first and fits the unread label against the list width after the full left heading, child label, separator, and gap: `◐ N unread`, then `◐N`, then omitted. The tier title is never cut.
- Docs: one sentence each in `docs/FEATURES.md` and `docs/STRUCTURE.md`.

## Verification

- `test/unread-count.test.ts`: counts, subagent exclusion, expanded/filter/zero cases, Archived reveal, filter-local fold, Repo/board absence, and widths 30–160 including pin mode (30 columns shortens to `?1 child · ◐1`).
- `npm run typecheck` clean; `npm test` 1288/1288; code-critic found no issues.

## Follow-up

- `new-session-ux-006` Collapsed tier reveal: a session revealed inside a collapsed Status tier is dropped by the section builder.
