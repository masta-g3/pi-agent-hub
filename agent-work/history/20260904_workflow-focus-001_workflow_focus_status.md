**Feature:** workflow-focus-001 → Workflow focus status
**Session:** pi-agent-hub
**Worktree:** `agent-work/worktrees/workflow-focus-001/pi-agent-hub` on branch `workflow-focus-001`
**Start branch:** `main`
**PR target:** `main`

## Outcome

Producer `workflow-runtime.activeMode` is now validated and projected independently from the base workflow. A valid mode can render as `FOC` without a workflow rail, while remaining runtime-only and independent from workflow lanes, cockpit tiers, ordering, liveness, and attention.

Normal compaction publishes a bounded `compact/running` heartbeat operation. The controller retains running status through a short heartbeat gap only when the same tmux target remains present. Fresh lifecycle state, errors, shutdown, target changes, expiry, deletion, and retry clear the transient signal. Compaction does not advance activity recency or alter workflow, attention, lifecycle, or ordering.

## Implementation

- `src/core/heartbeat.ts` and `src/core/types.ts` define independent mode and compaction-operation contracts. Producer and heartbeat adapters validate optional metadata without hiding valid liveness.
- `src/extension/index.ts` publishes and clears normal compaction state through the existing serialized atomic heartbeat writer.
- `src/app/controller.ts` carries fresh mode metadata and owns the bounded tmux-scoped compaction cache. `src/app/explain-session.ts` projects fresh mode consistently for CLI explanations.
- `src/tui/render-model.ts`, `src/tui/layout.ts`, and `src/tui/status-evidence.ts` render mode-only indicators and explain retained compaction without changing placement rules.
- `docs/CONFIG.md`, `docs/FEATURES.md`, and `docs/STRUCTURE.md` document the final producer and state-separation contracts.

## Verification

- Added parser, extension, status, controller, render-model, layout, and status-evidence regression tests.
- `npm run typecheck` passed.
- `npm test` passed: 899 tests.
- Review found and fixed mode projection drift, stale compaction-cache retention, retry heartbeat publication, and fork-compaction error ordering.
