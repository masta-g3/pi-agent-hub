**Feature:** card-lens-002 → Plan Commit Lenses
**Epic:** card-lens (`agent-work/plans/card-lens-000.md`) · **Repos:** pi-agent-hub, rules · **Target:** `card-lens-integration`

# card-lens-002 · Plan Commit Lenses

Plan and Commit fill the card-lens-001 lens `list` from facts Rules already sees: tool calls, the plan file and git. Hub needed no rendering change.

## Implemented

- **Step facts (`core.ts`):** `WorkflowState.stepFacts` holds `questions`, `commits`, `closeout` and `pushed`. It resets on every step start, ticket switch and ticket unlink, and is restored with state, except `questions.waiting`, which session start clears.
- **Plan lens:** the `PLAN` list heads `N phases · N tasks · N criteria` once the plan file exists. Tasks are phase tasks only, as in Execute. Criteria are the checkboxes under `## Acceptance Criteria`, counted in `parseWorkflowPlan`.
  - Items are `N answered`, `N waiting: <first question>` and `critic pass N`, which is active while reviewing and done after.
  - A written plan with nothing else to list shows a pending `critic pass 1`.
  - Answers come from `ask_user_question` calls of the current step run that end without error, matched by request ID.
  - A question during critic review keeps the critic activity.
- **Commit lens:** the `CLOSE` list heads `N commits`. Items are `Plan archived`, `Ticket <id> done`, one `<repo> <short hash> <subject>` line per recorded commit, and `push`. The latest 12 are kept, with a `before` count.
  - A new `pushing-changes` activity adds the `push` stage only once it is reached. The commit skill calls it before `git push`.
  - A completed Commit keeps its lens with every stage done. It is recomputed from state, so a stored lens is still never restored.
- **Commit facts (`commit-facts.ts`):**
  - Quote- and line-continuation-aware shell parsing detects `git … commit` (commit as the git subcommand), `archive_plan.sh`, and `features_yaml.sh complete`.
  - At bash start, Rules records each workspace repo's HEAD reflog length. Pi awaits start handlers before running the tool.
  - At bash end, only new `commit…` reflog entries count. An amend replaces the commit it rewrote. A call with a failed exit still records the repos that committed.
  - Results merge into the latest state. Pending calls carry a facts-run ID, so a call that ends after a step or ticket change writes nothing.
  - Workspace repos are the bound worktree record's repositories, else the cwd's repo plus each top-level symlink that resolves to a repo root. Rules never runs `git worktree list`.
- **Hub:** render test for the Plan and completed Commit lenses at 100 and 160 columns. A `CLOSE` example in `docs/CONFIG.md`; the FEATURES card table and CHANGELOG updated. Rules `README.md` documents the lists, `stepFacts` and `pushing-changes`.

## Verification

- Rules `uv run pytest -q`: 91 passed. Hub `npm test`: 1691 passed, then `npm run package:check` passed.
- code-critic (`openai-codex/gpt-6-astra`) ran three passes: 6 findings fixed (parallel merges, stale completions, quote-aware detection, combined closeout, same-step restart, line continuations), then no issues.
- End-to-end run with both worktrees' extensions and this worktree's `pi-hub tui`: `agent-work/tickets/card-lens-002/validation.md` (Plan waiting and answered, Commit at 160 and 100 columns, stopped session). The Plan capture predates the critic-review question fix.

## Notes for later tickets

- At 100 columns the side pane drops Plan's five stage labels. This is the expected width ladder; no action.
- The overlapping-completion test depends on read order, so it catches the old merge bug only on some runs.
