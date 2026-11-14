**Feature:** card-signal-002 → Open Session Card
**Session:** 01a1dba6-d948-736d-a3a0-55ca35b3cbfe (parent orchestrator)
**Worktree:** pi-agent-hub `/Users/manager/.local/share/agent-worktrees/card-signal-002-84e8300bf8b0/pi-agent-hub` and rules `/Users/manager/.local/share/agent-worktrees/card-signal-002-84e8300bf8b0/rules`, branch `card-signal-002` in both
**Start branch:** `card-signal-integration` (both repos)
**PR target:** `card-signal-integration` (both repos)
**Epic:** `agent-work/plans/card-signal-000.md` (read the integration worktree copy)
**Depends on:** card-signal-001. Read its report (`agent-work/tickets/card-signal-001/report.md` on the integration branch) before Phase 1 and apply its recommendations that concern the progress note, within this plan's acceptance criteria.

# Open Session Card

## Goal

A session that is not running a workflow step says what it is for and roughly where it is, in the same style as workflow cards. Add at most two fields: a stable GOAL and a tool-derived stage track.

## Today

Without a workflow, the card has no lens. It shows DONE and NEXT from the progress note (`noteProgress()` in `rules/extensions/workflow-runtime/index.ts`), NOW/LOG tool calls, and SAID. The roster line shows DONE. Nothing says what the session is about, and DONE/NEXT change every turn.

## Proposed card

```text
Auto Resume                                   2m
GOAL   Auto-resume after provider rate limits
DOING  Analyzing resume timers in pi-accounts
WHERE  explore✓ change◉ verify·
NOW    edit src/limits.ts
LOG    1m read src/accounts.ts
── SAID ──────────────────────────────────
…
```

Roster module (one status line, as today): DOING with the live tone while running; quiet sessions keep the existing fallbacks. The title row is unchanged.

- **GOAL**: one line, ≤ 80 chars, what the session is for. Written by the same progress-note model call (no extra call). The prompt receives the previous goal and must return it unchanged unless the user changed the topic. A linked ticket's subtitle wins over GOAL; then GOAL is not shown.
- **DOING**: replaces DONE/NEXT as the card's live line, through the existing lens-only path: a nonempty lens `doing` shows as DOING and hides DONE/NEXT. The note's `next` is not reused as-is: it is written at `agent_end` and describes future work, so it goes stale during the next turn. Phase 1 picks the source from 001's evidence (for example a mid-turn refresh, or a `doing` field written from tool calls), and records it under Decisions. If no source describes current work truthfully, publish no `doing`: the card then keeps DONE/NEXT, the roster keeps its quiet fallbacks, and GOAL + WHERE still ship.
- **WHERE**: a lens with `stages` `explore`, `change`, `verify`, and no rail (lens-only snapshots already render without a rail in `whereLine()`).

## Stage track rules (deterministic, Rules side)

Classify each finished tool call:
- `explore`: `read`, `grep`/`find`/`ls`, `web_search`, `fetch_content`, bash commands that only read (`rg`, `grep`, `cat`, `ls`, `git log|show|diff|status`, `sed -n`).
- `change`: `edit`, `write`, bash that writes files (`>`/`>>` redirects, `mv`, `cp`, `rm`, `git add|commit|apply`).
- `verify`: bash that runs tests or checks (`test`, `pytest`, `typecheck`, `tsc`, `lint`, `node --test`, `npm run …check`).
- other tools: no stage.

State: the latest classified stage is `active`; stages seen since the track started are `done`; unseen stages are `pending`. The track resets when a workflow step starts or `/wf-clear` runs. GOAL arrives asynchronously after the turn, so a goal change does not clear calls already seen: the first goal keeps all earlier observations, and a changed goal re-seeds the track from the classified calls of the turn that produced it. Hide the track until the first classified call.

## Where it is published

- GOAL: new optional `goal` on `ProgressNote` in `pi-agent-hub-context` (`session-context.ts`, `MAX_GOAL = 80`). Hub `src/core/session-context.ts` parses it like `done`/`next`.
- Stage track + DOING: a lens-only `workflow-runtime` entry when there is no active step and no orchestration lens (the path `orchestrationLens()` already uses with `heldStep`). Publish only on change. A workflow step or orchestration lens always takes precedence.
- Subagent sessions keep today's behavior (progress notes are already off for them).

## Hub changes

- `src/core/session-context.ts`: parse `progress.goal`.
- `src/tui/layout.ts` `detailFieldLines()`: a `GOAL` line before DOING when there is a goal and no ticket subtitle/description (same label column and muted tone as DONE). Roster: when quiet, `TASK` falls back to GOAL before nothing.
- `docs/STRUCTURE.md` field order and `AGENTS.md` card description mention GOAL in the same sentence that lists the card's fields.

## Reuse

- Lens-only entry path: `rules/.../core.ts` `withWorkflowDefinition()` + Hub `parseWorkflowEntry()` (no new Hub lens parsing).
- Progress note pipeline: `noteProgress()`, `PROGRESS_PROMPT`, `parseProgressNote()`, `parseProgress()` (extend, do not duplicate).
- Hub `whereLine()` stage rendering and `lensOf()`.
- Bash command classification: follow `closeoutKinds()` / `runsGitCommit()` style in `rules/extensions/workflow-runtime/commit-facts.ts`.

## Implementation Phases

### Phase 1: Rules signals
- [ ] Read the 001 report; note in Decisions below any recommendation adopted for the note or DOING.
- [ ] Tests first (`rules/tests/workflow_runtime*.test.mjs`): the classifier on representative tool calls; the track's states across a sequence, its reset on step start and re-seed on goal change; goal kept when the model returns it unchanged and parsed/bounded; lens-only entry published without a step and suppressed under a step or orchestration lens.
- [ ] Implement `goal` in the prompt, parser and snapshot; the classifier and track; the open-session lens publication.

### Phase 2: Hub card
- [ ] Tests first (`test/fleet-cards.test.ts` style): an open session renders GOAL, DOING, WHERE stages and no DONE/NEXT; a ticket subtitle suppresses GOAL; a workflow session is unchanged; the roster shows DOING; a quiet session's roster shows GOAL as TASK; narrow widths keep labels and fit.
- [ ] Implement parsing and rendering; update `docs/STRUCTURE.md` and the AGENTS.md card sentence.

### Phase 3: Verification
- [ ] Rerun the 001 replay tool on two new mock sessions (open-ended debug + topic switch) and record in `agent-work/tickets/card-signal-002/validation.md` that GOAL stayed stable within a topic and changed on the switch, and the stage track followed the tool calls.
- [ ] Rules: `env -u PI_AGENT_HUB_PRIMARY_CWD -u PI_AGENT_HUB_FORK_COMPACT uv run pytest -q`. Hub: `npm test`, then `npm run package:check` (not concurrently).

## Acceptance Criteria

- [ ] An open session's card shows GOAL and a WHERE stage track (explore / change / verify) in the existing label-column style; with a DOING it hides DONE/NEXT; covered by Hub render tests.
- [ ] GOAL stays the same across turns on one topic and changes after a topic switch, in replayed mock sessions.
- [ ] The stage track matches the session's tool calls, needs no model call, resets on step start, and re-seeds from the current turn on goal change; covered by Rules tests.
- [ ] DOING appears only from a source that 001's evidence or the Phase 3 replay shows tracks current work; otherwise the card keeps DONE/NEXT.
- [ ] Workflow-step, orchestrator, ticket-linked and subagent cards are unchanged, except GOAL hidden where a ticket subtitle exists; existing tests pass in both repos.

## Decisions

(record 001-driven choices here)

## Discovered Work

(none yet)

## Reflection Candidates

- Rules `README.md` workflow-runtime section: open-session lens and `goal`.
- Hub `docs/STRUCTURE.md` card field order; `docs/CONFIG.md` producer contract if it lists progress fields.
