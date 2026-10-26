# Header tier chips

**Feature:** ui-polish-005 → Header tier chips
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-005-3ef8d264b516/pi-agent-hub on `ui-polish-005`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique finding 7; user decision 2026-10-25)
**Depends on:** ui-polish-004, ui-polish-002 (002 owns summary vocabulary; this ticket only adds chips)

## Goal

Remove the mouse-only tier navigator column. The header summary becomes clickable tier chips. Each tier header shows its count beside the label.

## Current

```
│FLEET                                             9 sessions · 3 needs you · 1 health│
│TIERS          │─│ NEEDS YOU                        ·3  PL  EX  RV  RF  CM│
│NEEDS YOU     3│▌│ ?  Checkout flow ...
│HEALTH        1│
```

## Proposed

```
│FLEET              NEEDS YOU 3 · HEALTH 1 · ACTIVE 2 · QUIET 2 · ARCHIVED 1 · 9 sessions│
│── NEEDS YOU 3                                          PL  EX  RV  RF  CM│
│▌?  Checkout flow ...
```

## Confirmed decisions

- Delete `renderTierNavigator`, navigator width allocation, `navigatorRowTargets`, `navigatorWidth`, and the navigator mouse path. The list gets the reclaimed columns. The workspace width rule (34 at 120–159, 44 at 160+) and its 120 threshold are unchanged.
- In Status fleet grouping (project grouping, not board, not pin mode), the header summary shows tier chips in tier order, using tier names and owner counts from `model.cockpitNavigation`: `NEEDS YOU n`, `HEALTH n`, `ACTIVE n`, `QUIET n`, `ARCHIVED n`, then `N sessions`. Zero-count chips are hidden (current rule). Colors: each chip uses its tier tone (as the tier header does).
- Each chip is a mouse target that calls the existing `jumpToCockpitTier` (same behavior as a navigator click: select/reveal that tier). Single click only. No new keys.
- Width fitting: keep `N sessions` and NEEDS YOU/HEALTH chips longest; drop QUIET, ARCHIVED, ACTIVE first (in that order) when space runs out. Phone widths keep today's summary behavior but use chips if they fit.
- Board mode, Repo grouping, and pin mode keep a non-interactive summary (today's text, with ui-polish-002 vocabulary).
- Tier headers show the count after the label: `── NEEDS YOU 3`; remove the right-side `·N`. Workflow column labels stay right-aligned.
- AGENTS.md: replace "Keep the tier navigator Status-only and mouse-only" with the header-chip rule; STRUCTURE.md navigator geometry text is replaced.

## Context Files

- Core: `src/tui/layout.ts` (`renderTierNavigator` :251–266, width :130–134, `navigatorRowTargets` :181–194, `renderTopSummary` :404–429, summary placement :157, `sectionHeader` :1509–1515, tier header count :614–641), `src/tui/sessions-view.ts` (navigator mouse :1408–1414, `navigatorRowTargets`/`navigatorWidth` fields), `src/tui/render-model.ts` (`cockpitNavigation`).
- Tests: `test/sessions-view.test.ts:1352–1406`, `test/render-model.test.ts:1547–1569`, `test/cockpit.test.ts`, `test/fixtures/cockpit-frames.ts`, `test/mouse.test.ts`.
- Reference: `src/tui/mouse.ts`, footer tap-target pattern (`footerItems` in sessions-view.ts) for per-item hit ranges.

## Reuse

- Hit testing: follow the footer's per-item column ranges (`footerItems`) for chip ranges on the summary row. Jump: `jumpToCockpitTier`. Counts: `cockpitNavigation`.

## Implementation Phases

### Phase 1: Chips and tier header counts
- [ ] Tests: Status fleet at 160 renders chips in tier order with counts; zero tiers hidden; at 80 lower-priority chips drop first and the line fits.
- [ ] Tests: clicking each chip's column range selects that tier like the old navigator click (port the navigator tests at sessions-view.test.ts:1352–1406 to chips, including filtered/orphan cases).
- [ ] Tests: tier header reads `NEEDS YOU 3` (count beside label), workflow labels still right-aligned.
- [ ] Implement chips, hit ranges, and header count.

### Phase 2: Remove navigator
- [ ] Tests: no `TIERS` column at 100/120/160; list starts at the frame inset; list width increases by the old navigator width.
- [ ] Delete navigator rendering, width, targets, and mouse path; remove obsolete tests.
- [ ] Board/repo/pin summaries stay non-interactive (test: click on summary does nothing there).

### Phase 3: Docs
- [ ] Update AGENTS.md (navigator rule → chips) and docs/STRUCTURE.md (navigator geometry → chip hit ranges); update cockpit frame fixture.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] No tier navigator column renders at any width (test).
- [ ] In Status fleet, the header shows tier chips with owner counts in tier order, hiding zero counts and fitting the width (tests at 80/120/160).
- [ ] Clicking a chip jumps to that tier exactly as the navigator did, including filtered and orphan cases (ported tests).
- [ ] Tier headers show the count beside the label (test).
- [ ] Board, Repo, and pin summaries are not clickable (test).
- [ ] AGENTS.md and STRUCTURE.md describe chips instead of the navigator; `npm test` passes.

## Discovered Work

- Possible follow-up (not in scope): lower the side-workspace threshold now that the list has more room.

## Reflection Candidates

- AGENTS.md TUI Rules (navigator → chips), docs/STRUCTURE.md geometry, docs/FEATURES.md fleet header description.
