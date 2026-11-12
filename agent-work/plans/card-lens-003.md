**Feature:** card-lens-003 → Review Reflect Lenses
**Session:** e2efffb1-7770-475a-9b8a-903910fa2977 (parent orchestrator)
**Worktree:** `/Users/manager/.local/share/agent-worktrees/card-lens-003-b95376ee084e/pi-agent-hub` and `…/rules`, branch `card-lens-003` (record `…/card-lens-003-b95376ee084e/worktree.json`)
**Start branch:** `card-lens-integration` (both repos)
**PR target:** `card-lens-integration` (both repos)

# card-lens-003 · Review Reflect Lenses

Epic: `agent-work/plans/card-lens-000.md`. Mocks: `agent-work/decks/dashboard-card-lenses.html` (pages Review, Reflect; Proposed). Builds on the card-lens-001 lens contract; merge `card-lens-integration` first.

The agent reports Review findings and Reflect candidate outcomes through an optional `items` list on `set_workflow_activity`, the call the skills already make at each stage. The extension publishes them as the lens list. Hub needs no new rendering.

## Proposed behavior

Review, fixing pass 2:

```text
DOING  Parser stall on long backtick runs
WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
FOUND  2 fixed · 2 open · 1 deferred
       ✓ Retry after unknown delivery showed twice
       ✓ Lost history cursor on empty session
       ◉ Parser stall on long backtick runs
       · Failed read dropped loaded history
       – Login in a link: deferred
```

Reflect:

```text
DOING  STRUCTURE.md: Markdown safety rule
WHERE  PL✓ EX✓ RV✓ RF◉ CM· │ review✓ update◉ done·
CANDS  1 applied · 1 now · 1 needs you · 1 no action
       ✓ STRUCTURE.md: transcript source
       ◉ STRUCTURE.md: Markdown safety rule
       ! New ticket: keyboard dock check
       – Retry wording: no change
```

## Confirmed decisions

- `set_workflow_activity` gains optional `items: { text: string; state: "open" | "active" | "done" | "deferred" | "attention" }[]` (≤ 12 items, text ≤ 120). Allowed only in `review` and `reflect`; other steps reject it with a clear error.
- A call with `items` replaces the step's list; a call without `items` keeps the last list. The list resets on step change, ticket switch (`setWorkflowTicketState`) and ticket unlink (`unlinkWorkflowTicketState`), and is restored with state on reload.
- Review list label `FOUND`, head counts `N fixed · N open · N deferred`; Reflect label `CANDS`, head `N applied · N now · N needs you · N no action`. State mapping to lens item states: done → `✓`, active → `◉`, open → `·`, deferred → `–` (skipped), attention → `!`.
- `doing` in Review and Reflect becomes the active item's text when one exists, else the activity label.
- The review and reflect skills send `items` with `fixing-review-findings`/`updating-guidance` and again with `review-complete`/`reflection-complete`; they do not add extra calls between findings unless the state of an item changes.
- After `review-complete` or `reflection-complete` the list stays as the step's final state. `workflowLens` gets a narrow exception to 001's `currentStepComplete` suppression: when the step is `review` or `reflect` and `stepItems` exist, it still publishes the lens (DOING omitted, stages all done, the list). Other steps keep 001's suppression (Commit's own exception belongs to card-lens-002).

## Context Files

**Core (rules):** `extensions/workflow-runtime/core.ts` (`setWorkflowActivity`, `workflowLens`), `extensions/workflow-runtime/index.ts` (`set_workflow_activity` tool schema, ~873), `skills/review/SKILL.md`, `skills/reflect/SKILL.md`, `tests/workflow_runtime.test.mjs`, `tests/workflow_runtime_extension.test.mjs`, `README.md`.

**Core (pi-agent-hub):** `docs/CONFIG.md` lens example, `test/instrument-panel.test.ts`.

## Reuse

- 001's `workflowLens` and Hub lens renderer.
- Existing `set_workflow_activity` tool and `setWorkflowActivity` transition; `normalizeText` for item text.

## Implementation Phases

### Phase 1: Activity items and lens list

- [ ] Failing tests: `setWorkflowActivity` with items in review and reflect; rejection in other steps; over-limit and empty text rejected; a call without items keeps the list; reset on step change, ticket switch and ticket unlink; restore on reload; final list kept after `review-complete` and `reflection-complete` (also after reload) while plan-md still drops its lens at `plan-ready`; head counts and label per step; `doing` follows the active item.
- [ ] Extension-level test: call the registered `set_workflow_activity` tool with `items` and assert `latest("workflow-runtime").lens.list`; `/wf-ticket clear` then publishes no list.
- [ ] Add `items` to the tool schema (TypeBox, bounded), forward `params.items` from the tool handler (`index.ts` ~877) into `setWorkflowActivity`, store as `stepItems` in `WorkflowState`, clear it in the step, switch and unlink transitions, and derive the list plus the completion exception in `workflowLens`.
- [ ] Verify: Rules `uv run pytest -q`.

### Phase 2: Skills, render check, docs

- [ ] Update `skills/review/SKILL.md` and `skills/reflect/SKILL.md` runtime integration: send `items` (one short title per finding or candidate, with state) on the existing stage calls.
- [ ] Add `test/instrument-panel.test.ts` cases rendering a Review and a Reflect lens from realistic entries at 100 and 160 columns, including `pass 2`.
- [ ] Update Rules `README.md` and Hub `docs/CONFIG.md`.
- [ ] End-to-end: a real Pi session in tmux with both worktrees' extensions; drive review stages with items; capture the Hub card from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`. Save captures to `agent-work/tickets/card-lens-003/validation.md`.
- [ ] Verify: Hub `npm test`, then `npm run package:check`.

## Acceptance Criteria

- [ ] The Review card shows FOUND with fixed/open/deferred counts and one line per finding, and DOING names the finding being fixed. *(Phase 1; Phase 2 capture)*
- [ ] The Reflect card shows CANDS with outcome counts and one line per candidate. *(Phase 1; Phase 2 capture)*
- [ ] Items are accepted only in Review and Reflect, bounded, and kept until replaced or the step changes; the final list stays after the step completes. *(Phase 1)*
- [ ] The review and reflect skills send items on their existing stage calls. *(Phase 2 skill text; end-to-end capture)*
- [ ] Rules tests, Hub `npm test` and `npm run package:check` pass. *(Phase 2)*

## Reflection Candidates

## Discovered Work
