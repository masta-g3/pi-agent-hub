# Adaptive cockpit

**Feature:** cockpit-008 — Adaptive cockpit

**Completed:** 2026-08-29

**Worktree:** none

## Outcome

The dashboard now uses one responsive attention cockpit instead of persisted compact/all-card modes. Card richness derives from row role, grouping, terminal width, and available height. The read-only `S` workflow board remains a separate projection over producer-owned metadata.

The implementation preserves attention, liveness, workflow position, completion, lifecycle, pin state, and subagent activity as independent axes. It adds no producer schema, persistent view mode, parallel renderer, dependency, pane capture, or conversation access.

## Delivered behavior

### Adaptive hierarchy

- Active parent sessions render adaptive cards with bounded request or ticket context and ticket/group metadata when space permits.
- Backlog and Archived parents remain single-line.
- Subagents render compact micro rows with capped visual depth, agent name, bounded task text, and independent attention/status.
- Trees start collapsed independently in project and board grouping. Existing keyboard disclosure, filter reveal, selection repair, and ephemeral reveal behavior remains.
- Pin mode keeps fleet parents single-line beside the compact decision strip.

### Responsive composition

- Below 100 columns: fleet only; the selected-session workspace opens full-width.
- At 100–119: a 16-cell project tier navigator appears beside the fleet.
- At 120–159: a 17-cell navigator, fleet, and 34-cell action workspace compose together.
- At 160+: the action workspace grows to 44 cells.
- The navigator is hidden in workflow-board, pin, narrow, and full-screen workspace modes.

### Tier navigator

- Normal project view renders all five fixed tiers: `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, and `ARCHIVED`.
- Counts use presentation owners rather than raw descendant rows; zero-count tiers remain visible and inert.
- A click resolves the current first visible exact presentation owner, including standalone missing-parent and cyclic fallbacks.
- Navigator targets are mouse-only and occupy an x region separate from fleet rows, separators, workspace actions, and the outer border.
- Filtering updates counts and destinations. A no-match filter keeps five disabled zero-count tiers.

### Workflow board

- `S` retains producer lanes, deterministic pipeline selection, `OTHER ACTIVE`, group nesting, positional completion, modes, disclosure, and Backlog/Archived footer counts.
- Below 100 columns, board cards stay single-line and group headings are suppressed.
- Wider parent cards show producer activity and valid plan progress. Progress uses an eight-cell `■`/`□` bar plus exact `completed/total`.
- Long activity truncates before the reserved progress suffix. Progress can stand alone when activity is absent.

### Commands and persistence

- Removed `view:density`, `toggleDensity()`, built-in `v` dispatch, Help/palette density copy, density model fields, and density rendering branches.
- `v` is now available for explicit configured dashboard sends and follows the existing exact-target availability and input-precedence rules.
- `ui-state.json` persists only project/board grouping and optional Archived collapse. Unsupported density and Backlog-collapse values are ignored without a startup rewrite.

## Implementation ownership

- `src/tui/render-model.ts` owns the shared project/board projection, independent five-tier navigator projection, row facts, and presentation-owner identities.
- `src/tui/layout.ts` owns adaptive row shapes, responsive geometry, board progress, ANSI-safe rendering, continuation windowing, and separate navigator/fleet/workspace hit maps.
- `src/tui/sessions-view.ts` owns ephemeral disclosure state, exact tier jumps, selection repair, and mouse routing.
- `src/tui/dashboard-commands.ts` and `src/core/dashboard-shortcuts.ts` remove built-in density behavior and free configured `v`.
- `src/app/run-tui.ts` and `src/tui/dialog.ts` own the reduced persisted view-state contract.

## Review corrections

- Reserved board progress width so long producer activity cannot remove the bar.
- Excluded the terminal outer border from workspace action hits.
- Prioritized the no-match message in short layouts.
- Removed obsolete compact-list windowing after every real session list moved to adaptive selected-span windowing.
- Kept pin-mode fleet parents single-line so adaptive continuation rows do not duplicate the decision strip.

## Verification

- `npm test`: 804 tests passed, 0 failed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Independent functional validation: 48 responsive and input checks passed.
- Focused rendering/input suites and 40/59/60/99/100/119/120/159/160+ width contracts passed.
- Final implementation critic: `LGTM`.
- Final documentation critic: `LGTM`.
- Production scans found no density command/state residue or temporary debug artifacts.

## Durable guidance updated

- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `docs/CONFIG.md`
- `AGENTS.md`

These documents now describe adaptive parent cards, micro children, navigator geometry and ownership, board progress, pin-mode compaction, reduced view persistence, and configured `v` availability.

## Follow-up

- `cockpit-010` tracks steady-state visual parity with the frozen HTML hierarchy: mode-aware chrome, right-aligned signals, attention rails, card boundaries, and collapsed-child request counts.
- `cockpit-004` remains responsible for transient explicit-request delivery.
- `cockpit-009` remains responsible for cockpit onboarding.
