**Feature:** card-signal-001 → Card Signal Study
**Status:** Complete
**Repositories:** Rules tooling and tests; Hub report, evidence and ticket state
**Branch / target:** `card-signal-001` → `card-signal-integration` in both repositories
**Epic:** `agent-work/plans/card-signal-000.md`

# Card signal study

## Delivered

- Added `rules/tools/card-signal/` with active-branch replay, deterministic signal/timing metrics, a seeded LLM judge with content-addressed verdict caching, CLI reports, an isolated persistent-RPC mock runner, fixture project and seven scenarios. No new dependencies or production runtime/renderer changes.
- Studied 13 mocks: seven `openai/gpt-6.1-sol`, four `openai/gpt-6.1-terra`, two `claude-code/claude-opus-5-5`. Scored 45 mock and 75 real moments from 25 eligible real sessions with `openai/gpt-6.1-sol`. Five initial judge smoke calls preceded the 120 study judgments.
- Added the user-approved `execute_cadence` metric and regression tests. It measures published task/phase count changes, update intervals, task and phase bursts, final-tenth ticks, final-plan completeness, plan-call share and last-file-change-to-tick lag across mock and real Execute episodes.
- Delivered `agent-work/tickets/card-signal-001/report.md` with field-quality tables, timing, Execute cadence, ranked causes, recommendations for 002/003 and ten seeded mock spot checks. Retained mock timelines, metrics, inputs, verdicts and caches under that ticket's `mock/` directory. The mock input corpus is 669 KB and supports exact offline reproduction.
- Added a factual link from Rules `README.md` to the tool README. The parent corrected the epic's repository-scope note; the integration tip was merged into both ticket branches before closeout.

## Method and boundaries

Replay follows the last leaf through `id`/`parentId` and reuses Rules' context parsing. Constant-state intervals preserve every second and exact sub-second boundaries without repeated idle rows. SAID mirrors Hub's text selection locally because Rules cannot import Hub. The judge uses the current SDK's `ModelRegistry.complete`, with no model fallback or new local dependency.

Display times are estimated from entries, assuming a selected card, live bridge and unread requests. Heartbeat and polling delays, missing selection/acknowledgement data, width clipping and streaming prevent exact render reconstruction. Sampling covers state transitions rather than wall-time prevalence. Unknown tool intervals are excluded from wall-time rates; absence of evidence is not scored as wrong.

Cadence uses the producer's task and phase counters, excluding acceptance-criteria-only changes. Shell updates require a nearby count publication; a later failure in a compound command does not erase an observed update. Plan-call share is a lower bound, not proof of causal slowdown. Last-file-change lag is a task-block proxy, not semantic task-completion time. Completion remains unknown without a final plan projection.

## Findings

- NEXT was stale or wrong in 27/36 visible real judgments. The decision-wait mock retained its waiting prediction for 30.94 seconds after the answer.
- DOING was stale in 6/13 visible real judgments; two occupied intervals shorter than heartbeat resolution. SAID matched in 46/50 visible real judgments.
- Real Execute cadence had 18/20 burst updates, including 17 whole-phase batches. Median update interval was 311.03 seconds; maximum was 1,689.32 seconds. All six real episodes with a final plan were fully checked by their observed ending. One real and one incidental mock episode lacked plan projections.
- Recommendations separate runtime-derived live activity from checklist position, clear answered waiting predictions, retain SAID as message context, and test task-checkpoint wording before adoption. This ticket changes neither workflow guidance nor producer behavior. Tool-input and handoff-fallback causes were not established.

## Verification and privacy

- Rules baseline passed 91 pytest checks; final suite passed 92, including the new Node-test wrapper. All 15 Node behavior tests passed. TypeScript syntax, shell syntax, link and whitespace checks passed.
- All 120 exact verdicts replayed with a callback that rejects live model calls. Full CLI reruns also succeeded with an empty HOME and only PATH. Retained mock inputs reproduce exact timelines, metrics and 45 cached samples; frozen real inputs reproduced aggregates and 75 cached samples offline.
- Review compared candidate files against 25 actual real source paths/IDs, 1,014 full conversation messages and 421 bounded real judge-input strings: zero matches. Mock and real source IDs are disjoint. Only mock conversations are retained; raw real inputs/results stayed in temporary storage outside the repositories.
- Code-critic `31982be0-2685-4bd4-864c-f3aae16766f8` returned LGTM. No review code corrections were required. Docs-critic was skipped for the minor link-only reflection edit.
- Reflection candidates are resolved. No follow-up tickets were created; recommendations remain evidence for the planned 002/003 work.

## Closeout

All implementation and acceptance checks passed. Both ticket branches contain the requested integration tip. Worktrees remain available for parent-owned integration and cleanup; no push or PR is part of this ticket's closeout.
