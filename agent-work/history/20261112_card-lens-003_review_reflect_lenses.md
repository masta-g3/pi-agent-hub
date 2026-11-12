**Feature:** card-lens-003 → Review Reflect Lenses
**Epic:** card-lens (`agent-work/plans/card-lens-000.md`) · **Repos:** pi-agent-hub, rules · **Target:** `card-lens-integration`

# card-lens-003 · Review Reflect Lenses

Review findings and Reflect candidates come from the agent through an optional `items` list on `set_workflow_activity`, which the skills already call at each stage. Rules publishes them as the card-lens-001 lens `list`. Hub needed no rendering change.

## Implemented

- **Activity items (`core.ts`, `index.ts`):** `set_workflow_activity` takes optional `items: { text, state }[]`, with at most 12 items and text of at most 120 characters. The states are `open`, `active`, `done`, `deferred` and `attention`.
  - The TypeBox schema sets the bounds. `setWorkflowActivity` checks them again, cleans the text with `normalizeText`, and rejects items outside `review` and `reflect`.
  - The items are kept as `WorkflowState.stepItems`. A call with `items` replaces the list; a call without keeps it.
  - The list resets on step start, ticket switch and unlink, and is restored with state, following 002's `stepFacts`.
- **Lens:** Review lists `FOUND` with `N fixed · N open · N deferred`, and `attention` counts as open. Reflect lists `CANDS` with `N applied · N now · N needs you · N no action`.
  - The item states map to `done`, `active`, `pending`, `skipped` and `attention`.
  - `doing` is the active item's text, else the activity label.
- **Completion exception:** a completed Review or Reflect that has items keeps its lens, with every stage done and the terminal activity label as `doing`. Commit already does this with "Commit complete". Without items, and in Plan, the lens still drops at completion.
  - Review changed this from the planned "DOING omitted". Without a `doing` line, Hub showed a stale NEXT note above the final list.
- **Skills:** the review and reflect skills send `items` on `fixing-review-findings`/`review-complete` and on `updating-guidance`/`reflection-complete`. They repeat a call only when an item changes state.
- **Docs and tests:** Rules `README.md` documents the change. In Hub, `docs/CONFIG.md`, the FEATURES card table and the CHANGELOG are updated. A Hub render test checks the Review and Reflect cards at 100 and 160 columns, with `pass 2`.

## Verification

- Rules `uv run pytest -q`: 91 passed. Hub `npm test`: 1692 passed, then `npm run package:check` passed.
- code-critic (`openai-codex/gpt-6-astra`) found no issues.
- An end-to-end run used both worktrees' extensions and this worktree's `pi-hub tui`. The captures are in `agent-work/tickets/card-lens-003/validation.md`: Review at pass 2 at 160 and 100 columns, the completed Review under `Review complete`, and Reflect at both widths.

## Notes for later tickets

- At 100 columns the Review and Reflect `WHERE` lines fit their stages.
- The installed `set_workflow_activity` gains `items` only once this branch is released.
