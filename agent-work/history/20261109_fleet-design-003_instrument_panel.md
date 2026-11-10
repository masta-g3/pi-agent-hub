# fleet-design-003 — Instrument panel

## Outcome

The no-pin Status/Repo fleet uses ruled tier headings, fixed labeled fields and a header fleet meter. Active-lifecycle parent rows render modules; Backlog and Archived stay single-line. QUIET expands by default; HEALTH folds completely to its heading. Existing classification, persistence and workflow ownership remain unchanged.

The selected session's full card docks below the list. Selection does not expand list rows, and dock allocation keeps the footer stable. An overflowing list still windows around selection; focused Answer/Reply panels and Details may grow the dock. The dock reuses the existing card/panel renderer, scrolling and exact-session action targets. At 100+ columns it shows a recessed LCD readout; narrower cards retain a one-line readout. The segmented workflow bar remains separate in fleet-design-002.

## Design boundaries

- Unselected modules have no raised surfaces. Only the selected owner tree is highlighted in the list.
- Fields appear only with values: ASK/RDY/BLK, ERR, NOW, STEP/TASK/PHASE and SUB.
- Theme roles: warning for every request, error for faults, accent for controls, success for running work. Finished marks and healthy quotas use text. Board and pin retain their full palette.
- Removed raised-card and pill machinery, additive selected-card padding and collapsed HEALTH summaries.
- No settings, dependencies, state schema or second renderer added. Shared fleet headings also rule pin headings; pin rows retain their existing anatomy.

## Review and verification

- Code review corrected selection-dependent list continuation allocation and over-wide workflow markers hiding the active step. Regression tests failed first, then passed. Docked modules share a selection-independent optional-line budget; over-wide STEP reuses the compact current-step renderer.
- Final code-critic and docs-critic checks returned LGTM. An earlier critic-result lock timeout was resolved by an authorized retry.
- Public visual evidence: `agent-work/tickets/fleet-design-003/fleet-before-after.png` compares generic 100-column golden fixtures from the baseline and candidate, without private dashboard data.
- Full suite: 1,596 tests pass. Typecheck and diff checks pass. Generic golden frames cover 60/100/160 columns; targeted tests cover narrow layouts, NO_COLOR, ASCII, palette roles, dock positions, scrolling and exact hit targets.
- User-authorized installation packed this feature worktree, installed its tarball globally, compared installed TUI files byte-for-byte and smoke-checked pi-hub --help.
- Synthetic rendering improved versus the preceding fleet implementation; this does not measure the separately reported Pi open/return lag, which the user deferred investigating.

## Reflection

Corrected stale inline-card, selected-detail-priority, lifecycle, surface and workflow-placement wording in AGENTS.md, docs/FEATURES.md and docs/STRUCTURE.md. Removed duplicate fitting prose rather than adding rules. No follow-up tickets or workflow rules were added.

## Closeout

- Baseline: main at 75d2ce1; feature branch fleet-design-003; PR target main.
- Rules record: /Users/manager/.local/share/agent-worktrees/fleet-design-003-19283793b55f/worktree.json.
- Retain the worktree pending PR integration and separately approved cleanup.
- Private design notes, mockups and the earlier dashboard screenshot remain untracked for reference. Exclude them from public commits and preserve useful originals before eventual cleanup.
