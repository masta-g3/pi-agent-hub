# Action workspace

**Feature:** cockpit-006 → Action workspace
**Completed:** 2026-08-28
**Worktree:** none

## Outcome

Replaced the metadata-first selected-session details and raw tmux preview with the frozen Layer 05 action workspace from `agent-work/decks/cockpit-design-lab.html`.

The workspace now answers, in order:

1. which explicit producer request needs the maintainer;
2. what the maintainer should do next;
3. which enabled Hub commands can perform that action;
4. which bounded producer, runtime, workflow, and tree facts explain the session.

No pane tail or Pi conversation content enters rendering, search, controller snapshots, or periodic refresh.

## Delivered behavior

- At 120–159 columns, a persistent 34-cell workspace appears beside the fleet.
- At 160+ columns, the persistent workspace expands to 44 cells.
- Below 120 columns, the fleet remains primary until `Enter`, `i`, or session-row double-click opens an exact-session full-width workspace.
- The first narrow `Enter` or double-click has no attach, restart, or acknowledgement side effect.
- `Enter` inside the full-width workspace runs the existing Open/Restart command.
- `Escape` returns from the full-width workspace to the fleet.
- At 120+ columns, `Enter` and double-click retain direct Open/Restart behavior.
- `i` toggles live evidence inside the same workspace rather than opening a separate status screen.
- Single-click workspace actions execute through the shared target-safe command dispatcher.
- Disabled actions stay out of the workspace and remain discoverable with reasons in the `:` palette.
- Short-height rendering preserves a primary action, maintainer recommendation, and requested evidence without hidden mouse targets.
- Context provenance reports factual producer source age without inventing fresh/stale semantics.
- Selected subagents retain task/owner context and use the owner workflow rail without promoting child state or attention.

## Architecture

### Shared command decisions

`src/tui/dashboard-commands.ts` owns the deterministic recommendation/action policy beside the existing command catalog. Workspace actions reuse built `DashboardCommand` descriptors, including labels, keys, hints, availability, and exact target IDs. No second action table or producer command schema was added.

State-based action order covers explicit attention, owner errors, stopped sessions, subagents, lifecycle buckets, quiet sessions, and active work. `Recommended next` remains Hub-derived maintainer guidance; producer `plan.nextStep` remains workflow context.

### Pure render projection

`src/tui/render-model.ts` projects the selected session, owner, descendants, command selection, evidence visibility, and geometry into one `RenderWorkspace` contract. `src/tui/layout.ts` uses one action-workspace renderer for persistent and full-width layouts with this invariant order:

1. identity;
2. explicit request or explicit absence;
3. maintainer recommendation;
4. enabled actions plus `:`;
5. bounded producer context or explicit absence;
6. runtime state and cockpit placement;
7. optional live evidence;
8. producer workflow;
9. selected tree summary.

ANSI-aware wrapping, truncation, width allocation, vertical pruning, and workspace action hit maps remain pure layout concerns. Shared age formatting lives in `src/tui/age.ts`.

### Interaction safety

`SessionsView` routes workspace keys, direct keys, palette activation, wide double-click, and workspace clicks through `executeDashboardCommand()`. It rebuilds descriptors and revalidates exact command identity before execution. Selection changes, hidden rows, short-height pruning, and below-minimum-width rendering cannot redirect or retain stale workspace hit targets.

Modal, busy, prompt, picker, pending-choice, navigation, disclosure, and mouse precedence remain intact.

### Raw preview removal

Removed:

- `SessionsSnapshot.preview`;
- controller capture/request-guard state and `refreshPreview()`;
- periodic preview capture from `src/app/refresh-loop.ts`;
- selection-change preview callbacks;
- `capturePane()` tmux plumbing;
- compact/expanded details and separate narrow Info state;
- obsolete selected-skill counting that existed only for retired details rendering.

Status evidence still refreshes through the existing read-only fleet observation path. Evidence includes tmux, heartbeat, read state, runtime/placement reasoning, and workflow source provenance.

## Review fixes

Four code-critic passes resolved:

- stale workspace hit maps after resizing below the minimum width;
- wide double-click bypassing the shared command availability guard;
- short-height loss of recommendations, visible actions, or evidence facts;
- missing owner workflow context for selected subagents;
- contradictory absence text for attention-only producer context;
- duplicate Explain-status presentation;
- omitted workflow evidence provenance;
- stale Help wording and obsolete skill-state reads.

The final critic result was `LGTM`.

## Durable documentation

Updated:

- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`

The docs now describe responsive workspace entry, integrated evidence, catalog-owned target-safe actions, and the prohibition on raw pane context. A docs-critic pass found one wording issue about mouse targets; it was corrected.

## Verification

- `npm run typecheck` passed.
- Temporary compiled full suite: **789 tests passed, 0 failed**.
- Functional terminal testing covered 30 width/height combinations and 91 visible action hit targets.
- Representative widths: 40, 60, 100, 120, and 160 columns.
- Short, normal, and tall terminal heights remained ANSI-width-safe.
- No hidden workspace hit targets remained.
- Raw capture/residue guards passed.
- `git diff --check` passed.
- Final local build and `pi install` succeeded.

## Boundaries preserved

This ticket did not implement attention delivery, named spatial pinning, adaptive cockpit cards, onboarding, producer schema changes, new persistence, fuzzy search, raw conversation access, or a new dependency. Those remain owned by later cockpit tickets.
