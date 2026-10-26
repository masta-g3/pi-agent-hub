# Board consistency

**Feature:** ui-polish-007 → Board consistency
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-007-c9dddc6152d1/pi-agent-hub on `ui-polish-007`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique finding 14)
**Depends on:** ui-polish-004

## Goal

The workflow board speaks the same visual language as the fleet: same workflow grid, lane headings that outrank group headings, no repeated group badges.

## Current (160 columns)

```
── EXECUTE                                                       ·3      ← lane heading dim
data                                                          ◐1 ·1      ← group heading bright accent
  · ? ◐ [data] Migration boundary          ✓ PL─● EX─· RV─· RF─· CM · 6m ← inline rail + repeated [data]
2 backlog/archived · S projects
```

## Proposed

```
── EXECUTE 3                                       PL  EX  RV  RF  CM
   data                                       ?1
 ▌?  Migration boundary                    6m      ✓   ◉   ·   ·   ·
     #data-014 · Split ingest from transform stage
2 backlog/archived · S Fleet
```

## Confirmed decisions

- Board rows use the fleet workflow grid cell (`fleetWorkflowCell` or a shared extraction of it) instead of the inline compact rail. The board uses one step vocabulary for canonical lanes (`projectBoardRows`), so each canonical lane header prints the column labels like a fleet tier header. In `OTHER ACTIVE`, compatible rows use the grid; incompatible pipelines keep an explicit current-step label (same rule as the fleet).
- Lane heading is the strongest heading: tier-tone bold label with the count beside it (`EXECUTE 3`, matching ui-polish-005 tier headers). Group subheading uses `muted` (not accent), indented under the lane.
- Cards under a group subheading do not repeat the `[group]` badge.
- Group subheading counts: show the attention count with the attention glyph only when > 0 (`?1`); drop the parent count `·1` (the lane count already says it).
- Board footer `S projects` → `S Fleet`.
- No change to lane membership, ordering, collapse/disclosure, progress bars (board-only), or keyboard/mouse behavior.

## Context Files

- Core: `src/tui/layout.ts` (`rowRightAdornment` :1365, `railFull` :1414–1422, board continuations :995–1012, `fleetWorkflowCell` :1295–1305, grid header :602–641, `sectionHeader` :1509–1515, group subheader :645–648, `groupBoardCounts` :456, board footer :738–743, badges :1604–1605), `src/tui/render-model.ts` (`projectBoardRows` :725–771).
- Tests: `test/render-model.test.ts` (board), `test/cockpit.test.ts`, workflow-board tests (grep `grouping: "stage"`), `test/fixtures/cockpit-frames.ts`.
- Reference: AGENTS.md workflow board rules, docs/STRUCTURE.md board geometry.

## Reuse

- Extract nothing new unless `fleetWorkflowCell` cannot be called from the board path; if extraction is needed, move the shared part, do not copy it. Delete `railFull`/compact rail code if no other caller remains.

## Implementation Phases

### Phase 1: Grid on the board
- [ ] Tests: canonical lane header shows step labels; board card grid cells align under them at 120 and 160; OTHER ACTIVE incompatible row shows a current-step label.
- [ ] Implement; remove the inline rail path if unused.

### Phase 2: Heading hierarchy and badges
- [ ] Tests (theme): lane label bold in tier tone with count beside it; group subheading muted; cards under a group subheading have no `[group]` badge; subheading shows `?n` only when attention > 0.
- [ ] Tests: board footer reads `S Fleet`.
- [ ] Implement.

### Phase 3: Docs
- [ ] Update AGENTS.md board rules and docs/STRUCTURE.md if they describe the rail or badges.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] Board cards show workflow position with the same grid as the fleet, aligned under lane header labels; incompatible pipelines show a step label (tests).
- [ ] Lane headings are bold tier-tone with count; group subheadings are muted; no repeated `[group]` badges (tests).
- [ ] Board footer says `S Fleet` (test).
- [ ] Lane membership, order, disclosure, and progress bars are unchanged (existing tests pass); `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- AGENTS.md workflow board rule, docs/STRUCTURE.md, docs/FEATURES.md board section.
