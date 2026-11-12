**Feature:** card-lens-001 → Step Lens Contract
**Session:** e2efffb1-7770-475a-9b8a-903910fa2977 (parent orchestrator)
**Worktree:** `/Users/manager/.local/share/agent-worktrees/card-lens-001-8f1539b13cdc/pi-agent-hub` and `…/rules`, branch `card-lens-001` (record `…/card-lens-001-8f1539b13cdc/worktree.json`)
**Start branch:** `card-lens-integration` (both repos)
**PR target:** `card-lens-integration` (both repos; the integration branch targets `main`)

# card-lens-001 · Step Lens Contract

Epic: `agent-work/plans/card-lens-000.md`. Mocks: `agent-work/decks/dashboard-card-lenses.html` (pages Working, Question, Error, Execute; Proposed view).

Rules publishes one step-agnostic `lens` inside the `workflow-runtime` entry. Hub draws it on the selected fleet card and the roster line without checking any step id. Pins, the board and the phone inbox keep their current inputs. This ticket fills the lens for every step from data Rules already has: Execute from the plan file, other steps from their activity. Tickets 002–004 add richer lists per step.

## Proposed behavior

Selected card, Execute (100+ columns):

```text
DOING  Add at in src/core/conversation.ts
WHERE  PL✓ EX◉ RV· RF· CM· │ 1✓ 2✓ 3◉ 4· 5·  ▰▰▰▰▱▱▱▱ 11/19
PLAN   Conversation transport and merge
       ✓ conversation test: item carries at
       ◉ Add at in src/core/conversation.ts
       · web-server test: detail returns page
       · 2 more
NOW    12s edit    src/core/conversation.ts
LOG    40s bash    npm test -- conversation
```

Selected card, Review (no list until card-lens-003):

```text
DOING  Fixing findings
WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
NOW    3s  edit    web/markdown.js
```

Roster line (selected or not): `DOING Add at in src/core/conv…   ▰▰▰▰▱▱▱▱ 11/19`. Requests and errors still win the line; without a lens the line keeps today's order.

Without a lens (other producers, sessions before reload): DONE/NEXT stay as today, WHERE shows the rail only, no list.

## Confirmed decisions

- One generic lens shape; Rules owns all wording. The fleet card and roster never check a step id. `executePlan()` stays only for pin views (`fleetMetadataLine`, `workspacePlanLines`), which are out of scope here.
- Lens fields: `doing` (one line), `stages` (ordered labels with state), `progress` (completed/total with an optional unit), `pass`, and `list` (label, optional head, items with state, before/after counts). All optional.
- Execute: `doing` = first unchecked task; `stages` = phase numbers; `progress` = task counts; `list` = `PLAN` with the phase title as head and the current window of tasks.
- Other steps: `doing` = current activity label; `stages` = the step's activity stages; `pass` = the step's review-activity count from `activityPasses`, so it stays visible during the following fix stage. No list yet.
- Activity definitions gain a short `stage` label; several activities can share a stage (`updating-plan` shares `critic`).
- NOW shows only live tool activity and `Thinking…`; the activity label leaves NOW and the roster's activity fallback.
- Roster line: when a lens has `doing`, it shows `DOING` with lens progress at the right edge, ahead of the live tool call.
- DONE/NEXT rows are hidden when the lens has `doing`; otherwise they render as today.
- The STEP/TASK/PHASE readout becomes one `WHERE` field line: rail, then `│` and stages, then progress meter and count, then `pass N`, then the focus mode short. Narrow widths drop pieces right to left, keeping the rail (compact rail below the current fit).
- The lens is retained in `registry.json` with the base workflow, so a stale or stopped session keeps its card. It is bounded (list ≤ 12 items × 120 chars), so retention is small.
- `plan.current` moves into `lens.list`; Rules stops publishing `plan.current` and Hub stops parsing it. `plan` keeps phase, tasks, phases and nextStep for the board recap, filter and the Rules widget.
- The board recap, pin views (`fleetMetadataLine`, `workspacePlanLines`) and phone inbox keep their current inputs in this ticket.
- `lens` is derived at publish and never restored: `findLatestState` strips it like `steps` and `activeMode`.

## Context Files

**Core (rules):** `extensions/workflow-runtime/core.ts` (activity definitions, entry shape), `extensions/workflow-runtime/workflow-plan.ts` (projection), `extensions/workflow-runtime/index.ts` (publish path), `tests/workflow_runtime.test.mjs`, `tests/workflow_runtime_extension.test.mjs`, `README.md`.

**Core (pi-agent-hub):** `src/core/types.ts`, `src/core/heartbeat.ts`, `src/core/status.ts` (`retainedWorkflow`), `src/app/controller.ts` (`liveDetails` checklist overlay), `src/tui/render-model.ts` (`planSummary`), `src/tui/layout.ts` (`readoutFields`, `planFieldLines`, `rosterLines`, `rosterProgress`, `fleetMetadataLine`, `workspacePlanLines`, `detailFieldLines`, `executePlan`), `src/extension/fork-compact.ts`, `docs/CONFIG.md`, `docs/STRUCTURE.md`, `docs/FEATURES.md`.

**Reference:** `test/instrument-panel.test.ts`, `test/heartbeat.test.ts`, `test/status.test.ts`, `test/render-model.test.ts`, `test/extension.test.ts`, `test/inbox-cards.test.ts`, `test/compact-fleet.test.ts`, `test/dense-fleet.test.ts`.

## Reuse

- Rules `parseWorkflowPlan` projection and `currentWindow` already produce the checklist window and counts; the lens is derived from it plus `WORKFLOW_ACTIVITIES` in a pure function beside `withWorkflowDefinition` (`core.ts`).
- Rules publish path (`setState` → `persistState`) and `refreshPlan` dedupe stay as they are; the lens is computed at publish, so it needs no new trigger.
- Hub `parseWorkflowEntry` decoration pattern: each optional projection validates independently (`parseWorkflowActivity`, `parseWorkflowPlan`); `parseWorkflowLens` follows it.
- Hub layout helpers `fieldLines`, `taskMeter`, `styledWorkflowMarker`, `railCompact`, `twoColumn`, `truncate`, and the existing marker glyphs (`✓ ◉ · !`) render the lens.

## Removed by this change

- `executePlan()` from the fleet card, readout, PLAN field and roster; it remains only in the pin paths.
- `readoutFields`/`lcdLines`/`readoutLine` STEP/TASK/PHASE readout, replaced by the WHERE line.
- `planFieldLines` reading `plan.current`; the controller `liveDetails.checklist` overlay; `retainedWorkflow`'s `plan.current` stripping; Hub `parseCurrentTasks`.
- Rules `plan.current` in the published projection (the drawer and widget do not use it).
- The workflow activity label in NOW and in the roster fallback chain.

## Design

### Lens contract (Rules → Hub)

```ts
type LensState = "done" | "active" | "pending" | "attention" | "skipped";
type WorkflowLens = {
  doing?: string;                                  // ≤ 160 chars
  stages?: { label: string; state: "done" | "active" | "pending" }[]; // ≤ 12, label ≤ 24
  progress?: { completed: number; total: number; unit?: string };     // unit ≤ 16, e.g. "tasks"
  pass?: number;                                   // ≥ 2 only
  list?: { label: string; head?: string;           // label ≤ 6 display cells, head ≤ 120
           items: { state: LensState; text: string }[];             // 1–12 items, text ≤ 120
           before: number; after: number };
};
```

Hub validates each field independently; an invalid field is dropped without hiding the rest of the lens or the base workflow.

### Rules derivation (`core.ts`)

`workflowLens(state)` runs inside `withWorkflowDefinition`:

- No `activeStep` or `currentStepComplete`: omit the lens. A finished step shows its rail only.
- Plan available and `activeStep === "execute"` (the producer, not Hub, owns this choice): `doing = plan.nextStep`; `stages` from `plan.phases` (`"1"…"N"`, done when complete, active for the current phase); `progress = { ...plan.tasks, unit: "tasks" }`; `list = { label: "PLAN", head: phase.title, items: current window (done → done, first open → active, others pending), before, after }`.
- Other steps: `doing = activity.label`; `stages` = distinct `stage` labels of the step's activity definitions in order, marked done/active/pending against the current activity's stage; `pass` = the highest `activityPasses` count among the step's review activities, when > 1.
- `WORKFLOW_ACTIVITIES` gains `stage`: plan-md inspect/scope/write/critic/critic/ready; review review/fix/done; reflect review/update/done; commit archive/commit.
- The window for the list needs the plan sections, not only the projection. `PlanProjection.current` stays internal to Rules: `refreshPlan` keeps it in `state.plan` for derivation, and `withWorkflowDefinition` publishes `plan` without `current`.
- `findLatestState` strips `lens` on restore, so a reload never republishes an old lens after completion or unlinking.

### Hub

- `types.ts`: `WorkflowLens` on `WorkflowSnapshot` (retained, not runtime-only); remove `SessionPlanSummary.current`.
- `heartbeat.ts`: `parseWorkflowLens` with the bounds above (list label measured with `displayWidth`); `parseWorkflowSnapshot` attaches it.
- `status.ts`: `retainedWorkflow` keeps `lens`; drop the `plan.current` branch.
- `controller.ts`: remove the `checklist` part of `liveDetails`; `activity` stays live-only.
- `render-model.ts`: pass `workflow.lens` through (`RenderSession.workflow` already carries the snapshot); drop `current` from `planSummary`.
- `layout.ts`:
  - `lensOf(session)`: returns the lens for live or stopped sessions alike, since it is retained work state.
  - `whereLine(session, width, styles, terminalWidth)`: `rail │ stages  meter n/m  pass N  MODE`, dropping mode, pass, meter (count stays), stages, count in that order; rail falls back to `railCompact`.
  - `detailFieldLines`: request/ERR first; then `DOING` (bold, wraps at the prose measure) when present, else today's DONE/NEXT; then `WHERE`; then the lens list (`label` in the label column, `head`, items with `✓ ◉ · ! –`, `✓ N earlier` / `· N more`); then NOW (tool call or Thinking only), LOG, SUB, SAID. Replying hides WHERE and the list as it hides the readout today. The compact dock keeps the phase head and the active item only, as `planFieldLines` does today.
  - `rosterLines`: after request and ERR, a lens `doing` takes the line as `DOING` (live tone while running), with `lensProgress` at the right edge; then today's order without the activity entries.
  - `rosterProgress` reads `lens.progress`. `fleetMetadataLine` and `workspacePlanLines` are unchanged (pins, out of scope).
  - The list label renders through a width-safe path; `fieldLabel()` must never throw on producer text.
- `fork-compact.ts`: add `lens` to the stripped workflow fields.

## Implementation Phases

### Phase 1: Rules lens derivation

- [ ] Add failing pure tests in `tests/workflow_runtime.test.mjs`: Execute lens from a parsed plan (doing, phase stages, progress, PLAN list window with before/after, active item); plan-md lens stages across all six activities including `updating-plan` sharing `critic`; review pass 2 then `fixing-review-findings` keeps `pass: 2`; no lens without an active step or after `currentStepComplete`; published `plan` has no `current`; `findLatestState` drops a stored `lens`.
- [ ] Add `stage` to `WORKFLOW_ACTIVITIES`, the `WorkflowLens` type and `workflowLens(state)` in `core.ts`; publish it from `withWorkflowDefinition`; strip `plan.current` from the published entry.
- [ ] Extend the extension test that writes a plan file and emits `tool_execution_end` to assert `latest("workflow-runtime").lens` (doing, progress, list) and that the plan widget and `/wf-todos` drawer still render. Add a reload case: restore from an entry with a lens, complete the workflow and unlink the ticket, and assert no lens is published.
- [ ] Update `README.md` (activity and plan bullet) with the lens fields and the `stage` labels.
- [ ] Verify: `env -u PI_AGENT_HUB_PRIMARY_CWD -u PI_AGENT_HUB_FORK_COMPACT uv run pytest -q` passes in the rules worktree.

### Phase 2: Hub contract and retention

- [ ] Add failing tests: `test/heartbeat.test.ts` parses a full lens, bounds each field (a list label wider than 6 cells, including wide Unicode, is dropped), drops one malformed field while keeping the rest and the base rail, and ignores `plan.current`; `test/status.test.ts` retains `lens` across a stale heartbeat; `test/extension.test.ts` bridges `lens` from the entry.
- [ ] Implement `WorkflowLens` types, `parseWorkflowLens`, `retainedWorkflow`, the controller `liveDetails` cleanup, `planSummary` without `current`, and the `fork-compact` strip list.
- [ ] Verify: `npm run typecheck` and the touched test files pass.

### Phase 3: Hub card, roster and workspace

- [ ] Add failing render tests in `test/instrument-panel.test.ts`: the Execute card matches the proposed block above at 100 and 160 columns; a Review lens shows DOING and WHERE with stages and `pass 2` and no list; a card without a lens keeps DONE/NEXT and shows WHERE with the rail only; NOW never shows the activity label; WHERE drops pieces in the stated order as width shrinks; replying hides WHERE and the list; the roster line shows DOING with progress ahead of a live tool call, while ASK and ERR still win; a stopped session with a stale heartbeat keeps DOING, WHERE and the list.
- [ ] Add a render test that a producer with a non-`execute` step id and a lens gets the full lens display, proving no step-id check remains.
- [ ] Implement `lensOf`, `whereLine`, the list renderer, and the `detailFieldLines`, `rosterLines` and `rosterProgress` changes; delete the readout functions and `planFieldLines`. Pin rendering stays unchanged and covered by its existing tests.
- [ ] Update existing tests that assert the STEP/TASK/PHASE readout, PLAN-from-`current`, NOW activity and roster activity fallback to the new behavior (`instrument-panel`, `render-model`, `inbox-cards`, `compact-fleet`, `dense-fleet`, `inbox-content`, `phone-layout`). Pin-view tests stay unchanged.
- [ ] Verify: `npm test` passes, then `npm run package:check` (one after the other).

### Phase 4: Docs and end-to-end check

- [ ] Update `docs/CONFIG.md` (workflow bridge: lens fields, bounds, retention, `plan.current` removed), `docs/STRUCTURE.md` (no step-id checks; lens retained), `docs/FEATURES.md` (card fields DOING/WHERE), `CHANGELOG.md`.
- [ ] End-to-end: run a real Pi session in tmux with both worktrees' extensions loaded, link a ticket with a plan file on step `execute`, and capture the Hub card with `pi-hub tui` from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`; confirm DOING, WHERE and the PLAN list match the mock, then switch to `review` with an activity and confirm the stage line. Save the captures in `agent-work/tickets/card-lens-001/validation.md`.

## Acceptance Criteria

- [ ] On Execute, the selected card shows DOING (first open task), WHERE (rail, phase stages, task meter and count) and the PLAN list from the lens, with no STEP/TASK/PHASE readout. *(Phase 3 render test; Phase 4 end-to-end capture)*
- [ ] Plan, Review, Reflect and Commit cards show DOING from the activity and WHERE with that step's stages and pass count; no list. *(Phase 1 derivation tests; Phase 3 Review render test; Phase 4 capture)*
- [ ] The fleet card and roster contain no step-id check: a lens under any step id renders fully. *(Phase 3 non-execute producer test)*
- [ ] NOW shows only the live tool call or Thinking; the activity label appears nowhere in NOW or the roster fallback. *(Phase 3)*
- [ ] The roster line shows DOING with lens progress ahead of a live tool call; requests and errors still take the line first. *(Phase 3)*
- [ ] A session with a stale heartbeat or a stopped session keeps its last DOING, WHERE and list; a reload after completion or unlinking publishes no old lens. *(Phase 1 reload test; Phase 2 status test; Phase 3 render test)*
- [ ] A session without a lens shows DONE/NEXT as today and WHERE with the rail only; requests, ERR, LOG, SUB and SAID render as before. *(Phase 3; existing tests stay green)*
- [ ] A malformed lens field is dropped without hiding the rest of the lens or the rail. *(Phase 2 heartbeat test)*
- [ ] Rules tests, Hub `npm test` and `npm run package:check` pass. *(Phases 1, 3)*

## Reflection Candidates

- `pi-agent-hub/AGENTS.md` TUI rules name the STEP readout LCD, the field order and NOW's activity; update to DOING/WHERE/lens list.
- Rules `README.md` says Execute omits activity; restate as "Execute publishes a lens from the plan".

## Discovered Work
