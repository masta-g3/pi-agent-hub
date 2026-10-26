# Row hierarchy

**Feature:** ui-polish-004 → Row hierarchy
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-004-4bbe1e538d51/pi-agent-hub on `ui-polish-004`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique findings 4, 5, 9)
**Depends on:** ui-polish-003 (color roles)

## Goal

Every fleet and board title starts in the same column, each row carries one state glyph, the title is the strongest text in the card, and only the selected running row moves.

## Current

```
│ · ? ◐ ⎇  Checkout flow            ← placeholder ·, attention + status, ⎇ shifts title by 3
│ [storefront] · 1m                  ← group bold, title not bold
│ ·   ⠹ API cleanup                  ← every running row spins at 250 ms
```

## Proposed

```
▌ ?  Checkout flow ⎇                    title bold, worktree marker after the title
  [storefront] · 1m                     group in muted, not bold
  ●  API cleanup                        static ● for running, unselected
▌ ⠹  Dashboard polish                   only the selected running row animates
```

## Confirmed decisions

- Disclosure slot: show `▸`/`▾` only when the row has descendants; otherwise a space (no `·` placeholder). The slot keeps its width, so alignment holds.
- One state slot: when a row shows attention (`?`, `!`, `✓`, only for waiting/idle rows as today), that glyph occupies the state slot and the runtime glyph (`◐`/`○`) is not drawn in the row. Otherwise the runtime glyph (`●`/spinner, `◐`, `○`, `×`, `-`) occupies it. Data, tiers, workspace, and evidence keep both axes; only the row glyph is merged. The workspace header still shows the runtime label (`◐ waiting`).
- Pin glyph slot stays as today (pin mode only).
- Worktree marker (`⎇`, `⎇…`, `⎇!`, `⎇✓`) moves from before the title to after it (same placement and fitting rules as the `new` badge; marker survives truncation before `new`). The title start column is identical for all rows of the same role.
- Weight: session titles use bold `text` (`styles.strong` with text color). Group badge name uses `muted` (no bold); brackets stay decoration. Repo label `◈ name` uses `muted` name (no bold), accent `◈` unchanged. Subagent micro rows keep their current weight (secondary).
- Motion: `symbolFor` gets a `selected` flag. Running/starting rows show static `●` (success color) unless selected; the selected running row shows the spinner. The render timer requests frames only while the selected row is running/starting (`hasVisibleRunningRows` becomes "selected row animating"). Conversation's own working spinner (`conversation.ts:161`) is unchanged.
- Help "Status legend" updates: `● running (selected row animates)`.
- Board rows get the same title-line changes (same row renderer).

## Context Files

- Core: `src/tui/layout.ts` (title row :1533–1562, other titles :1581–1585, badge/marker :1591–1605, repo label :1040–1043), `src/tui/render-model.ts` (`symbolFor` :1114–1122, `toRenderSession` :641, selected flag :991), `src/tui/sessions-view.ts` (`hasVisibleRunningRows` :436–440, :515–517; help legend :2304), `src/app/run-tui.ts:772–774`.
- Tests: `test/render-model.test.ts:1756–1758` (glyph placement), `test/fleet-cards.test.ts`, `test/sessions-view.test.ts:1344–1389`, `test/compact-fleet.test.ts`, `test/phone-layout.test.ts`, `test/cockpit.test.ts`, `test/fixtures/cockpit-frames.ts`.
- Reference: AGENTS.md TUI Rules (badge fitting, independent axes), `docs/STRUCTURE.md` fitting rules.

## Reuse

- Reuse the `new`-badge fitting path for the trailing worktree marker. Reuse `styles.strong`. No new glyph table here (ui-polish-010 centralizes glyphs).

## Implementation Phases

### Phase 1: Alignment and glyph slot
- [ ] Tests: rows with and without worktree marker, with and without attention, with and without descendants have the title at the same column (strip ANSI; compare `indexOf(title)`) at 80, 120, 160, and phone 44.
- [ ] Tests: attention row shows `?`/`!`/`✓` and no `◐`/`○` on the title line; non-attention rows show runtime glyph; workspace still shows runtime label.
- [ ] Tests: worktree marker renders after the title and survives title truncation at narrow width.
- [ ] Implement the disclosure blank, the merged state slot, and the trailing marker.

### Phase 2: Weight
- [ ] Tests (with a theme): title text is wrapped in bold SGR; group name and repo label are not bold and use `muted`.
- [ ] Implement.

### Phase 3: Motion
- [ ] Tests: two running rows; only the selected one shows a spinner frame (frame changes with `now`), the other shows `●`; render-request predicate is true only when the selected row is running/starting.
- [ ] Implement `selected` in `symbolFor` and the timer predicate in sessions-view/run-tui.
- [ ] Update help legend.

### Phase 4: Fixtures and docs
- [ ] Update `cockpit-frames` fixture and affected assertions deliberately (review each diff).
- [ ] Update AGENTS.md TUI Rules lines that describe the title row (worktree marker before title → after title; `[group]` before marker) and docs/STRUCTURE.md badge-fitting text.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] Titles of rows with the same role start at the same column regardless of worktree, attention, or descendants, at 44/80/120/160 columns (test).
- [ ] An attention row shows exactly one state glyph (the attention glyph) on its title line (test).
- [ ] Session titles render bold; group and repo names render muted, not bold (test).
- [ ] Only the selected running row animates; others show static `●`; no periodic re-render when the selected row is not running (tests).
- [ ] AGENTS.md and STRUCTURE.md describe the new title-row order; `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- AGENTS.md TUI Rules (title row order, motion), docs/STRUCTURE.md (badge fitting), docs/FEATURES.md (status legend).
