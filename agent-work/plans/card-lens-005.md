**Feature:** card-lens-005 → Subagent Lens
**Session:** e2efffb1-7770-475a-9b8a-903910fa2977
**Worktree:** `/Users/manager/.local/share/agent-worktrees/card-lens-005-c89e71214ea1/pi-agent-hub` and `…/pi-tmux-subagents`, branch `card-lens-005` (record `/Users/manager/.local/share/agent-worktrees/card-lens-005-c89e71214ea1/worktree.json`)
**Start branch:** `main` (both repos; local `main` includes unpushed commits: pi-agent-hub 1, pi-tmux-subagents 3)
**PR target:** `main` (both repos)

# card-lens-005 · Subagent Lens

Epic: `agent-work/plans/card-lens-000.md`. Builds on the lens contract from card-lens-001 (`agent-work/history/20261111_card-lens-001_step_lens_contract.md`).

A subagent that runs a workflow skill, such as a `ticket-runner` child, already has the Rules `workflow-runtime` extension loaded and publishes `workflow-runtime` entries in its own Pi session (verified: the card-lens-004 runner session has 15 such entries). Its Hub heartbeat is written by `pi-tmux-subagents`, which never reads them, so Hub shows only the name and task preview. This ticket makes the child's heartbeat carry Hub's existing `workflow`/`lens` fields and lets Hub show them on subagent rows and the selected subagent.

## Proposed behavior

```text
▾ ● Run card-lens   ↳2                          RUN 3m
  ├─ ● runner-001  EX  Add at to conversation items
  └─ ● runner-002  RV  Fixing parser stall

selected runner-001 (no plate, no stripe):
  DOING  Add at in src/core/conversation.ts
  WHERE  PL✓ EX◉ RV· RF· CM· │ 1✓ 2◉ 3·  ▰▰▱▱ 5/12
  PLAN   Conversation transport
         ◉ Add at in src/core/conversation.ts
         · web-server test: detail returns page
  NOW    3s  edit    src/core/conversation.ts
  LOG    9s  bash    npm test -- conversation
```

A child without workflow data looks exactly as today: name and task preview, and no card.

## Confirmed decisions

- **Child converts to Hub's shape.** `pi-tmux-subagents` reads the child session's latest `workflow-runtime` entry and writes Hub's existing heartbeat fields: `workflow` (`steps`, `activeIndex`, `updatedAt`, optional `ticketId`, `currentStepComplete`, `activity`, `lens`) for a positioned entry, or top-level `lens` for a lens-only entry. Hub's heartbeat contract stays producer-neutral; any producer can fill the same fields. Hub parses them with its existing `parseWorkflowSnapshot`/`parseWorkflowLens`, so Hub needs no parser change.
- **Compact row plus selected card.** The micro row keeps its tree glyph, state and agent name, adds the child's step short code, and shows the lens DOING in place of the task preview when present. Selecting such a child shows its own field card (DOING, WHERE, lens list, NOW, LOG, SAID when available) inline, with no plate and no stripe. A child without workflow data keeps today's micro row and no card.
- The conversion copies only display fields; it never forwards Rules-private state (`activityPasses`, `stepFacts`, `stepItems`, `orchestration`, `worktreeRecord`, `source`, `execution`, `heldStep`, `plan`).
- The child heartbeat also carries Hub's `activity` (current and recent tool calls) so NOW/LOG work on the subagent card, using the same tool-name/short-argument bounds as Hub's extension. Tool output is never included.
- The workflow stays retained like a parent's (`retainedWorkflow`), so a finished child keeps its last card until its row is pruned.

## Context Files

**Core (pi-tmux-subagents):** `src/child-bootstrap.ts` (`heartbeat()` ~227-268, `tool_call`/`tool_result` handlers ~383-393), new `src/hub-workflow.ts`, `test/child-bootstrap.test.ts`, `README.md`.

**Core (pi-agent-hub):** `src/tui/layout.ts` (`renderSessionRow` subagent branch ~2529, `pushRow` card gating ~816-860, `detailFieldLines` ~2428, `actionWorkspaceBlocks` ~1581), `src/tui/render-model.ts` (`toRenderSession` ~1150-1158), `test/framed-cards.test.ts`, `test/instrument-panel.test.ts`, `docs/STRUCTURE.md`, `docs/FEATURES.md`, `AGENTS.md`.

**Reference:** `src/core/heartbeat.ts` (`parseWorkflowEntry`, `parseWorkflowSnapshot`, `parseWorkflowLens`, `ACTION_DETAIL_MAX`, `ACTIVITY_RECENT_MAX`), `src/extension/index.ts` (`workflowFields`, `actionDetail`, tool hooks ~348-360), Rules `extensions/workflow-runtime/core.ts` (`withWorkflowDefinition` entry shape).

## Reuse

- Hub already parses `workflow`, `lens` and `activity` on every heartbeat, including subagent ones (`heartbeat.ts:36-72`), retains them in `applyComputedStatus` (`status.ts:114-115`) and passes them to `RenderSession` (`render-model.ts:1157-1158`). Only layout ignores them for subagents.
- Hub's `detailFieldLines` and `whereLine` render any session's lens; the subagent card reuses them unchanged.
- The child heartbeat already runs every 2 s and on lifecycle events, so the converted fields refresh without new triggers.
- New `src/hub-workflow.ts` in pi-tmux-subagents: one small pure module (entry → Hub fields, tool call → action). Needed because the child bootstrap has no Hub dependency; it mirrors only the documented heartbeat contract in Hub `docs/CONFIG.md`.

## Design

### pi-tmux-subagents

```ts
// src/hub-workflow.ts
export function hubWorkflowFields(entries: unknown[]): { workflow?: HubWorkflow; lens?: HubLens } {
  // latest custom entry with customType "workflow-runtime"
  // activeStep present → workflow: { steps, activeIndex: steps.findIndex(id === activeStep), updatedAt, ticketId?, currentStepComplete?, activity?, lens? }
  //   (activeIndex < 0 or malformed steps → {})
  // no activeStep but lens → { lens }
}
export function hubAction(toolName: string, args: unknown, cwd: string): { tool: string; detail?: string; at: number }
```

- `heartbeat()` reads `ctx.sessionManager?.getBranch?.()` and spreads `hubWorkflowFields(...)` and `activity` into the Hub file only (not the internal job heartbeat).
- Activity mirrors Hub's extension (`src/extension/index.ts:348-365`): `tool_execution_start` adds to a `running` map keyed by `toolCallId`, skipping nested calls (`parentToolCallId`) and conversation tools (`ask_question`, `ask_user_question`, `hand_off`); `tool_execution_end` moves the entry into `recent` (max 6); `agent_end` and session shutdown clear `running`. `current` is the most recent running entry. Question attention stays on its existing `tool_call`/`tool_result` hooks.
- Fields are omitted when absent, so older Hubs and non-workflow children see no change.

### pi-agent-hub (layout only)

- `renderSessionRow` subagent branch: after the agent name, show the step short (`rosterStep`-style, accent when active) when `workflow` is positioned, then the lens `doing` in place of `taskPreview` when present; width order: name, step, doing/task.
- `pushRow`: only when `inline && (session.workflow || session.lens)`, a selected subagent gets continuation lines from `detailFieldLines` (not the ticket summary), indented under the micro row, with no `selectedCardIdentity` frame. The inline workspace additions for request, receipt and task (`layout.ts` ~864) are skipped for this field card, since `detailFieldLines` already shows the request. The docked strip below 100 columns uses the same lines via the existing inline → dock path (`layout.ts:316-318`), so fields render once.
- No plate or stripe: the dock painter (`layout.ts` ~247-249) and the selected micro-row stripe (`layout.ts` ~2523-2531) exempt a workflow-bearing subagent's card lines, while the roster selection marker on its micro row stays.
- `actionWorkspaceBlocks`: the workflow block uses the child's own workflow when it has one, else its owner's as today.
- Subagents without workflow or lens: unchanged code paths.

## Implementation Phases

### Phase 1: Child heartbeat carries workflow, lens and activity (pi-tmux-subagents)

- [ ] Add failing tests in `test/child-bootstrap.test.ts` using the existing `loadBootstrapHandlers`/`withChildEnv` harness with a fake `sessionManager.getBranch()`:
  - a positioned `workflow-runtime` entry (execute, lens with progress and PLAN list) becomes Hub `workflow` with the correct `activeIndex` and `lens`, and private fields (`activityPasses`, `stepFacts`, `orchestration`, `worktreeRecord`, `plan`) are absent;
  - a lens-only entry (no `activeStep`, with `heldStep`) becomes top-level `lens` with no `workflow`;
  - the latest entry wins; an unknown `activeStep` or malformed `steps` yields neither field; no entry yields neither field;
  - the internal job heartbeat (`jobs/<id>/heartbeat.json`) has none of these fields;
  - `tool_execution_start` for `bash` sets `activity.current` with a bounded detail and `tool_execution_end` moves it to `recent`; two overlapping calls both reach `recent` in end order; a nested call (`parentToolCallId`) and `ask_question` are not logged; `agent_end` clears running calls after an interruption.
- [ ] Implement `src/hub-workflow.ts` and wire it into `heartbeat()` and the tool handlers.
- [ ] Update `README.md` (Hub heartbeat fields).
- [ ] Verify: `npm test` in the pi-tmux-subagents worktree.

### Phase 2: Hub shows the subagent lens (pi-agent-hub)

- [ ] Add failing tests:
  - `test/instrument-panel.test.ts`: a subagent with a positioned workflow and lens renders `runner-001  EX  <doing>` as its micro row at 100 and 160 columns; without a lens it keeps `name task`; at narrow widths the name stays and doing truncates first.
  - Selecting that subagent shows DOING, WHERE (with rail and stages) and the PLAN list under the micro row exactly once, with no stripe or plate on its card lines, asserted against the child's own ID (extend `test/framed-cards.test.ts:181`; its current checks use parent `"s"`, and it keeps the no-WHERE assertion for a child without workflow).
  - The docked strip below 100 columns shows the same fields once, unpainted.
  - A request on that subagent appears once (from `detailFieldLines`), not repeated by the workspace block.
  - The parent's SUB line, `↳N` count and collapse behavior are unchanged.
- [ ] Implement the row, card and workspace changes in `src/tui/layout.ts`.
- [ ] Verify: `npm test`, then `npm run package:check`.

### Phase 3: Docs and end-to-end

- [ ] Update Hub `docs/STRUCTURE.md` (subagent rows may carry workflow/lens and a selected card), `docs/FEATURES.md` (subagent rows), `AGENTS.md` (subagent micro rows now show step and DOING; selected subagent card without plate), `CHANGELOG.md`; pi-tmux-subagents `README.md`/`CHANGELOG.md` if present.
- [ ] End-to-end: in tmux, run a parent Pi session with this worktree's pi-tmux-subagents and Hub extensions and the installed Rules extension, under a temporary `PI_AGENT_HUB_DIR`; launch one `ticket-runner`-style child that runs `set_workflow_step execute` on a small temp ticket with a plan; capture `pi-hub tui` from this worktree's `dist` showing the micro row and the selected child card. Save to `agent-work/tickets/card-lens-005/validation.md`.

## Acceptance Criteria

- [ ] A subagent whose session runs a workflow skill shows its step short code and DOING on its micro row. *(Phase 2 render test; Phase 3 capture)*
- [ ] Selecting that subagent shows its own DOING, WHERE, lens list, NOW and LOG, with no plate or stripe. *(Phase 2; Phase 3 capture)*
- [ ] A subagent without workflow data looks exactly as today. *(Phase 2; existing subagent tests stay green)*
- [ ] The child heartbeat uses only Hub's existing `workflow`, `lens` and `activity` fields and forwards no Rules-private state; Hub's heartbeat parser is unchanged. *(Phase 1 tests; Hub diff has no `heartbeat.ts` change)*
- [ ] pi-tmux-subagents `npm test`, Hub `npm test` and `npm run package:check` pass. *(Phases 1–2)*

## Reflection Candidates

- `pi-agent-hub/AGENTS.md` subagent micro-row rule ("omit parent rails, age, workflow, and metadata adornments").

## Discovered Work
