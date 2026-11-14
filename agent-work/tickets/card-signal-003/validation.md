# Step lens parity validation

## Result

All five steps follow the parity contract. No new agent tool or skill instruction was added. Hub's existing generic renderer needed no production change.

| Step | Evidence | DOING and meter |
| --- | --- | --- |
| Plan | New sol mock: 17 tools, 7 visible lenses, 55 replay intervals | Activity label until critic starts; then active `critic pass N`. Criteria change from 0/2 to 1/2; pass 2 appears. `plan written` stays present. Terminal Plan still drops its lens. |
| Execute | 001 scenario 4 sol: 19 recorded tools, 47 current projections, 59 replay intervals | 20 samples show an in-flight tool action, independent of the first open task. Between calls DOING returns to that task; at 4/4 it becomes `Implementation complete`. Named implement/verify/done stages and phase summary replace numeric stages. |
| Review | 001 scenario 5 sol: 11 recorded tools, 6 current projections, 37 replay intervals | Active finding wins, then activity label. Meter counts only done + deferred over all findings; final 2/4 (two done, two open). Terminal `Review complete` wins and retains the list. |
| Reflect | New sol mock: 12 tools, 5 visible lenses, 41 replay intervals | Active candidate wins, then activity label. Final meter is 2/3: one applied, one no action, one attention. Terminal label and list stay. |
| Commit | New sol mock: 12 tools, 8 visible lenses, 40 replay intervals | Activity label; final `Commit complete`. One observed fixture commit, no meter, no invented pending closeout items. |

`validate.mjs` reuses Rules `tools/card-signal/replay.ts`. The three new mocks ran the changed producer. Older Execute/Review recordings retain their original snapshots; validation reprojects their recorded state, checklist windows and exact tool lifecycles through today's producer and replays the resulting timeline. This is a deterministic producer/renderer check, not a new judgment of model output. All checked lenses pass through Hub intake and render at 160, 100 and 80 columns.

Exactly **three** new mock runs used `openai/gpt-6.1-sol`: Plan, Reflect and Commit. There were no retries or new judge calls. Each used a disposable copy of the 001 fixture, the changed runtime, one explicit scenario prompt, and no other extensions. Only the mock Commit prompt authorized a commit, inside that disposable fixture. No implementation commit was made for this ticket; only the parent's requested integration merge was committed.

The Commit mock used ordinary move/YAML edits, not the recognized closeout helpers. Its CLOSE list correctly contains only the observed commit. Existing runtime integration tests verify archive/ticket helper facts, multi-repo commits, conditional push and terminal retention.

## Checks

- Baseline: Rules **92 passed**; Hub **1,711 passed**.
- Tests first: the new contract assertions failed against the old producer before implementation.
- Final Rules: `env -u PI_AGENT_HUB_PRIMARY_CWD -u PI_AGENT_HUB_FORK_COMPACT uv run pytest -q` — **92 passed**. Focused runtime wrapper checks also passed after adding final all-criteria-checked and Execute-subagent assertions.
- Hub: Execute `npm test` — **1,731 passed**; Review rerun after board/micro-row regression checks — **1,732 passed**. `npm run package:check` passed sequentially after each full test run.
- Hub card suite: **48 passed**, including each step at 160/100/80, settled meters on Review/Reflect roster rows, all list marks, and summary-before-stages fitting. No fitting change was needed.
- `git diff --check` — passed in both repositories.
- Real Chromium browser check: all five Today/Proposed pairs, keyboard navigation/toggle, and 1600/800-pixel layouts passed. Viewed the Execute render. The bundled browser was absent; the already-installed Chrome worked. The only console error was the local server's missing favicon.

## Review regression checks

- Removed the unplanned `0/0 tasks` widget for a plan file without checkboxes. Its `plan written` lens fact remains. The test first reproduced the failure, then verified widget omission and clearing of a previous checklist widget.
- Fixed the critic's reproduced stale Execute DOING after resume/reload/startup without a linked plan. Startup now republishes the recomputed lens after live observations reset, independently of plan refresh. The regression test failed first, then passed for all three boundary reasons.
- Kept the plan-existence projection field optional in its type, matching restored workflow snapshots that omit lens-only fields.
- Workflow board: derived Implementing/Verifying activity, original phase and task counts, correct lane, and width safety checked at 160/100/80. Board behavior stayed unchanged.
- Subagent micro rows: named implement/verify/done stages, observed DOING instead of launch task, unchanged checklist context/count head, exact meter, and unplated selected-card behavior checked at 160/100/80.
- Orchestrator compatibility: compared the orchestrator builder source block against pre-ticket `HEAD` byte for byte, then compared serialized lens output across **384 cases** (all single-ticket states and steps, 2/24-ticket epics, active/held/completed parent steps). All were byte-identical. Temporary baseline module copies were removed.
- Review final verification: Rules **92 passed**; three Hub render suites **214 passed**; full Hub **1,732 passed**; package check and five-step replay passed. No additional mock/model runs were used during Review.

## Reproduce without model calls

From the Hub worktree, with its existing dependencies:

```bash
npm run build
node --experimental-strip-types agent-work/tickets/card-signal-003/validate.mjs
```

Open `agent-work/decks/card-signal-parity.html` through a local HTTP server for the mockup. Retained `mock/` files contain only the three mock sessions, slim lifecycle events, prompts and run manifests. Temporary projects, full RPC streaming logs and the browser screenshot were removed; the recordings and validation script remain useful for review and reproduction.
