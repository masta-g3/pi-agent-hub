**Feature:** card-lens-004 → Orchestrator Lens
**Session:** e2efffb1-7770-475a-9b8a-903910fa2977 (parent orchestrator)
**Worktree:** `/Users/manager/.local/share/agent-worktrees/card-lens-004-99c33b550442/pi-agent-hub` and `…/rules`, branch `card-lens-004` (record `…/card-lens-004-99c33b550442/worktree.json`)
**Start branch:** `card-lens-integration` (both repos)
**PR target:** `card-lens-integration` (both repos)

# card-lens-004 · Orchestrator Lens

Epic: `agent-work/plans/card-lens-000.md`. Mocks: `agent-work/decks/dashboard-card-lenses.html` (pages Orchestrator · Ticket and Epic; Proposed). Builds on the card-lens-001 lens contract; merge `card-lens-integration` first.

A new `set_orchestration` tool in workflow-runtime lets the orchestrator publish its run: tickets, their state and step, gates, parked questions, commits, PR. The extension turns it into the parent session's lens. Hub needs no new rendering.

## Proposed behavior

Epic run:

```text
ASK    sfcity-014 parked · Which tile CDN?
DOING  Running 2 tickets; next gate sfcity-013 review
WHERE  ▰▰▱▱▱▱ 2/6 committed · 2 running · 1 parked · 1 queued
TIX    ✓ sfcity-010  committed  a1b2c3d
       ✓ sfcity-011  committed  9e8f7a6
       ◉ sfcity-012  EX
       ◉ sfcity-013  RV
       ! sfcity-014  parked
       · sfcity-015  queued
```

Single ticket:

```text
DOING  Waiting for the runner to finish review
WHERE  PL✓ EX✓ RV◉ RF· CM· │ 2 gates ✓ · 0 parked
```

## Confirmed decisions

- New tool `set_orchestration({ doing, tickets: [{ id, state, step?, note?, commit?, gates? }], pr? })`. States: `queued`, `running`, `gated`, `parked`, `committed`. `step` is a workflow step id; `note` ≤ 80 chars (parked question or gate result); `commit` short hash; `gates` = number of phase gates the parent accepted for that ticket (explicit, never inferred). ≤ 24 tickets. Each call replaces the whole snapshot; `set_orchestration({ tickets: [] })` clears it.
- The orchestration snapshot is published as the lens whenever it exists, unless the parent has an active step that is not complete; a completed parent step (for example after `plan-ready`) yields to it.
- Epic lens: `doing` from the call; `progress = committed/total` with unit `committed`; `stages` empty; `WHERE` extra counts `N running · N parked · N queued` come from a new optional lens field `summary` (≤ 80 chars, rendered after the meter by Hub). `list = { label: "TIX", items }` windowed to 001's 12-item bound with `before`/`after` counts (running, parked and gated tickets kept in the window first), with `✓` committed, `◉` running/gated, `!` parked, `·` queued; item text `<id>  <step short | state>  <commit>`.
- Single ticket (one ticket): the lens `stages` become the workflow rail for the ticket's `step` (the five steps with done/active/pending), `summary` = `<gates> gates ✓` from the ticket's explicit `gates` count plus `parked` when parked, and no list.
- A ticket that turns `parked` with a `note` raises one `blocked` attention request on the parent (`<id> parked · <note>`), so it reaches NEEDS YOU. This is orchestration-owned attention: it is stored in the orchestration state, persists across reload, and is re-published after `before_agent_start` clears ordinary attention, unless a newer question or handoff is current (which keeps priority until it clears). It clears only when that ticket leaves `parked`. The request ID is stable within one parked episode (stored with the ticket) and a new ID is issued when the ticket parks again, so a dismissed earlier episode cannot hide a recurrence.
- The orchestration snapshot is restored on reload and survives step changes; it clears on `/wf-clear` and when the tool sends an empty list.
- Transport whenever the orchestration lens wins (no parent step, or a completed one): Rules publishes the `workflow-runtime` entry without `activeStep` and with the orchestration lens, keeping the parent's step only in its internal state, so Hub shows no parent rail beside the orchestration display. Hub accepts a lens-only snapshot as a separate optional `lens` beside an absent base workflow: `parseWorkflowEntry` returns `{ lens }` with no position, `WorkflowSnapshot.activeIndex` stays required for real positions, the runtime/registry carry `lens` on its own field, and rendering shows DOING/WHERE/list without a rail. No fabricated parent position.
- Hub change: render the optional `summary` field after the WHERE meter and accept the lens-only snapshot above.

## Context Files

**Core (rules):** `extensions/workflow-runtime/index.ts` (tool registration, attention publish), `extensions/workflow-runtime/core.ts` (`workflowLens`, state), `extensions/workflow-runtime/session-context.ts` (attention shape), `pi/skills/workflow-orchestrator/SKILL.md`, tests, `README.md`.

**Core (pi-agent-hub):** `src/core/types.ts`, `src/core/heartbeat.ts` (`summary` field), `src/tui/layout.ts` (`whereLine`), `test/heartbeat.test.ts`, `test/instrument-panel.test.ts`, `docs/CONFIG.md`.

## Reuse

- 001's lens contract and renderer, plus `whereLine` fitting.
- Existing `hand_off` attention path and `stableRequestId` for parked requests.
- `tmux_subagent` children stay as they are; no Hub join by parent ID.

## Implementation Phases

### Phase 1: Rules tool and lens

- [ ] Failing tests: tool validation and bounds; snapshot replace and clear; epic lens with 24 tickets windowed to 12; single-ticket lens with explicit gates; precedence: active incomplete step wins, then plan-ready → orchestration lens → a new planning step wins again without clearing the snapshot; parked attention raised, survives another turn's `before_agent_start` and a reload, yields to a newer question and returns after it, and clears only on unpark; repark after dismissal issues a new request ID; `/wf-clear` clears.
- [ ] Implement `set_orchestration`, `orchestration` state, lens derivation, lens-only entry publishing, and orchestration-owned parked attention reconciliation.
- [ ] Verify: Rules `uv run pytest -q`.

### Phase 2: Hub summary field

- [ ] Failing tests: `parseWorkflowLens` accepts a bounded `summary`; WHERE renders it after the meter and drops it first on narrow widths; a lens-only entry round-trips through extension bridge, heartbeat parsing, retention and render for both epic and single-ticket shapes, with no rail and no fabricated position, including a parent that reached plan-ready first; a 24-ticket Rules fixture parses within bounds.
- [ ] Implement.
- [ ] Verify: Hub `npm test`.

### Phase 3: Skill, docs, end-to-end

- [ ] Update `pi/skills/workflow-orchestrator/SKILL.md`: call `set_orchestration` at kickoff and after each gate, launch, park, and merge.
- [ ] Update Rules `README.md` and Hub `docs/CONFIG.md`.
- [ ] End-to-end: a real Pi session in tmux with both worktrees' extensions; call `set_orchestration` for a 4-ticket epic with one parked ticket and for one ticket; capture the Hub card and NEEDS YOU tier from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`. Save captures to `agent-work/tickets/card-lens-004/validation.md`.
- [ ] Verify: Hub `npm test`, then `npm run package:check`.

## Acceptance Criteria

- [ ] An epic orchestrator card shows DOING, WHERE with committed meter and running/parked/queued counts, and a TICKETS list. *(Phase 1; Phase 3 capture)*
- [ ] A single-ticket orchestrator card shows the runner's step rail with the parent's accepted gate count and parked state. *(Phase 1; Phase 3 capture)*
- [ ] A parked ticket raises a blocked request on the parent that appears in NEEDS YOU and clears when it leaves parked. *(Phase 1; Phase 3 capture)*
- [ ] The orchestrator skill keeps the snapshot current at every gate. *(Phase 3 skill text)*
- [ ] Rules tests, Hub `npm test` and `npm run package:check` pass. *(Phases 1–3)*

## Reflection Candidates

## Discovered Work
