**Feature:** card-signal-003 → Step Lens Parity
**Status:** complete; ticket branches await parent integration
**Branch / target:** `card-signal-003` → `card-signal-integration` in Rules and Hub
**Worktrees:** `/Users/manager/.local/share/agent-worktrees/card-signal-003-9c8c9f6a984d/{rules,pi-agent-hub}`
**Epic:** `agent-work/plans/card-signal-000.md`
**Depends on:** card-signal-002

# Step Lens Parity

All workflow steps use named stages, factual count heads and the same list marks. Progress appears only with a real denominator. Existing completion and orchestrator behavior remains intact.

## Implemented behavior

- DOING uses the active list item, else the activity label; terminal labels win over stale active items. Execute shows an observed classified tool action while it runs and otherwise the first open task, keeping checklist context separate from live activity.
- Execute reuses 002's tracker/classifier. Completed explore/change calls select `implement`; verification calls select `verify`; every task checked marks implement/verify/done stages done. Task completion remains plan-authored, never inferred from edits or timers.
- Execute moves phase position/title into WHERE `summary` (`phase N/M · title`). Its PLAN head becomes `N done · N open`; existing task windows and hidden-item counts remain.
- Plan projects file existence even without checkboxes and checked/total acceptance criteria. PLAN shows `plan written` and one bounded `criteria checked/total` item alongside questions and critic passes. No pending critic work or forecast is invented.
- Plan meters count checked criteria; Execute meters count completed tasks; Review counts fixed + deferred findings; Reflect counts applied + no-action candidates. Missing/empty denominators produce no meter. Commit retains its conditional stages and facts-only CLOSE list without a meter.
- Highest review pass stays visible during fixes. Completed Commit closeout and Review/Reflect lists retain their existing lifecycle. Orchestrator builders and outputs remain unchanged.
- Hub's generic renderer needed no production change. The existing fitting ladder drops summary before stages/meters and renders Review/Reflect roster progress. Added the Today/Proposed deck and approved Rules README / Hub STRUCTURE descriptions. No dependency, agent tool or skill instruction was added.

## Review corrections

- Startup recomputes Execute lenses independently of linked-plan refresh, so resume/reload/startup cannot retain an in-flight tool's DOING. Completed activity survives; live observations do not.
- Checkbox-free plans retain their lens facts without creating an unplanned `0/0 tasks` widget. The plan-existence field type accepts restored snapshots that omit lens-only fields.
- Added failing-then-passing regression tests, workflow-board phase/activity/count checks, and subagent micro-row checks for named stages, live DOING, count heads and unplated selected cards.
- Code critic ran twice: accepted its stale-startup-DOING finding; second pass returned LGTM. Job `7605706a-a74b-487d-b2b0-ab938a456d38`; final result `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/7605706a-a74b-487d-b2b0-ab938a456d38/turns/002-result.md`. No findings were rejected.

## Acceptance and verification

- [x] Per-step DOING, named stages, real-denominator meters, factual heads and shared marks are covered by Rules tests.
- [x] Execute implement/verify/done derives from tool calls, with phase context in WHERE and no automatic checklist ticks.
- [x] Review/Reflect cards and roster rows show exact settled counts; Commit facts and orchestrator lenses retain their contracts.
- [x] The parity deck covers all five steps; Hub rendering, board and subagent checks cover 160/100/80 columns.
- [x] No new agent calls, skill edits or dependencies; both repository suites pass.
- Baseline: Rules **92 passed**; Hub **1,711 passed**. Final Review: Rules **92 passed**; Hub render suites **214 passed**; full Hub **1,732 passed**; package check passed sequentially after tests.
- Five-step replay passed. Reused 001's Execute/Review recordings through current projections; exactly three new `openai/gpt-6.1-sol` mocks covered Plan/Reflect/Commit, with no retries or new judge calls.
- Orchestrator builder source and **384 serialized lens cases** matched pre-ticket HEAD byte for byte, including single-ticket states and epic windowing.
- Real-browser deck checks passed for all Today/Proposed pairs, keyboard controls and wide/narrow layouts. Both repositories passed diff checks. Integration merges before commit were already up to date.

## Reflection and deferred proposal

- Hub AGENTS still matches the field order, producer-neutral lens, board and subagent behavior. No durable guidance changed during Reflect; docs critic was skipped because no substantive guidance edit was needed.
- Deferred, outside this epic: `rules/skills/execute/SKILL.md` says “Mark completed steps with `[x]` as you go.” The 001 report observed 18/20 real updates in multi-task batches, 17 completing an untouched phase. Proposed wording for later approval/evaluation: “After verifying a task, mark it complete before starting the next distinct task. You may mark tasks verified together in one edit; do not wait until an unrelated phase ends.” Evaluate against the retained corpus before adoption; the study establishes neither a speed benefit nor a causal effect. No skill/user-global guidance edit or follow-up ticket was made.
- Boundary/widget failures remain guarded by tests rather than extra written rules. No scope or acceptance change was required.

## Retained evidence and handoff

`agent-work/decks/card-signal-parity.html` and `agent-work/tickets/card-signal-003/{validation.md,validate.mjs,mock/}` retain mockups, no-model reproduction and mock-only recordings (about 212 KB). Temporary projects, streaming logs and browser artifacts were removed. Ignored Hub `dist/` and its existing `node_modules` symlink, plus Rules test caches, remain local and are not committed.

Only ticket branches are committed. The parent owns integration, pushing, PRs and worktree closeout. Both worktrees remain intact.
