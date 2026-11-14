**Feature:** card-signal-003 → Step Lens Parity
**Session:** 01a1dba6-d948-736d-a3a0-55ca35b3cbfe (parent orchestrator)
**Worktree:** pi-agent-hub `/Users/manager/.local/share/agent-worktrees/card-signal-003-9c8c9f6a984d/pi-agent-hub` and rules `/Users/manager/.local/share/agent-worktrees/card-signal-003-9c8c9f6a984d/rules`, branch `card-signal-003` in both
**Start branch:** `card-signal-integration` (both repos)
**PR target:** `card-signal-integration` (both repos)
**Epic:** `agent-work/plans/card-signal-000.md` (read the integration worktree copy)
**Depends on:** card-signal-002 (reuses its tool-call stage classifier). Read the 001 report's recommendations on DOING before Phase 1.

# Step Lens Parity

## Goal

Every workflow step reads the same way: the same slots, filled by the same rules, with the same marks. Take the best patterns already shipped (Plan's item list, Review's named stage track with `pass N`) and fill gaps, adding signals where a step lacks them.

## Today (from `rules/extensions/workflow-runtime/core.ts`)

| Step | DOING | Stages | Meter | List |
| --- | --- | --- | --- | --- |
| Plan | activity label | inspect scope write critic ready | none | PLAN: answered, waiting, critic pass |
| Execute | first open task | phase numbers `1 2 3` | tasks | PLAN: task window, head = phase title |
| Review | active item, else label | review fix done | none | FOUND, head counts |
| Reflect | active item, else label | review update done | none | CANDS, head counts |
| Commit | activity label | archive commit (push) | none | CLOSE: archived, ticket, commits |
| Orchestrator (unchanged) | `doing` | one ticket: steps | epic: committed | epic: TIX |

Gaps: Execute has no activity and only numeric stages; Review/Reflect/Commit have no meter although they have counts; the DOING rule differs per step; Plan's "clarifying" never shows how far planning got.

## Parity contract (one rule set for all steps)

1. **DOING** = the active list item if there is one, else the activity label. Execute: the open task is its active item, so the rule already holds. A completed step keeps today's lifecycle: its terminal label ("Review complete") wins over any stale active item, and `workflowLens()` keeps the same retained final lenses (Commit closeout, Review/Reflect lists).
2. **WHERE stages** are named words, never numbers. The active stage comes from the activity; a completed step marks all stages done.
3. **Meter** appears whenever the step has a real denominator, and never otherwise:
   - Execute: tasks done / total (as today).
   - Review: findings settled (fixed + deferred) / found. Reflect: candidates settled (applied + no action) / total.
   - Commit: no meter. Archive, ticket closeout and push are conditional in the commit skill, so there is no reliable denominator; the CLOSE list keeps its commit-count head.
   - Plan: criteria checked / criteria, only when `workflow-plan.ts` reports checked criteria; otherwise none (no forecasts, per card-lens decisions).
4. **List head** is always counts as `N noun · N noun`, with the same `✓ ◉ · ! –` marks. Execute's phase title moves into WHERE as `summary` (`phase 2/3 · <title>`) so its head becomes `N done · N open`.
5. **pass N** shows for any step that reran its critic or review (already generic via `review: true` activities).

## New signals

- **Execute activities**, derived without agent calls: stages `implement → verify → done`. `implement` while the latest classified tool call (002 classifier) is `change`/`explore`; `verify` after a `verify` call; `done` when every task is checked. Numeric phases move to `summary`.
- **Plan progress items**: `plan written` (plan file exists) and `criteria N` items in the PLAN list, so the list shows planning progress beyond questions. Extend `rules/extensions/workflow-runtime/workflow-plan.ts` to project bounded `criteria: { checked, total }` and plan-file existence, which it does not report today (it keeps only the total and nothing for a file without checkboxes).
- **Commit**: no invented pending items; keep today's facts-only list.
- No new agent tool calls or skill instructions, unless a gap cannot be closed from runtime facts. Then record it in Discovered Work instead of adding one.

## Mockups

Before code, add `agent-work/decks/card-signal-parity.html` with one Today/Proposed pair per step, in the style of `agent-work/decks/dashboard-card-lenses.html` (reuse its page script and CSS). The user reviews this deck at the end with the PR.

```text
Review                                        RV
DOING  Fix the stale cursor in roster windowing
WHERE  RV◉ │ review✓ fix◉ done·  ▰▰▰▱▱▱▱▱ 3/8  pass 2
FOUND  3 fixed · 4 open · 1 deferred
       ✓ Missing NO_COLOR guard
       ◉ Fix the stale cursor in roster windowing
       · Badge overlaps age at 80 cols

Execute                                       EX
DOING  Add goal parsing to session-context
WHERE  EX◉ │ implement✓ verify◉ done·  ▰▰▰▰▱▱▱▱ 5/10 · phase 2/3 Hub card
PLAN   5 done · 5 open
       ✓ Parse progress.goal
       ◉ Add goal parsing to session-context
```

## Hub changes

Hub draws lenses generically, so most work is in Rules. Hub needs: `whereLine()` already renders `summary` and stages; confirm the fitting ladder drops `summary` before stages and that a meter on Review/Reflect/Commit fits; add render tests per step. No step-name checks.

## Reuse

- `rules/extensions/workflow-runtime/workflow-plan.ts` (criteria projection) and `rules/.../core.ts`: `activityLens()`, `executeLens()`, `itemList()`, `commitList()`, `planList()`, `WORKFLOW_ACTIVITIES` — change these, add no parallel lens builders.
- 002's tool-call classifier (shared module in workflow-runtime).
- Hub `whereLine()`, `lensListLines()`, `LENS_MARKS`.
- Deck template `agent-work/decks/dashboard-card-lenses.html`.

## Implementation Phases

### Phase 1: Mockups
- [ ] Build `agent-work/decks/card-signal-parity.html` (Today/Proposed per workflow step). Orchestrator lenses (`ticketLens()`, `epicLens()` with its `PR` head) are out of scope and stay unchanged.

### Phase 2: Rules lens contract
- [ ] Tests first (`rules/tests/workflow_runtime.test.mjs`): for each step, the lens has named stages, the DOING rule, a meter exactly when a denominator exists, count heads; Execute implement/verify/done from tool calls and phases in `summary`; Plan items and criteria from `workflow-plan.ts`; completed steps keep their terminal DOING; Commit and orchestrator lenses unchanged.
- [ ] Implement in `core.ts` (+ the Execute activity hook in `index.ts` `tool_execution_end`).
- [ ] Update the Rules `README.md` workflow-runtime lens description to the parity contract.

### Phase 3: Hub rendering
- [ ] Render tests (`test/fleet-cards.test.ts` style) per step at 160, 100 and 80 columns: WHERE fits with stages, meter and summary per the ladder; roster right-edge meter for Review/Reflect.
- [ ] Adjust fitting only where tests show a problem; update `docs/STRUCTURE.md` lens lines.

### Phase 4: Verification
- [ ] Replay one mock session per step with the 001 tool and record in `agent-work/tickets/card-signal-003/validation.md` that DOING follows the parity rule and the meter values match the facts.
- [ ] Rules pytest (env-scrubbed command in Rules README); Hub `npm test`, then `npm run package:check` (not concurrently).

## Acceptance Criteria

- [ ] Every workflow step's lens follows the parity contract (DOING rule, named stages, meter only with a real denominator, count heads, same marks); covered by Rules tests per step.
- [ ] Execute shows `implement / verify / done` stages derived from tool calls, with the phase in WHERE.
- [ ] Review and Reflect cards and roster rows show a meter with exact settled/total counts; Commit and orchestrator lenses are unchanged except for the shared head format where it applies.
- [ ] The parity deck shows Today/Proposed for every step, and Hub render tests match it at 160, 100 and 80 columns.
- [ ] No new agent tool calls or skill instructions were added; existing tests in both repos pass.

## Decisions

- Plan gets no meter unless the plan file exposes a real count; no forecasts.
- Parent, from the 001 report: keep checklist position separate from live activity. Real Execute runs tick tasks in phase batches (18 of 20 updates), so DOING from the first open task lags. Execute DOING shows the observed action from 002's runtime-derived DOING (`open-session.ts` classifier and tool wording) while a tool runs, and otherwise the first open task. The list keeps the open task as plan context. Do not auto-check tasks from edits or timers.
- 002's classifier lives in `rules/extensions/workflow-runtime/open-session.ts`; reuse it, and move it only if a neutral name makes sharing clearer.

## Discovered Work

(none yet)

## Reflection Candidates

- Rules `README.md` lens section; Hub `docs/STRUCTURE.md` WHERE and list lines; Hub `AGENTS.md` card sentence if the field order changes.
