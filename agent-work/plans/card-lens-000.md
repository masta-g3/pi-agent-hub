# card-lens · Step lenses on the session card

**Goal:** The session card keeps a fixed base template, and the active workflow skill fills one lens: a DOING line, a WHERE line, and one list.

Mocks: `agent-work/decks/dashboard-card-lenses.html` (Today/Proposed per page).

## Acceptance criteria

- [ ] Every workflow step and the orchestrator show DOING and WHERE; the cards match the Proposed mocks.
- [ ] Hub draws any lens without checking a step name, and keeps it when the heartbeat goes stale.
- [ ] Requests, errors, live tool calls, and SAID show exactly as before on every page.
- [ ] A session without lens data shows today's card, with DONE/NEXT as its DOING line.

## Decisions

- One generic lens shape (DOING, stages, progress, one item list); the producer owns all wording.
- Prefer facts from files, git, and tool calls; the agent reports only Review findings and Reflect outcomes, through an optional list on `set_workflow_activity`.
- Plan question counts come from `ask_user_question` calls and their answers ("N answered · 1 waiting"), with no forecast of remaining questions.
- NOW shows only live tool activity; the activity label moves into WHERE.
- The roster line shows DOING with lens progress at the right edge; the live tool call stays on the card.
- Rules and Hub change together per ticket; the epic lives in pi-agent-hub.
- Plan and code critiques for this epic run on `openai-codex/gpt-6-astra`.

## Test seams

- Rules: workflow-runtime extension tests on published `workflow-runtime` entries.
- Hub: heartbeat normalization tests and pure layout render tests of the card and roster.

## Tickets

- card-lens-001 Step Lens Contract: works when the Execute card matches its mock and any step's lens renders.
- card-lens-002 Plan Commit Lenses: works when the Plan and Commit cards match their mocks.
- card-lens-003 Review Reflect Lenses: works when Review findings and Reflect candidates show on the card.
- card-lens-004 Orchestrator Lens: works when ticket and epic orchestrator cards match their mocks and a parked ticket raises a request.

## Out of scope

- Deduplicating repeated session entries and removing the unused `source` field: a separate cleanup, not needed for lenses.
- Forecasting how many plan questions remain: no reliable source.
