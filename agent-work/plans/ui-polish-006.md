# Dense one-line rows

**Feature:** ui-polish-006 → Dense one-line rows
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-006-22ef16f246c9/pi-agent-hub on `ui-polish-006`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique finding 8)
**Depends on:** ui-polish-005

## Goal

Add one more rung to the adaptive card ladder: when two-line Active parent rows would not fit the list height, unselected Active parents collapse to one line before the list scrolls. Richer rungs are unchanged.

## Current (160×44, 23 sessions)

The selected owner gets the rich card; other Active parents use two lines (title line, then `[group] · age` plus the workflow grid). About 17 sessions fit; the rest scroll. The right side of every title line is empty.

## Proposed rung

```
│── ACTIVE 6                                              PL  EX  RV  RF  CM│
│▌⠹  Dashboard polish ⎇                                                      │  ← selected keeps its card
│    [core] ⚙1 3/8 tasks · 8m                              ✓   ◉   ·   ·   · │
│    Taller fleet cards with activity                                        │
│ ●  Auth token refresh                     core · 23m                       │  ← one line
│ ●  Perf budget CI                         core · 1h      ✓   ✓   ✓   ✓   ◉ │
│ ○  Search tuning                          product · 14m                    │
```

## Confirmed decisions

- Rung order (richest first): current rich cards → current two-line rows → new one-line rows → scroll. The choice is automatic from content height versus list height; no setting, no persisted state.
- One-line row content: state glyph, title (bold), trailing worktree/new markers (from ui-polish-004), then right-aligned `group · age` in `muted` and the workflow grid cell in the same columns as the tier header labels. When width is tight, drop `group` first, then age; the grid keeps its columns while a readable title fits (reuse the existing tail-retention ladder).
- Applies to unselected Active fleet parents (Status and Repo grouping) at widths ≥61. The selected owner keeps the richest rung that fits. Backlog/Archived single-line rows and subagent micro rows are unchanged. Phone widths keep their current rules. Board is out of scope.
- The existing short-height one-line mode (`width < 100 && height < SHORT_FLEET_HEIGHT`) should be unified with this rung if it is the same row shape; remove the duplicate path rather than keeping two one-line renderers.
- Mouse: one-line rows are one hit target per session (no continuation rows).

## Context Files

- Core: `src/tui/layout.ts` (`adaptiveRowShape` :479–483, `pushRow` :552–575, rich-tree/spacer logic :523–530, 651–654, `SHORT_FLEET_HEIGHT` :13, `fleetWorkflowCell` :1295–1305, title row :1533+), `src/tui/render-model.ts` (`compactRows` :672).
- Tests: `test/compact-fleet.test.ts`, `test/fleet-cards.test.ts`, `test/phone-layout.test.ts`, `test/render-model.test.ts`, `test/mouse.test.ts`.
- Reference: AGENTS.md TUI Rules (adaptive hierarchy), docs/STRUCTURE.md (responsive geometry, windowing).

## Reuse

- Reuse `fleetWorkflowCell()` for the grid, the existing title-row builder, and the existing windowing/fit measurement that already picks between rich and two-line rows. Add the rung inside that decision; no parallel renderer.

## Implementation Phases

### Phase 1: Rung selection
- [ ] Tests: 30 Active sessions at 160×44 — unselected parents are one line, the selected owner keeps its card, and all parents fit without scrolling where 30 + card lines ≤ list height. With 8 sessions at 160×44, rows stay at their current richer rung (no regression).
- [ ] Tests: the rung changes only when two-line rows overflow (boundary test at exact fit ±1 row).
- [ ] Implement the rung in the existing fit decision.

### Phase 2: One-line content
- [ ] Tests: one-line row contains title, `group · age`, and grid cells aligned under tier header labels at 120 and 160; at 80, group drops before age; title remains readable (minimum width rule).
- [ ] Tests: mouse click on a one-line row selects that session; no continuation targets.
- [ ] Implement; unify or remove the short-height one-line path if identical.

### Phase 3: Docs
- [ ] Update AGENTS.md adaptive-hierarchy sentence and docs/STRUCTURE.md ladder description.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] When two-line rows would overflow, unselected Active parents render as one line with title, group·age, and aligned workflow grid; the selected owner keeps its card (tests at 120/160).
- [ ] When two-line rows fit, rendering is unchanged (regression test).
- [ ] One-line rows are single mouse targets (test).
- [ ] Only one one-line row renderer exists (code review + tests for the former short-height case still pass).
- [ ] AGENTS.md and STRUCTURE.md describe the rung; `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- AGENTS.md TUI Rules (adaptive hierarchy), docs/STRUCTURE.md (ladder), docs/FEATURES.md (density).
