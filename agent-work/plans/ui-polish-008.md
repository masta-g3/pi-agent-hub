# Help and workspace action rows

**Feature:** ui-polish-008 → Help and actions
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-008-dce5320c7613/pi-agent-hub on `ui-polish-008`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique findings 11, 16)
**Depends on:** ui-polish-002, ui-polish-004

## Goal

Help is a calm, grouped reference. Workspace actions read label-first with keys aligned right and an unmistakable primary row.

## Current

```
Commands
  Enter/C-m/C… Restart · attach to the session; … · unavailable: restart transport unavailable
  r            Restart choices… · resume, start a new … · unavailable: restart unavailable
  :            Lifecycle: Active · show Active sessions
```
```
▸ a      Mark read
  i      Details
  :      Actions
```

## Proposed

```
SESSION                                    PINS
  Open / switch / restart       Enter        Pin next free slot      P
  Restart choices…              r            Assign slot 1–4         1–4
  Send text…                    p            ...
VIEWS AND FILTERS
  Filter…                       /
  Actions palette               :
```
(two columns only when width allows; one column otherwise)

```
▌ Mark read                  a
  Details                    i
  All actions                :
```

## Confirmed decisions

- Help is generated from the stable catalog specifications (`actionSpecs` base labels and primary keys plus `viewCommands`), not from the selection-dependent command list, so session and pin commands are listed with stable labels even when no session is selected (`dashboard-commands.ts:145–154,308–323` vary labels by session state). Sections: Session actions, Pins, Views, Filters (palette-only filters listed under Filters with the note "via : palette" once, not a `:` key per row). Section order follows the catalog presentation order.
- Help shows no per-selection availability (`unavailable: …` removed). Help is static reference; availability lives in the palette and workspace.
- Each row: label, then the primary key in display notation (ui-polish-002 `formatKey`), right-aligned in a key column sized to the longest key in that section (no truncation). Hints are dropped from rows when width is short; at ≥120 a muted hint may follow the label.
- Two columns at ≥160 when it shortens the page; otherwise one column. Existing non-catalog help sections (Navigation, dialogs, legend) keep their content, re-headed in the same style.
- Workspace action rows: label first, key right-aligned in `accent` within the workspace width. The primary row uses the `▌` bar in accent plus bold label (replacing `▸`). The `:` row label becomes `All actions`. Row targets and click behavior are unchanged.
- The pinned decision strip uses the same row format if it renders action rows; keep one label and one command target per row (AGENTS.md).

## Context Files

- Core: `src/tui/sessions-view.ts` (`renderHelp` :2255–2322), `src/tui/layout.ts` (`workspaceActionBlock` :1193–1201, `renderActionWorkspace`, decision strip), `src/tui/dashboard-commands.ts` (groups, labels), `src/tui/dashboard-shortcuts.ts` (`formatKey` from ui-polish-002).
- Tests: `test/render-model.test.ts:2102,2131,2147,2192`, `test/phone-layout.test.ts:104–112`, `test/dashboard-commands.test.ts`, `test/sessions-view.test.ts` (help scroll tests if any).

## Reuse

- Catalog groups and presentation order from `dashboard-commands.ts`; `formatKey`; existing `padVisibleLine`/`truncate` helpers for width safety.

## Implementation Phases

### Phase 1: Help
- [ ] Tests: help with no selected session lists session and pin commands with base labels (e.g. `Open`, not `Restart`/`Open in Pi`).
- [ ] Tests: help at 80 and 160 contains section headings, no `unavailable:`, no truncated key (`…` in key column), keys in display notation, filter rows not keyed `:`; all lines fit width; help scroll still reaches the last line.
- [ ] Implement grouped help from the catalog.

### Phase 2: Workspace rows
- [ ] Tests: workspace rows at 120 (34 cells) and 160 (44 cells) and the <120 full-screen workspace: label at left, key right-aligned at the row end; primary row starts with `▌` and its label is bold; `:` row reads `All actions`; click targets unchanged.
- [ ] Implement in `workspaceActionBlock` (and the decision strip if it shares rows).
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] Help is grouped by section, shows no availability state, never truncates keys, and fits every width (tests at 80/160).
- [ ] Workspace action rows are label-first with right-aligned keys and a bold, bar-marked primary row at 120, 160, and full-screen widths (tests).
- [ ] Action targets and keyboard/mouse behavior are unchanged (existing tests pass); `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- docs/FEATURES.md help and workspace description; AGENTS.md workspace sentence ("primary-action marker").
