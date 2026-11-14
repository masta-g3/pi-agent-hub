**Feature:** card-signal-002 → Open Session Card
**Status:** complete; ticket branches await parent integration
**Branch / target:** `card-signal-002` → `card-signal-integration` in Rules and Hub
**Worktrees:** `/Users/manager/.local/share/agent-worktrees/card-signal-002-84e8300bf8b0/{rules,pi-agent-hub}`
**Epic:** `agent-work/plans/card-signal-000.md`
**Depends on:** card-signal-001

# Open Session Card

An open session now identifies its task with GOAL and shows observed explore/change/verify stages through the existing lens-only card path.

## Implemented behavior

- The existing progress-note model call also writes optional `goal`, bounded to 80 characters. The prompt receives the previous goal, keeps it unchanged within a topic and changes it on an explicit topic switch. Concrete task-title examples exclude temporary permissions and restrictions.
- Open-session DOING describes an in-flight classified tool and clears at completion or turn end. It never reuses the previous turn's NEXT.
- Finished classified tools advance WHERE: the latest stage is active, other seen stages are done, unseen stages pending. The track is hidden before the first classified completion. Starting a workflow step or `/wf-clear` resets it.
- The first goal retains earlier observations. A changed goal re-seeds stages from its producing turn and any newer observations. Resume retains stages without reviving live DOING.
- Active workflow steps and orchestration lenses take precedence. Subagents do not publish open-session signals; resume also removes an inherited open lens.
- Hub parses GOAL, renders it before DOING without ticket copy, hides it under Answer/Reply panels and uses it as the quiet roster's final TASK fallback. DOING replaces DONE/NEXT. Narrow lens-only WHERE keeps the active stage when the full track cannot fit.
- Updated Rules `README.md`, Hub `docs/CONFIG.md`, `docs/STRUCTURE.md` and the existing AGENTS card description. No new dependency, workflow, agent rule or generic persistence was added.

## Key implementation decisions

- Reused the existing progress prompt/parser/snapshot, `withWorkflowDefinition()`, Hub's lens parser/renderer and `shellCommands()` from commit-facts.
- Compound shell calls use the last classified simple command; unquoted output redirects classify as change.
- Pi's completion event has no arguments. Classification is captured at tool start and applied only at completion. Real-shape lifecycle tests cover this and ignore unmatched late completions after reset.
- The initial live GOAL included a temporary no-fix restriction. An approved three-call metadata experiment selected task-title wording; the conditional live confirmation omitted the qualifier while preserving stability and topic switching. No stripping or fallback was introduced.

## Acceptance and verification

- [x] GOAL, DOING and lens-only WHERE render in the shared label-column style; ticket copy wins; quiet TASK fallback and narrow widths work.
- [x] GOAL remains stable on the same task and changes on topic switch in recorded live sessions.
- [x] Stages follow completed tools without a model call, reset on step start/clear and re-seed on changed goals.
- [x] DOING comes only from observed in-flight tools, not NEXT.
- [x] Workflow/orchestration/subagent precedence and Answer/Reply visibility are covered by regression tests.
- Rules full suite: **92 passed** after the final prompt update.
- Hub full suite: **1,711 passed**; package check passed afterward, not concurrently. No Hub code changed after these checks.
- Model-free validation: **11 distinct GOAL notes and 23 tool lifecycles across four retained sessions**, including raw live stage checks. Final live GOAL: `Debug failing test` → unchanged after the fix → `Explain blue sky`.
- Both repositories passed `git diff --check`. Integration tips were merged before commit; both were already current.

## Review and reflection

- Code critic returned LGTM on all three passes: job `855db51e-a4c9-42d9-9c13-6edf69a8526f`, latest result `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/855db51e-a4c9-42d9-9c13-6edf69a8526f/turns/003-result.md`. No findings were rejected.
- Review fixed GOAL leakage under Answer/Reply panels and inherited open-lens leakage on subagent resume.
- Reflection resolved stale Rules/Hub progress and lens references. Event-shape and prompt lessons remain in tests and evidence, not new agent rules.
- Docs critic returned LGTM: job `c69e4dff-23a5-4d7a-99f4-7fedf70e5ab8`, result `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/c69e4dff-23a5-4d7a-99f4-7fedf70e5ab8/turns/001-result.md`. No findings were rejected.
- No follow-up tickets were created or updated. The observed qualifier case passed the bounded experiment and confirmation; no residual qualifier ticket was needed.

## Retained evidence and handoff

`agent-work/tickets/card-signal-002/validation.md`, `validate.mjs`, `prompt-trials.json` and the four small mock-only corpora retain review/reproduction evidence (248 KB). Throwaway projects and streaming logs were removed. Full trial budgets and historical failed attempts are documented in validation.

Only ticket branches are committed. The parent owns integration, push/PR decisions and worktree closeout; the worktree remains intact. Ignored build/dependency and test-cache roots remain local and are not committed.
