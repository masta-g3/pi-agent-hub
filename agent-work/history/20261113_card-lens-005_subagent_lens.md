**Feature:** card-lens-005 → Subagent Lens
**Worktree:** `card-lens-005` in pi-agent-hub and pi-tmux-subagents (record `~/.local/share/agent-worktrees/card-lens-005-c89e71214ea1/worktree.json`)
**Start branch / PR target:** `main` in both repos

# card-lens-005 · Subagent Lens

Epic: `agent-work/plans/card-lens-000.md`. Builds on the card-lens-001 lens contract.

Workflow subagents (such as `ticket-runner`) already publish `workflow-runtime` entries in their own Pi sessions, but their Hub heartbeat, written by `pi-tmux-subagents`, carried none of it. Now it does, and Hub shows it.

```text
▾ ● Run card-lens   ↳1
  └─ ● runner-001  EX  Add at to conversation items

selected runner-001 (no plate, no stripe):
  DOING  Add at to conversation items
  WHERE  PL✓ EX◉ RV· RF· CM· │ 1◉ 2·  ▰▰▱▱▱▱▱▱ 1/4
  PLAN   Transport
         ◉ Add at to conversation items
  NOW    1m  bash    sleep 240
```

## Decisions

- **Child converts to Hub's shape.** `pi-tmux-subagents` (`src/hub-workflow.ts`) maps the latest `workflow-runtime` entry onto Hub's existing producer-neutral heartbeat fields: a positioned entry becomes `workflow` (`steps`, `activeIndex`, `updatedAt`, optional `ticketId`, `currentStepComplete`, `activity`, `lens`, `activeMode`); an entry without `activeStep` becomes top-level `lens`. Producer-private run state is never copied. Hub's heartbeat parser is unchanged.
- The child heartbeat also carries `activity` (current and up to six recent tool calls), tracked like Hub's own extension: by call ID, skipping nested calls and questions/handoffs, cleared on `agent_end`. Tool events only update memory; the 2 s heartbeat or a lifecycle change publishes them, and an unmirrored child computes none of these fields.
- **Compact row plus selected card.** The micro row adds the child's step short and shows lens DOING in place of the launch task. A selected workflow child shows its own `detailFieldLines` card under its micro row, inline only, with no plate or stripe; its request appears there once. Details names the child's own step when it has one. Children without workflow data are unchanged.

## Implemented

- pi-tmux-subagents: `src/hub-workflow.ts`; `src/child-bootstrap.ts` (Hub fields on the Hub heartbeat only, in-memory tool tracking); tests for conversion, lens-only entries, rejected entries, private-field exclusion, tool activity through the periodic tick, and no branch reads when unmirrored; README and CHANGELOG.
- pi-agent-hub: `src/tui/layout.ts` (micro row, child field card, unplated dock, Details step); tests in `framed-cards` and `render-model`; AGENTS.md, STRUCTURE.md, FEATURES.md, CHANGELOG.

## Review

- code-critic (gpt-6-astra) found that tool hooks awaited a locked heartbeat write on every call; fixed by publishing on the existing tick. Re-check clean.

## Validation

- pi-tmux-subagents `npm test` 175/175; Hub `npm test` 1705/1705 and `npm run package:check` pass.
- End to end with a real parent and `lens-runner` child: `agent-work/tickets/card-lens-005/validation.md`.

## Execution notes

- The Hub test that pinned "micro rows omit workflow" now expects the step short.
- The child reads `parentToolCallId` through a cast because pi-tmux-subagents builds against Pi SDK 0.85 types.

## Discovered Work

None.
