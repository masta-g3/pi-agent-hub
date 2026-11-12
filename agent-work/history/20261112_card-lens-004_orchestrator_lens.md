**Feature:** card-lens-004 → Orchestrator Lens
**Repos:** pi-agent-hub and rules, branch `card-lens-004`, merged into `card-lens-integration`
**Epic:** card-lens (`agent-work/plans/card-lens-000.md`); mocks in `agent-work/decks/dashboard-card-lenses.html` (Orchestrator · Ticket and Epic)

# card-lens-004 · Orchestrator Lens

## Outcome

The workflow orchestrator publishes its run as the parent session's card lens. Epic card: DOING, a rail-free WHERE (`▰▰▱▱▱▱▱▱ 2/6 committed · 2 running · 1 parked · 1 queued`), and a `TIX` ticket list. Single-ticket card: the runner's step rail with accepted gates (`PL✓ EX✓ RV◉ RF· CM· │ 2 gates ✓`). A parked ticket raises a `BLK` request on the parent.

## Rules (`extensions/workflow-runtime`)

- `set_orchestration({ doing?, tickets: [{ id, state, step?, note?, commit?, gates? }], pr? })`. States: `queued`, `running`, `gated`, `parked`, `committed`. Limits: at most 24 unique tickets; ids up to 80 characters; note up to 80; commit is a short hash; gates 0–99 and never inferred. Each call replaces the `orchestration` state; `tickets: []` or `/wf-clear` clears it. The snapshot survives step changes, rail dismissal, focus and reload.
- **When it shows:** the orchestration lens wins when the parent has no active step, or its step is complete (for example after `plan-ready`). The published entry then moves `activeStep` to `heldStep`, so Hub shows no parent rail. `findLatestState` restores the step on reload.
- **Epic lens:** `progress` counts committed tickets with unit `committed`. `summary` gives running (gated tickets count as running), parked and queued counts. The `TIX` list keeps call order and shows 12 items: open tickets first, then queued, then the latest commits. Hidden commits count as `before`, other hidden tickets as `after`. `pr` becomes the list head.
- **Single-ticket lens:** the five steps as `stages`, plus `summary` `N gates ✓` and `parked` when parked.
- **Parked attention:** the request is `<id> parked · <note> (+N more)`, cut to the 150-character attention bound. Each parked episode keeps a stable request ID and its note; a ticket that parks again gets a new ID. The request survives `before_agent_start` and reload. A newer question or handoff takes priority until it clears. The request ends when no ticket is parked with a note.
- The `workflow-orchestrator` skill calls `set_orchestration` at kickoff and after each gate, launch, park and merge.

## Hub

- Lens adds an optional `summary` field (up to 80 characters).
- `parseWorkflowEntry` returns `{ lens }` for an entry without `activeStep`.
- Heartbeat, ManagedSession, RuntimeSession and RenderSession carry a top-level `lens` only when no workflow is present. `applyComputedStatus` retains it like the workflow.
- `whereLine` draws a rail-free WHERE whose count names its unit, then the summary. The summary is the first part dropped on narrow widths.
- Fixtures in `test/fixtures/orchestration.ts` come from the Rules core output.

## Review fixes

- Attention text is bounded to `MAX_ATTENTION`. Before this, long ids and notes broke the context contract.
- A parked ticket keeps its note when a later call omits it.

## Validation

Rules pytest passed (91). Hub `npm test` passed (1697), and `npm run package:check` passed. End to end, a real Pi session with both worktrees' extensions drove the Hub TUI; captures are in `agent-work/tickets/card-lens-004/validation.md`.

## Reflection outcomes

- The TIX double-space gap collapses to one space in Hub's list renderer: no action, because it stays readable.
- Docs updated: Hub `docs/FEATURES.md`, `docs/STRUCTURE.md`, `docs/CONFIG.md`, `CHANGELOG.md`, and `AGENTS.md` (the WHERE rule is scoped to positioned workflows); Rules `README.md` and the orchestrator skill.

## Discovered work

None.
