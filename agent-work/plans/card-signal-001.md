**Feature:** card-signal-001 → Card Signal Study
**Session:** 01a1dba6-d948-736d-a3a0-55ca35b3cbfe (parent orchestrator)
**Worktree:** pi-agent-hub `/Users/manager/.local/share/agent-worktrees/card-signal-001-d663a3a582a3/pi-agent-hub` and rules `/Users/manager/.local/share/agent-worktrees/card-signal-001-d663a3a582a3/rules`, branch `card-signal-001` in both
**Start branch:** `card-signal-integration` (both repos)
**PR target:** `card-signal-integration` (both repos)
**Epic:** `agent-work/plans/card-signal-000.md` (read the integration worktree copy)

# Card Signal Study

## Goal

Find out how often the card's DOING, DONE, NEXT and SAID disagree with what the agent actually does, and why. Deliver a rerunnable replay tool and a findings report that 002 and 003 build on.

## What the card shows today (facts from code)

- **DONE / NEXT**: `rules/extensions/workflow-runtime/index.ts` `noteProgress()` runs only on `agent_end` (not aborted). It sends the last 6 user/assistant text messages (≤3,000 chars, tool calls excluded; `recentTranscript()` in `session-context.ts`) plus ticket fields to `gpt-6-luna` with `PROGRESS_PROMPT`, then publishes `progress` in a `pi-agent-hub-context` entry. One call at a time (`progressPending`); a turn that ends while a call runs gets no note.
- **DOING**: the workflow lens `doing` from `core.ts` `workflowLens()` / `orchestrationLens()`: Execute uses the plan's first open task (`plan.nextStep`), other steps the activity label or the active review item. Published in each `workflow-runtime` entry.
- **Card precedence** (Hub `src/tui/layout.ts` `rosterLines()` and `detailFieldLines()`): roster line = request → ERR → DOING → NOW (live tool) → SUB → DONE → SAID → TASK. Card: DOING if a lens exists, else DONE + NEXT.
- **SAID**: not a producer field. Hub reads it live over the interaction bridge for the selected session only: `lastAssistantText()` in Hub `src/core/conversation.ts` returns the newest assistant text since the last user message (skipping `stopReason: pending` and text-free messages), bounded by `LAST_MESSAGE_CHARS` and the frame budget (`src/extension/session-interaction.ts`). `SelectedInteractionObserver.poll()` (`src/tui/conversation.ts`) refreshes it at most once per second after each dashboard refresh. Without a live message, the card falls back to `context.attention.text` (a handoff already read) when the session is not running; the roster's quiet line shows that same handoff as `SAID`.
- **Hub delay**: the Hub extension copies the latest entries into the heartbeat; activity heartbeats are coalesced at 750 ms (`ACTIVITY_HEARTBEAT_DELAY_MS`). The study treats entry timestamps as display times and states this assumption.

Suspected drift causes to test (the user saw DOING/NEXT disagree with the agent):
1. Notes refresh only at turn end, so a long turn shows the previous turn's NEXT the whole time.
2. The progress input omits tool calls, so the note can miss what the agent actually did.
3. Execute DOING follows the plan's first unchecked box, which lags when the agent works ahead or ticks boxes late.
4. A skipped note (call already pending, aborted turn, model failure) leaves an older note on screen.
5. A NEXT that names a user decision stays after the user answered.
6. SAID shows mid-turn narration ("Next I check X") after the agent has moved on, because intermediate assistant text counts as the newest message.
7. SAID falls back to an old handoff (`attention.text`) after a new user message or once the live message is gone, so the card repeats an earlier turn.

## Approach

```text
Pi session .jsonl ──▶ replay.ts ──▶ timeline (per second: shown DOING/DONE/NEXT/NOW, agent's actual action)
                                   ├─▶ timing metrics (deterministic)
                                   └─▶ judge samples ──▶ gpt-6.1-sol ──▶ match / stale / wrong + reason
                                                                   └─▶ report.md (aggregates, ranked causes)
mock scenarios ──▶ pi --mode json -p (temp session dir) ──▶ .jsonl ─┘
```

### Where the tool lives

`rules/tools/card-signal/` (new dir, Rules is the producer and owns these parsers). Hub must not read conversations (`pi-agent-hub/AGENTS.md`), so the tool stays out of Hub. Run with `node --experimental-strip-types` like the existing Rules tests; import `recentTranscript`, `parseContextSnapshot`, `parseProgressNote` from `extensions/workflow-runtime/session-context.ts` instead of re-implementing them.

Files:
- `replay.ts`: parse one `.jsonl`, follow the active branch (`id`/`parentId`, last leaf), build the event timeline and the per-moment "shown" state.
- `metrics.ts`: deterministic metrics.
- `judge.ts`: sample moments, call the judge, cache verdicts by sample hash in the output dir so reruns cost nothing.
- `scenarios/*.md` + `run-mocks.sh`: scripted mock sessions.
- `cli.ts`: `replay <files…> --out <dir> [--judge] [--sample N]`; writes `timeline.jsonl`, `metrics.json`, `verdicts.jsonl`, `report.md`.
- `README.md`: how to rerun; one paragraph.

### Shown state (what the card displayed)

At any moment t, using the latest entry with timestamp ≤ t on the branch:
- `doing` = latest `workflow-runtime` entry's `lens.doing` (if any)
- `done` / `next` = latest `pi-agent-hub-context` entry's `progress`
- `now` = open tool call (assistant toolCall without its toolResult yet)
- `said` = `lastAssistantText()` over the branch up to t, re-implemented in `replay.ts` with a comment naming the Hub source (a 15-line function; Rules cannot import Hub). If it is empty and the session is not running, use the latest context `attention.text` as Hub's fallback. Mark which source was used (`live` or `fallback`). Model the 1 s poll as a ≤1 s delay and state it.
- `request` = the latest context `attention` (it persists after `hand_off` finishes until the next turn starts or a new snapshot clears it), or an open `ask_user_question` call.
- Visibility follows Hub exactly (`detailFieldLines()`, `rosterLines()`): DONE/NEXT hidden when DOING exists; NEXT hidden under any request; DONE hidden under a `ready` request; the SAID fallback not used under a request. A hidden field is scored `n/a`, not judged.
- `roster` = the line the roster would show, following the precedence above.
- Real sessions lack selection and acknowledgement data, so their visibility is labeled *estimated* (assumes the session is selected and the handoff unread).

### Actual state (what the agent did)

From messages: the open tool call or latest finished one (tool name + short argument), latest assistant text, and turn boundaries (user message → final assistant `stopReason: stop`). Thinking text is excluded from judge input.

Session `.jsonl` files do not record `agent_start/end` or `tool_execution_start/end`. So:
- Mock runs also save the timestamped RPC event stream (`events.jsonl` beside the session file). Replay uses it for exact tool intervals and running/idle periods when present.
- Real sessions use message timestamps only: a tool interval is assistant toolCall message → its toolResult; time after a final `stop` message until the next user message is idle. Intervals that cannot be bounded are excluded from timing metrics and counted as `unknown`.

### Deterministic metrics (per session and aggregate)

- `note_lag_s`: time from turn end to the progress entry that follows it; and the count of turns that got no note (skipped).
- `note_age_at_action_s`: for each tool call, age of the shown note. Report median, p90, and the share of tool calls shown under a note older than the current turn.
- `stale_turn_share`: share of wall time where the shown NEXT was produced before the current turn began.
- `doing_task_lag`: in Execute, time between edits to files and the plan checkbox tick that advances DOING (from plan-file `edit`/`write` tool calls on the plan path).
- `field_dwell_s`: how long each distinct DOING/NEXT/SAID value stayed shown.
- `said_narration_age_s`: for each tool call, how old the shown SAID text is, and the share of tool calls shown under narration written before the previous tool call finished (cause 6).
- `said_fallback_share`: share of wall time SAID came from the handoff fallback, and how often that fallback predates the current user message (cause 7).

### Judge (LLM)

- Sample moments: stratified by roster field shown and by position in turn (start, middle, end); default 120 moments over all sessions, capped per session.
- Input per sample: shown DOING/DONE/NEXT/roster line, the next 3 and previous 3 tool calls (name + short arg), last assistant text (≤600 chars), user message that opened the turn (≤400 chars).
- Shown SAID is included (≤600 chars).
- Output JSON: `{"doing": "match|stale|wrong|n/a", "next": …, "done": …, "said": …, "reason": "≤140 chars"}`. For SAID, match = the agent's current message or the latest one still relevant to its action. Definitions in the judge prompt, per field: DOING / NEXT / SAID match = describes the current or immediate action (SAID may also be the latest message still relevant to it); DONE match = a true summary of work completed so far. stale = was true of an earlier state that has ended. wrong = the supplied evidence contradicts it. `unclear` = the evidence neither supports nor contradicts it. The judge never infers `wrong` from absence of evidence.
- Model `openai/gpt-6.1-sol` through Pi's model registry (`@earendil-works/pi-ai` `complete`, the same path as `session-model.ts`). No API key in files.
- Spot-check: the report lists 10 random verdicts with their inputs (mock sessions only) for the user to check.

### Mock scenarios (~15 runs)

Run every mock through persistent `pi --mode rpc` driven by `run-mocks.ts` (not `-p`: print-mode teardown fires `session_shutdown` and drops the fire-and-forget progress note). Command: `pi --mode rpc --no-extensions --session-dir <tmp>/sessions -e <rules worktree>/extensions/workflow-runtime/index.ts -e <question extension>`, plus any extension the model provider needs, in a throwaway git repo copied from a small fixture. Environment: unset `PI_TMUX_SUBAGENTS_JOB_ID` (it disables notes), `PI_AGENT_HUB_PRIMARY_CWD`, `PI_AGENT_HUB_FORK_COMPACT`, and other `PI_AGENT_HUB_*` markers. After the last turn, wait for the final progress entry or a metadata failure (bounded, 30 s) before closing.

Fixture `tools/card-signal/fixture/`: a tiny Node project with a failing test, an `agent-work/features.yaml` with one ticket whose `plan_file` points at a 2-phase plan. Scenario 4 selects that ticket and the Execute step through the extension's commands before its prompt. Hub extension is not loaded; the study reads entries the Rules extension writes. Metadata model calls must be enabled (the default).

Scenarios (scripted user turns sent over RPC; scenario 3 answers the question through RPC `extension_ui_request`/`extension_ui_response`, not a new prompt):
1. Long single turn: fix the failing test, then refactor, in one prompt.
2. Topic switch: debug a bug, then the user asks an unrelated question.
3. Decision wait: the agent must ask the user a question; the script answers after 20 s.
4. Execute step on the fixture plan (2 phases), with checkbox ticks.
5. Review step with `set_workflow_activity` items.
6. Short Q&A turns only (no tools).
7. Aborted turn mid-tool, then resume.

Models: scenarios 1–7 on `openai/gpt-6.1-sol`; 1, 2, 4, 6 repeated on `openai/gpt-6.1-terra`; 1 and 4 on `claude-opus-5-5` (claude-code provider). Total 13–15 runs. Stop and report if a run cannot start.

### Real-session sample

Read-only: the 25 most recently modified `.jsonl` files under `~/.pi/agent/sessions` that contain at least one `progress` entry and ≥10 tool calls, skipping subagent sessions. Real sessions get deterministic metrics and judge verdicts in aggregate only. The report and committed outputs quote no real conversation text and no paths beyond the session directory name hash. Raw real-session outputs go to `/tmp` (not committed).

### Report

`pi-agent-hub/agent-work/tickets/card-signal-001/report.md` (committed), with:
- Method and assumptions in 5 lines.
- Table: per field (DOING, DONE, NEXT, SAID, roster line) the match / stale / wrong share, mock vs real.
- Timing metrics table.
- Ranked drift causes with evidence (counts, example mock moments), mapped to suspected causes 1–5 or new ones.
- Recommendations for 002 and 003 (for example: refresh notes mid-turn, add tool calls to note input, change precedence). Recommendations only; no producer changes in this ticket.
- 10 spot-check verdicts from mock sessions.

Mock-session outputs (`timeline.jsonl`, `metrics.json`, `verdicts.jsonl`) go to `agent-work/tickets/card-signal-001/mock/` (committed, small). Delete raw mock session dirs after extraction unless under 2 MB total.

## Reuse

- `rules/extensions/workflow-runtime/session-context.ts`: `parseContextSnapshot`, `recentTranscript`, `normalizeText`, `CONTEXT_ENTRY_TYPE`.
- `rules/extensions/workflow-runtime/session-model.ts`: model resolution + `complete` call pattern for the judge (copy the call options, not the fallback list).
- `rules/tests/workflow_runtime*.test.mjs`: node test style for the tool's unit tests.
- Pi CLI `--mode json|rpc`, `--session-dir`, `-e` for mock runs.
- No new dependencies.

## Implementation Phases

### Phase 1: Replay and metrics
- [ ] Write `tests/card_signal_replay.test.mjs` (Rules) on a small hand-made `.jsonl` fixture covering branch following, shown state at given times (including SAID live vs fallback and SAID cleared by a new user message), open tool calls, skipped notes, and metrics values; see it fail.
- [ ] Implement `tools/card-signal/replay.ts` and `metrics.ts` until it passes.
- [ ] Add `cli.ts replay` writing `timeline.jsonl` and `metrics.json`; run it on this session's own file (`$PI_SESSION_FILE` of any existing session) as a smoke check.

### Phase 2: Judge
- [ ] Test sampling (stratified, deterministic with a seed) and verdict parsing (valid, malformed, cached) with a stubbed model call; see it fail.
- [ ] Implement `judge.ts` with cache; run `--judge --sample 5` on one real session to confirm the model call works.

### Phase 3: Mock sessions
- [ ] Add the fixture project and scenario scripts; implement `run-mocks.ts` (rpc driver) and `run-mocks.sh`.
- [ ] Run one scenario end to end and confirm the resulting `.jsonl` contains progress and workflow-runtime entries.
- [ ] Run all scenarios across the agreed models (13–15 runs).

### Phase 4: Analysis and report
- [ ] Replay + judge all mock sessions and the real-session sample.
- [ ] Write `report.md` with tables, ranked causes, recommendations, spot-checks.
- [ ] Add `tools/card-signal/README.md` with the rerun command.
- [ ] Run `env -u PI_AGENT_HUB_PRIMARY_CWD -u PI_AGENT_HUB_FORK_COMPACT uv run pytest -q` and the new node test in Rules.

## Acceptance Criteria

- [ ] `node --experimental-strip-types tools/card-signal/cli.ts replay <session.jsonl> --out <dir>` produces a timeline and metrics for any Pi session file; the replay test passes.
- [ ] At least 13 mock sessions across gpt-6.1-sol, gpt-6.1-terra and claude-opus-5-5 ran and were scored; at least 20 real sessions were scored.
- [ ] The judge scored at least 100 moments, and rerunning with the same inputs makes no new model calls (cache hit).
- [ ] `report.md` gives per-field match/stale/wrong shares for DOING, DONE, NEXT and SAID (mock vs real), timing metrics, ranked drift causes with evidence, and concrete recommendations for 002 and 003.
- [ ] No committed file contains real-session conversation text; Rules' existing test suite still passes.

## Discovered Work

(none yet)

## Reflection Candidates

- Rules `README.md`: one line pointing at `tools/card-signal/README.md`.
