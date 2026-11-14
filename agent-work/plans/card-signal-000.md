# card-signal · Trustworthy, coherent session card signals

**Goal:** The session card tells the truth about what an agent is doing, says what an open session is about, and reads the same way in every workflow step.

Builds on `card-lens-000` (archived plans under `agent-work/history/*card-lens-*`) and its mocks in `agent-work/decks/dashboard-card-lenses.html`.

## Tickets

- card-signal-001 Card Signal Study: works when a rerunnable replay tool scores DOING/DONE/NEXT against agent actions on ~15 mock sessions and a real-session sample, and a findings report ranks drift causes.
- card-signal-002 Open Session Card: works when a session outside a workflow shows GOAL and an explore → change → verify stage track in the workflow card style. Depends on 001.
- card-signal-003 Step Lens Parity: works when every workflow step fills the same lens slots (named stages, meter, list) and their cards match the parity mocks. Depends on 002.

Order: 001 → 002 → 003 (a chain; one child at a time).

## Repos and branches

- pi-agent-hub (primary, holds tickets and plans) and rules (producer extension).
- Integration branch `card-signal-integration` in both repos, from `main`, PR target `main`. One draft PR per repo.
- Ticket branches `card-signal-00N`, based on and targeting the integration branch. 001 touches Hub only.

## Decisions

- Rules produces every signal (progress notes, lenses); Hub draws them without checking step names. Rules and Hub change together per ticket.
- The study runs before design work, so 002 and 003 build on measured signal quality. The parent may adapt 002/003 details AFK from 001 findings, keeping their acceptance criteria.
- Study mock agents: mostly `openai/gpt-6.1-sol`, some `openai/gpt-6.1-terra`, 1–2 `claude-opus-5-5` runs. The judge uses `openai/gpt-6.1-sol`. About 15 mock runs.
- Real session logs under `~/.pi/agent/sessions` are read-only study input; reports quote no real conversation text.
- Open sessions get a model-written stable GOAL and a stage track derived from tool calls (no model call for the track).
- Step parity may add new signals; prefer runtime-derived facts over new agent instructions.

## Out of scope

- Changing the workflow steps themselves, the board, or pin views beyond what the shared card renderer gives them.
- Persisting signals into `registry.json` or Hub UI state.

## AFK limits (approved 2026-11-14)

The parent may answer from approved plans, make reversible implementation choices that keep acceptance criteria, adapt 002/003 details from 001 findings, and log discovered work as tickets. It may not change acceptance criteria, widen scope, add dependencies, or touch external systems. Model use stays within the study budget. One draft PR per repo to `main`; the parent never merges to `main`.
