**Feature:** card-lens-002 → Plan Commit Lenses
**Session:** e2efffb1-7770-475a-9b8a-903910fa2977 (parent orchestrator)
**Worktree:** `/Users/manager/.local/share/agent-worktrees/card-lens-002-8af5f837b5ba/pi-agent-hub` and `…/rules`, branch `card-lens-002` (record `…/card-lens-002-8af5f837b5ba/worktree.json`)
**Start branch:** `card-lens-integration` (both repos)
**PR target:** `card-lens-integration` (both repos)

# card-lens-002 · Plan Commit Lenses

Epic: `agent-work/plans/card-lens-000.md`. Mocks: `agent-work/decks/dashboard-card-lenses.html` (pages Plan, Commit; Proposed). Builds on the card-lens-001 lens contract (`doing`, `stages`, `progress`, `pass`, `list`); merge `card-lens-integration` first so 001 is present.

Plan and Commit fill the lens `list` from facts the extension already sees. Hub needs no new rendering: 001 draws any lens list.

## Proposed behavior

Plan, during critic review:

```text
DOING  Reviewing plan
WHERE  PL◉ EX· RV· RF· CM· │ inspect✓ scope✓ write✓ critic◉ ready·
PLAN   5 phases · 19 tasks · 9 criteria
       ✓ 4 answered
       ? 1 waiting: Keep the "Use as reply" button?
       ◉ critic pass 1
```

Commit, two repos, after the first commit:

```text
DOING  Committing changes
WHERE  PL✓ EX✓ RV✓ RF✓ CM◉ │ archive✓ commit◉
CLOSE  2 commits
       ✓ pi-agent-hub  3f9c2e1 Add step lens contract
       ✓ rules         a1b2c3d Publish the workflow lens
```

After `complete_workflow` the Commit lens stays as the card's final state with all items done. A run that pushes adds `push` to the stages after `pushing-changes`.

## Confirmed decisions

- Question counts come from `ask_user_question` calls in the current Plan step: `answered` counts questions whose call ended without error; `waiting` is the open call's question count, first question and request ID. No forecast of remaining questions. Counts reset when the step changes. On reload or resume, `answered` is restored but `waiting` is cleared, matching how Rules already clears request-backed question attention at session start; a late completion only counts if its request ID matches the current waiting call in the same step.
- Plan facts (phases, tasks, acceptance criteria) come from the plan file once it exists; criteria are the `- [ ]`/`- [x]` items under `## Acceptance Criteria`. Before the file exists the list shows questions only.
- The critic pass item shows only after the first `reviewing-plan`; it reads `critic pass N`.
- Commit hashes come from watching tool calls, per call: on `tool_execution_start` for a `bash` call whose command contains a `git commit` subcommand (token match `git` … `commit` as the subcommand, not inside `log --grep` and similar), record each workspace repo's HEAD reflog length (`git reflog --format=%H%x09%gs HEAD`); on `tool_execution_end` for that call ID, read the reflog again. For each repo, take only the newly appended entries whose reflog subject starts with `commit` (this covers `commit:`, `commit (initial):`, `commit (amend):` and `commit (merge):`, and excludes `checkout:`, `reset:` and others). Record repo label, short hash and subject for the newest such entry; an amend replaces that repo's earlier item with the same subject line. This ignores the call's aggregate exit status, so one repo's success counts even if another repo's commit failed in the same call.
- Workspace repos: the validated bound worktree record's repositories when present; otherwise the session cwd's repo plus each top-level symlink in the cwd that resolves to a git repo root (the Hub multi-repo workspace layout). Never enumerate `git worktree list`.
- Archive and ticket closeout items: `archive_plan.sh` and `features_yaml.sh complete` calls that end without error add `✓ Plan archived` and `✓ Ticket <id> done`.
- New activity `pushing-changes` (stage `push`) in Commit; the commit skill calls it before `git push`. Reaching it sets `stepFacts.pushed = true`; the `push` stage appears only when that flag is set, including after `complete_workflow` and reload.
- `complete_workflow` keeps the Commit lens published with every stage done; this is the one terminal state that keeps a lens (001 omits it after `currentStepComplete` for other steps).
- Lens list item states use 001's set: done `✓`, active `◉`, pending `·`, attention `?`/`!`.

## Context Files

**Core (rules):** `extensions/workflow-runtime/core.ts` (`WORKFLOW_ACTIVITIES`, `workflowLens`, `completeWorkflow`), `extensions/workflow-runtime/index.ts` (`tool_execution_start/end`, `refreshPlan`), `extensions/workflow-runtime/workflow-plan.ts` (criteria parse), `skills/commit/SKILL.md` (push activity), `tests/workflow_runtime.test.mjs`, `tests/workflow_runtime_extension.test.mjs`, `README.md`.

**Core (pi-agent-hub):** `docs/CONFIG.md` (lens examples), `test/instrument-panel.test.ts` (Plan and Commit render cases).

## Reuse

- 001's `workflowLens(state)` and Hub lens renderer; this ticket adds per-step list builders only.
- `parseWorkflowPlan` gains acceptance-criteria counting in the same single pass.
- Existing `tool_execution_start` hook for `ask_user_question` (`index.ts` ~1182) and the `tool_execution_end` hook (~1202).
- `stableRequestId` for matching the open question call.

## Design

- `WorkflowState` gains `stepFacts?: { questions?: { answered: number; waiting?: { count: number; text: string; requestId: string } }; commits?: { repo: string; hash: string; subject: string }[]; closeout?: { archived?: true; ticketDone?: true }; pushed?: true }`. It resets in `startWorkflowStep`, ticket switch and ticket unlink, is published only through the lens, and is restored with state (unlike the lens itself) except `questions.waiting`, which session start clears. Pending per-call HEAD refs live in memory only.
- `workflowLens` for `plan-md`: `list = { label: "PLAN", head: "<n> phases · <n> tasks · <n> criteria" when the plan exists, items: answered, waiting (attention), critic pass (active while reviewing, done after) }`.
- `workflowLens` for `commit`: `list = { label: "CLOSE", head: "<n> commits", items: archive, ticket, one per commit, push when reached }`, windowed to 001's 12-item bound with `before`/`after` counts (latest commits kept).

## Implementation Phases

### Phase 1: Plan lens list

- [ ] Failing tests: criteria counting in `parseWorkflowPlan`; plan-md lens list before and after the plan file exists; answered/waiting counts across two `ask_user_question` calls (one ending in error does not count); critic pass item; counts reset on step change and ticket unlink; answered survives reload while waiting is cleared on resume; a late completion after a step change does not count.
- [ ] Implement `stepFacts.questions`, criteria counting and the plan-md list.
- [ ] Verify: Rules `uv run pytest -q` passes.

### Phase 2: Commit lens list

- [ ] Failing tests with real temp git repos: an unbound two-repo symlink workspace with one commit each yields two items; an unrelated worktree of the same repo is ignored; `git log --grep=commit` and a failed commit yield none; a call where repo A commits and repo B fails records A; an initial commit in an empty repo and a `git commit --amend` are recorded; a checkout to an existing child commit in the same call as a failed commit is not recorded; more than 12 closeout items window with counts; `pushing-changes` sets the push stage, which survives `complete_workflow` and reload, and is absent when never reached; lens kept with all stages done after `complete_workflow`.
- [ ] Implement `stepFacts.commits`/`closeout`/`pushed`, per-call HEAD tracking with parent verification, repo discovery, the windowed commit list and the terminal keep; add the `pushing-changes` call before push in `skills/commit/SKILL.md`.
- [ ] Verify: Rules tests pass.

### Phase 3: Hub render check and docs

- [ ] Add `test/instrument-panel.test.ts` cases rendering a Plan lens and a completed Commit lens from realistic entries (fixtures copied from the Rules test output) at 100 and 160 columns.
- [ ] Update Rules `README.md` (Plan and Commit lens items, `pushing-changes`) and Hub `docs/CONFIG.md` lens example.
- [ ] End-to-end: a real Pi session in tmux with both worktrees' extensions; ask one question in Plan, then commit in two temp repos during Commit; capture the Hub card from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`. Save captures to `agent-work/tickets/card-lens-002/validation.md`.
- [ ] Verify: Hub `npm test`, then `npm run package:check`.

## Acceptance Criteria

- [ ] The Plan card shows plan facts (phases, tasks, criteria) once the plan file exists, answered and waiting question counts, and the critic pass. *(Phase 1; Phase 3 capture)*
- [ ] The Commit card lists archive, ticket closeout and one line per committed repo with short hash and subject, found without any agent report. *(Phase 2; Phase 3 capture)*
- [ ] `push` appears in Commit stages only after `pushing-changes`. *(Phase 2)*
- [ ] After `complete_workflow`, the Commit card keeps its closeout list with all stages done. *(Phase 2; Phase 3 render test)*
- [ ] Rules tests, Hub `npm test` and `npm run package:check` pass. *(Phase 3)*

## Reflection Candidates

## Discovered Work
