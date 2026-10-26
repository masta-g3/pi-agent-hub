# Readable color roles

**Feature:** ui-polish-003 → Readable color roles
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-003-c79b1af00723/pi-agent-hub on `ui-polish-003`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique findings 6, 10)

## Goal

Information is always readable. `dim` is decoration only. Unavailable palette actions look disabled, not like errors.

## Evidence

Built-in dark theme `dim` = xterm 240 (`#585858`): contrast 2.4:1 on `#1a1b26`, 1.45:1 on `selectedBg` `#33405e`. `muted` 244 = 4.3:1. Ages, footer labels, tier counts, hints, and workspace identity lines currently render in `dim`.

## Confirmed decisions

- Role rule: `dim` only for pure decoration: rules, separators (` · ` joiners), tree branches (`│ └`), bracket characters around badges, empty workflow-grid placeholders. Everything a user reads for meaning (ages, counts, footer labels, hint text, identity/repo lines, read-only form values, status/footer text in the question dialog, palette hints, "TIERS"/"N more" labels) uses `muted` or stronger.
- Footer: keys stay `accent`; labels become `muted`.
- Built-in theme values are not changed; Pi themes keep their own values. The fix is role assignment.
- Selected rows: dim never renders on the selected row. Decoration that is dim elsewhere renders `muted` on the selected row (selection-aware styles for that row), so nothing drops to 1.45:1.
- Palette: disabled rows render key, label, and reason in `muted` (no `error`); the selected disabled row keeps the selection background. Enabled hints use `muted`. Ordering is unchanged (catalog order is a documented contract).
- No new tokens.

## Context Files

- Core: `src/tui/layout.ts` (dim uses listed by scout: :227–231, 253–258, 306, 364–365, 456, 605–608, 640, 669, 1034, 1090, 1120–1130, 1178, 1217, 1324, 1343, 1366, 1383, 1410, 1418, 1432, 1556, 1564, 1605, 1657, 1666, 1685–1687, 1707 — line numbers from base 193d7d9, re-locate after merging the integration tip), `src/tui/question-dialog.ts:136`, `src/tui/command-palette-dialog.ts:246–250`, `src/tui/conversation.ts` (hint/status lines if dim).
- Tests: `test/theme.test.ts`, `test/command-palette-dialog.test.ts:20,86`, `test/dashboard-theme.test.ts`.
- Reference: `src/tui/theme.ts` (`styleToken`, tokens), `createStyles()` in layout.ts.

## Reuse

- Use existing `styles.muted`/`styles.dim`; no new style helper. If the same "info" styling repeats, prefer calling `styles.muted` directly over a new alias.

## Implementation Phases

### Phase 1: Guard test first
- [ ] Add a test that renders the dashboard (fleet with all tiers, workspace, footer) at 80, 120, 160 with a test theme whose `dim` is a unique color code, strips everything except dim-styled spans, and asserts dim spans contain only decoration characters (`│└─·[]` spaces and the grid placeholder). It must fail today (ages, footer labels).
- [ ] Same guard for the palette and the question dialog renders.
- [ ] Guard: the selected fleet row (and selected palette row) contains no dim-styled span at all.

### Phase 2: Role changes
- [ ] Move informational dim uses in layout.ts to `muted` (ages, counts, footer labels, hints, identity, form read-only values, "TIERS", "N more", archive disclosure).
- [ ] question-dialog status/footer → `muted`.
- [ ] Palette: disabled reason → `muted`; disabled key → `muted`; enabled hint → `muted`. Update palette test to assert no `error` styling on disabled rows.
- [ ] Selected row: dim decoration renders muted.
- [ ] Guard tests pass; full `npm test` passes.

## Acceptance Criteria

- [ ] In rendered fleet, workspace, footer, palette, and question frames at 80/120/160 columns, `dim` styles only decoration characters (guard test).
- [ ] The selected row contains no dim-styled text (test).
- [ ] Unavailable palette commands contain no `error`-token styling; their reason text is visible in `muted` (test).
- [ ] Theme token values and Pi theme mapping are unchanged (`test/theme.test.ts` passes unchanged).
- [ ] `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- AGENTS.md TUI Rules: add "dim is decoration only; information uses muted or stronger" next to the width-safe styling rule.
