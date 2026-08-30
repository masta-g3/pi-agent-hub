# Question routing

**Feature:** cockpit-012
**Status:** Done
**Repositories:** `pi-agent-hub` and `rules`
**Branches:** `cockpit-012`, based on and targeting `main`

## Outcome

Blocking Pi UI prompts now report `waiting` for their exact prompt span. Structured `ask_user_question` calls also publish explicit request-backed question attention, so Hub places the owning session in `NEEDS YOU`, shows the first question plus `+N more`, and offers **Answer**.

Hub remains a router. **Answer** focuses the exact existing pin when present or opens the managed Pi session. Pi's questionnaire remains the only surface for options, previews, multi-select input, notes, cancellation, and answers.

## Product decisions

- Use Pi's real questionnaire instead of recreating it in Hub.
- Show only the first question summary and a count of additional questions.
- Map every blocking Pi UI prompt to `waiting`, but require explicit producer attention for `NEEDS YOU`.
- Focus an existing exact-session pin; otherwise use normal full-session open.
- Never send an answer as blind tmux/editor text.
- Keep cockpit-004's request delivery and acknowledgement system unchanged.
- Require Pi 0.84.4 or newer for typed `ui_prompt_start` and `ui_prompt_end` events.

## Implemented design

### Hub prompt lifecycle

`src/extension/index.ts` listens to Pi's coalesced prompt events.

- `ui_prompt_start` snapshots the prior heartbeat state and `stateSince`, claims a monotonic lifecycle revision, and publishes `waiting`.
- `ui_prompt_end` restores the snapshot only while the prompt still owns that revision.
- Newer same-state or different-state lifecycle transitions invalidate restoration.
- Duplicate starts, unmatched ends, extension errors, shutdown, and child/subagent ownership cannot restore stale state.
- Periodic, theme, and naming heartbeats remain revision-neutral.

The Hub peer and development dependency floor is Pi 0.84.4. README and development requirements match that contract.

### Rules question context

`extensions/workflow-runtime/session-context.ts` extends attention with optional `requestId` and constructs structured question attention:

- SHA-256 of the exact tool call ID supplies a stable 64-character request identity.
- Existing normalization removes controls and bounds text to 96 characters.
- Space for ` (+N more)` is reserved before truncating the first question.
- Option labels, descriptions, previews, multi-select flags, and answers never enter Hub context.

`extensions/workflow-runtime/index.ts` publishes valid question attention at `tool_execution_start`. Matching `tool_execution_end` clears only the request derived from that exact tool call ID, so a late completion cannot clear a newer question. Plan's clarification activity remains intact.

A questionnaire cannot survive reload, resume, or process replacement. `session_start` therefore supersedes restored request-backed question attention while preserving ticket context, ready/blocked attention, and historical requestless attention.

### Answer routing

`src/tui/dashboard-commands.ts` reuses the existing `open` command for waiting/idle question attention:

- label: **Answer**
- guidance: `Answer in the Pi session.`
- action order: Answer, Mark read
- no Send-text answer path

`SessionsView` revalidates current question context at activation. It first calls the new `focusPinnedSession(sessionId)` lifecycle operation. That operation runs inside the serialized side-pane queue, re-inspects live pins by exact tmux target, reveals and acknowledges the exact session, and invokes target-based focus. It never carries a stale slot number. If the exact session is not pinned, SessionsView uses the established acknowledge-then-attach path.

Below 120 columns, the first Enter still opens the full-width workspace without side effects. Enter on **Answer** then performs the same exact route.

## Documentation

Updated durable documentation covers:

- generic prompt waiting and lifecycle revision ownership;
- request-backed producer question context and resume cleanup;
- **Answer** as routing to Pi rather than a Hub form;
- exact-session pin focus and stale-slot safety;
- Pi 0.84.4 minimum requirements.

Files:

- Hub: `README.md`, `docs/DEVELOPMENT.md`, `docs/FEATURES.md`, `docs/STRUCTURE.md`
- Rules: `README.md`, `docs/STRUCTURE.md`

## Verification

- Hub full suite: 855 tests passed.
- Rules focused Node suites: 71 tests passed.
- Rules pytest suite: 64 tests passed.
- `git diff --check` passed in both repositories.
- Real Pi smoke test confirmed:
  - two-question questionnaire rendered in Pi;
  - heartbeat reported `waiting`;
  - context contained a stable request ID and `Which release channel? (+1 more)`;
  - Hub rendered `NEEDS YOU`, the bounded question, guidance, and **Answer**;
  - submitting answers restored runtime state and cleared attention;
  - cancelling a later question also cleared matching attention;
  - no answer text was sent through Hub.
- Code critic first identified the stale Pi 0.83 dependency floor. The implementation raised the floor to 0.84.4 and replaced the temporary untyped event cast with typed handlers. The second pass returned `LGTM`.

## Retained evidence

`agent-work/tickets/cockpit-012/papercuts.md` records repeatable Rules worktree test-environment friction. The separate `subagent-status-001` ticket in `pi-tmux-subagents` tracks the unrelated `tmux_subagent status` parent-turn abort.
