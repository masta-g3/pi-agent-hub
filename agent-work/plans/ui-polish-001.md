# Footer and cursor fixes

**Feature:** ui-polish-001 → Footer cursor fixes
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-001-0ef8fc0c51ce/pi-agent-hub on `ui-polish-001`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (design reference `agent-work/ui-review/critique.md`, findings 1–3, 15)

## Goal

The footer tells the truth about Enter at every width, surfaces the core triage key when requests exist, names the `b` toggle clearly, and the cursor starts on the first row the user sees.

## Confirmed decisions

- Enter opens, switches to, or restarts the selected session at every width (docs/FEATURES.md:173). The footer must say `Enter Open` at every width. Below 120 columns, the footer adds `i Workspace`, because `i` opens the action workspace there.
- When at least one visible request exists (`visibleRequestCount > 0`), the footer shows `] Next request` right after `Enter Open`. Phone widths (≤60) keep their tap-target order and drop trailing items first. Show `] Next` there only if it fits before `?`/`Help` drop.
- The `b` footer item mirrors the catalog label: `b Show backlog` or `b Hide backlog` (sentence case, matching `view:backlog`).
- Initial selection: on the first render, if the user has not moved the cursor yet, select the first rendered session target (cockpit order, so NEEDS YOU comes first). Do not change sort order, tier classification, or later selection repair.
- Delete dead `openWorkspace()` in `src/tui/sessions-view.ts:787`.

## Context Files

- Core: `src/tui/dashboard-commands.ts` (`dashboardFooter` :281–305), `src/tui/render-model.ts` (footer call :666, `pickSelectedId` :853), `src/tui/sessions-view.ts` (`visibleListTargets` :1738+, `visibleRequestIds` :733, `openWorkspace` :787), `src/app/controller.ts:44`.
- Tests: `test/sessions-view.test.ts:2122,4002` (assert the wrong `Enter Workspace`), `test/render-model.test.ts:1402–1416`, `test/phone-layout.test.ts:82`, `test/dashboard-commands.test.ts:73–75`.
- Reference: `docs/FEATURES.md:173`, AGENTS.md (footer and catalog rules).

## Reuse

- Footer strings stay in `dashboardFooter()`; pass the request count through its existing `options` object instead of a new footer path.
- Request count: reuse `visibleRequestIds()` (already used by `dashboardCommands()` at sessions-view.ts:949).
- First rendered target: reuse `visibleListTargets()` order; no new ordering function.

## Design

```
≥100: ↑↓ Move · Enter Open · ] Next request · n New · / Filter · b Show backlog · v Group · S Board · : Actions · ? Help
61–99: ↑↓ Move · Enter Open · i Workspace · ] Next request · / Filter · : Actions · ? Help
≤60:  Enter Open · i Info · : Actions · / Filter · ? Help        (unchanged order; `]` only if it fits)
```

When no requests exist, `] Next request` is absent. Keep `b` at widths where it is shown today; if a band overflows, drop lower-value items in the existing order (Group, Board, New) before `]`.

## Implementation Phases

### Phase 1: Footer truth
- [ ] Update `test/sessions-view.test.ts:2122,4002` and footer tests to expect `Enter Open` at 61–119 plus `i Workspace`; add a test that Enter still switches at width 100 (existing test covers the switch). Run and see them fail.
- [ ] Change `dashboardFooter()` so Enter is `Open` at every width; add `i Workspace` for 61–119.
- [ ] Add `options.requestCount`; render `] Next request` when > 0; thread the count from `render-model.ts:666` input (the view already computes visible request IDs). Test with and without requests at 80 and 160.
- [ ] Footer `b` label mirrors the catalog label (`Show backlog`/`Hide backlog`). Test both states.
- [ ] Verify every footer line fits its width (existing width assertions) at 61, 80, 99, 100, 120, 160.

### Phase 2: Cursor and dead code
- [ ] Test: controller with an error session and a waiting session with attention; first `SessionsView.render(160)` selects the NEEDS YOU row (first rendered session target). Then user moves down; a re-render does not snap back.
- [ ] Implement first-render selection to the first rendered session target, only while the user has not moved selection and nothing restored a selection.
- [ ] Delete `openWorkspace()`; typecheck.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] At widths 61–119 the footer reads `Enter Open` and includes `i Workspace`; Enter still opens/switches directly (sessions-view tests).
- [ ] With ≥1 visible request, the footer shows `] Next request` at 80 and 160 columns; with none, it is absent (render-model/sessions-view tests).
- [ ] The `b` footer item reads `Show backlog` or `Hide backlog` to match state (test).
- [ ] On startup with an error session and a NEEDS YOU session, the cursor is on the first rendered row; user moves are not overridden (sessions-view test).
- [ ] `openWorkspace` no longer exists; `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- docs/FEATURES.md footer description if it lists footer items; AGENTS.md footer wording only if it names labels.
