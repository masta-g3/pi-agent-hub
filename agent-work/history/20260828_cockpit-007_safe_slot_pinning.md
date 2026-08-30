# Direct pinning

**Feature:** cockpit-007 — Direct pinning
**Worktree:** none
**Completed:** 2026-08-28

## Outcome

Implemented safe transient numbered slots for live Pi sessions. The cockpit now supports exact placement, numeric and optional spatial focus, close, resize, full-screen handoff, responsive capacity, and a bounded decision/evidence strip without creating a second session or pane model.

User testing superseded the initial named-only design. The final slot grammar restores visible numbers while retaining the identity-safe lifecycle:

- `1`–`4` assigns the selected live session to that exact free slot.
- An occupied destination refuses the assignment and identifies its occupant; no path replaces, swaps, retargets, or evicts.
- `P` assigns the lowest free available slot or focuses the selected session's existing slot.
- `Alt+1`–`Alt+4` focuses an occupied slot from the cockpit or another live pane.
- `x` closes the selected session's exact pin without stopping Pi.
- `+`/`-` adjusts the applicable main split in ten-point steps, clamped to 30/70.
- `Alt+Arrow` remains an optional geometry-based focus alias; `Ctrl+Q` is the reliable return path.

## Product Contracts

- Slots are transient tmux pane metadata (`@pi_hub_slot`), never registry or disk state.
- Every operation also validates pane ID, tty-to-managed-session mapping, and exact managed identity.
- Pin creation keeps cockpit focus and does not acknowledge waiting attention.
- Focusing an existing slot, numeric/spatial focus, return, and full-screen handoff reveal the exact session and acknowledge waiting state before focus.
- Whole-window capacity is 0 slots below 100 columns, slots 1–2 at 100–159, and slots 1–4 at 160+.
- Width contraction preserves existing high slots, marks the layout constrained, and blocks new assignment and resizing while safe close remains available.
- Slot holes remain stable. Closing does not compact or renumber surviving panes.
- The sidebar remains 40–60 cells where possible, with the approved 38-cell minimum for pin geometry.
- No pane output or Pi conversation content enters rendering, evidence, search, or persistence.

## Implementation

### Pane ownership and lifecycle

- Kept `src/app/side-pane-lifecycle.ts` as the sole serialized boundary for inspection, reconciliation, mutation, focus, handoff, chrome, polling, and shutdown.
- Kept `src/app/side-pane.ts` as the stateless low-level owner for live inspection, slot topology, geometry, repair, rollback, and tmux mutation.
- Restored a single sparse `SidePaneSlot = 1 | 2 | 3 | 4` projection instead of parallel ordered and numbered representations.
- Repaired missing or duplicate tags deterministically, reconciled duplicate managed attaches, and excluded user panes.
- Added rollback for failed rebuilds, first-pin creation, chrome/title setup, and pre-size failures. Only confirmed disappearance is ignored.
- Preserved exact pane-ID targeting, tty validation, footer restoration, dashboard chrome cleanup, operation draining, and shutdown ordering.

### Capacity and geometry

- Slots 1 and 2 stack at 100–119 columns and sit side by side at 120–159.
- At 160+, slots use a 2×2 topology: 1 top-left, 2 top-right, 3 bottom-left, and 4 bottom-right.
- Sparse occupancy expands available rows or columns without changing slot identity.
- One-column `1/3` and `2/4` layouts resize vertically; other layouts adjust the topology's applicable main split.
- Contraction preserves high slots and quadrant topology, blocks new assignment, and allows recovery after widening or closing.
- Rebuilds pre-size managed windows at final geometry, split at final size, then restore `window-size latest`.

### Commands and rendering

- Added exact slot assignment/focus callbacks through `run-tui`, the shared command catalog, `SessionsView`, and guarded tmux root bindings.
- Reserved built-in `1`–`4`, `M-1`–`M-4`, `P`, `x`, `+`, and `-`; retained `F` and `o` for explicit configured sends.
- Root bindings send intents to the saved sidebar pane, pass through outside the dashboard, and restore prior server-global bindings.
- Added `▢N`/`▣N` row markers, a sparse numbered `PINNED` summary, and width-aware `LIVE N · <identity>` pane titles with optional owner/ticket context.
- Reused the cockpit-006 workspace projection for compact status, request, action, and evidence content; no second recommendation policy was added.
- Pin mode keeps direct `Enter` handoff even when the narrow cockpit is below 120 columns.

## Verification

- Five slot-focused code-review passes completed; final result: `LGTM`.
- Documentation review completed; final result: `LGTM`.
- `npm run typecheck` passed.
- Full temporary compiled suite passed: 794/794 tests.
- Focused side-pane, lifecycle, tmux, command, rendering, and cockpit suites passed.
- `git diff --check` and residue/debug scans passed.
- Isolated real-tmux testing verified sparse slots 1 and 4, occupied-slot refusal, lowest-free `P`, exact numeric focus, width contraction/recovery, user-pane preservation, guarded binding passthrough, and prior-binding restoration.
- The reviewed checkout was built and installed with `npm run build && pi install "$PWD"`.

## Durable Guidance

Updated `README.md`, `docs/FEATURES.md`, `docs/STRUCTURE.md`, `docs/CONFIG.md`, and `AGENTS.md` for the final safe-slot behavior, capacity, contraction, identity guarantees, terminal-sensitive spatial aliases, and lifecycle ownership.

## Boundaries Preserved

- Did not implement cockpit-008 adaptive cards, cockpit-004 attention delivery, or cockpit-009 onboarding.
- Added no layout persistence, pane history, generic tmux manager, replacement UI, new dependency, or compatibility path.
- Did not acknowledge on creation, infer attention, promote subagent state, or couple pin focus to workflow state.
- Preserved unrelated tracked and untracked checkout files.

## Discovered Work

User testing requested full numbered slots and visible sidebar slot indicators after the initial named-only implementation. The approved revision was completed within cockpit-007 as one identity-safe slot model; no follow-up ticket is required.
