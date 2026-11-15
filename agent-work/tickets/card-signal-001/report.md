# Card signal study

## Findings

Treat NEXT as a previous-turn prediction, not a current action. The decision-wait mock kept saying it awaited a choice for 30.94 seconds after the script answered. Execute's DOING also trails work until the agent ticks the plan. These are separate clocks, so the card can disagree with itself without any model inventing facts.

Real Execute progress usually arrived in phase batches: 18 of 20 updates ticked multiple tasks, and 17 completed an entire untouched phase. All six real episodes with a final plan were fully checked by their observed ending. The lag is mainly between checkpoints, not a demonstrated failure to update by the end.

SAID usually remained relevant in the mock judgments. Its age alone does not prove drift. The tool-order metric flags narration that outlives another tool, including messages that correctly describe several upcoming actions.

## Method and assumptions

1. Run 13 isolated mock sessions: seven `openai/gpt-6.1-sol`, four `openai/gpt-6.1-terra`, two `claude-code/claude-opus-5-5`; select the 25 most recently modified eligible real sessions with progress and at least 10 tool calls, excluding identifiable subagents.
2. Follow each session's last leaf through `id` and `parentId`; rebuild producer entries and message state without thinking text. Store constant-state intervals that give the state at every second and preserve sub-second boundaries.
3. Treat entry timestamps as display times. Actual Hub delivery coalesces activity heartbeats by up to 750 ms. The study does not load Hub into mock sessions or change any producer behavior.
4. Estimate a selected card with unread requests and a live interaction bridge. Allow up to one second of SAID poll delay; bound analysis text to 600 characters. Apply the card's DOING and request visibility rules before judging.
5. Use timestamped RPC events for mock tool execution and running state; infer real intervals from messages. Exclude unbounded tool intervals from wall-time rates. Judge 120 seeded, roster/turn-stratified moments with `openai/gpt-6.1-sol`, capped by session.

These are diagnostic samples, not a fleet-wide error rate. Sampling covers state transitions, including very short ones, rather than weighting by wall time. Real logs cannot show selection, acknowledgements, unavailable bridges, exact streaming display, subagent roster activity, or width clipping. SAID fallback coverage is therefore especially limited. The judge sees tool names, short arguments and success/error status, not full results or source files. `unclear` is a real outcome, particularly for DONE. No real conversation text, verdict reasons, or source paths appear in this report or the committed artifacts.

## Field judgments

Shares use visible judgments as the denominator, including `unclear`. Hidden or absent values are `n/a` and excluded. Each cell gives match / stale / wrong / unclear. `wrong` requires contradictory evidence; it does not mean that a missing fact was false. Obsolete waiting claims can be classified as wrong when current edits contradict them.

| Field | Mock visible n | Mock match / stale / wrong / unclear | Real visible n | Real match / stale / wrong / unclear | n/a, mock / real |
|---|---:|---|---:|---|---:|
| DOING | 12 | 83.3% / 8.3% / 0% / 8.3% | 13 | 23.1% / 46.2% / 0% / 30.8% | 33 / 62 |
| DONE | 7 | 14.3% / 0% / 14.3% / 71.4% | 41 | 24.4% / 0% / 0% / 75.6% | 38 / 34 |
| NEXT | 4 | 25.0% / 25.0% / 50.0% / 0% | 36 | 11.1% / 58.3% / 16.7% / 13.9% | 41 / 39 |
| SAID | 26 | 96.2% / 3.8% / 0% / 0% | 50 | 92.0% / 8.0% / 0% / 0% | 19 / 25 |
| Roster line | 36 | 83.3% / 2.8% / 0% / 13.9% | 75 | 84.0% / 9.3% / 0% / 6.7% | 9 / 0 |

NEXT was stale or wrong in 27 of 36 visible real judgments. DOING was stale in 6 of 13. Two of those six DOING moments and five of the 27 NEXT moments occupied intervals shorter than 750 ms. Four stale DOING moments and 22 stale/wrong NEXT moments remained in longer intervals. These counts reduce concern that every disagreement is just a timestamp artifact, but they still are not actual render observations. The mock NEXT denominator is only four; use the reproduced answered-decision case rather than treating its percentage as a population estimate.

The mock DOING stale verdict occurred during a one-millisecond transition while the agent ticked the old task and began the next edit. That is below the heartbeat and polling resolution. It is evidence of a producer boundary, not proof that a user saw that stale frame. DONE's unclear judgments do not justify concluding that completed work was wrong.

## Timing

| Metric | Mocks | Real sessions |
|---|---:|---:|
| Sessions / user turns / tool calls | 13 / 21 / 123 | 25 / 318 / 5,139 |
| Ended turns with no subsequent note | 1 / 21 | 102 / 274 |
| Incomplete turns | 0 | 44 |
| Note lag, median / p90 seconds | 4.82 / 7.68, n=20 | 7.50 / 10.89, n=172 |
| Visible note age at tool start, median / p90 seconds | 34.45 / 51.48, n=9 | 563.47 / 12,621.56, n=1,779 |
| Visible notes older than the current turn | 100% of 9 tool starts | 100% of 1,779 tool starts |
| Older-turn NEXT, share of bounded wall time | 10.21% | 1.82% |
| Older-turn NEXT, share of visible NEXT time | 99.77% | 15.18% |
| File-edit to advancing plan tick, median / p90 seconds | 12.78 / 17.48, n=5 | 6.28 / 20.05, n=2 |
| Execute edits with no observed advancing tick | 2 | 40 |
| DOING dwell, median / p90 seconds | 13.19 / 21.83 | 189.98 / 2,486.21 |
| NEXT dwell, median / p90 seconds | 3.42 / 30.94 | 73.47 / 1,506.96 |
| SAID dwell, median / p90 seconds | 5.65 / 23.24 | 39.90 / 892.50 |
| SAID age at tool start, median / p90 seconds | 4.70 / 19.88, n=77 | 16.19 / 841.27, n=3,818 |
| Tool starts under narration older than the prior tool's end | 67.53% | 67.26% |
| SAID handoff fallback share / older-user-message episodes | 0% / 0 | 0% / 0 |
| Unknown tool intervals / excluded wall seconds | 0 / 0 | 2 / 55,316.41 |
| Bounded wall seconds, including idle gaps | 595.02 | 2,073,502.42 |

A note older than the turn is not automatically stale, especially DONE. Turn-end generation makes this age pattern expected. Long idle gaps dilute the wall-time NEXT share, so the visible-NEXT denominator matters. Percentiles use nearest rank. The mock runner waits for metadata, then sends the next prompt immediately; it does not estimate overlapping-note suppression or realistic idle reading time. Its one missing note belongs to the deliberately aborted turn. Real missing notes cannot distinguish aborts, disabled or older runtimes, in-flight calls, and provider failures. Incomplete real turns have no observed terminal response and do not enter the missing-note denominator. The checkbox metric is a proxy for task lag, not proof that every edit completed the task. The mocks deliberately add eight-second verification waits.

## Execute cadence

Cause 8 is visible in the recorded progress pattern. The three planned Execute mocks updated mainly per task. Real Execute work mostly updated whole phases at once: 18 of 20 updates ticked multiple tasks, and 17 completed a previously untouched phase. Progress caught up by the observed ending in every run with a final plan projection. That does not mean DOING stayed current between those checkpoints.

The existing corpus contains four mock Execute episodes, including the abort/resume agent's incidental Execute step, and seven real Execute episodes from four sampled sessions. An episode is a contiguous published Execute period for one ticket. Its measured end is the last assistant/tool-result message or count change before leaving Execute, changing ticket, or reaching the recording boundary. Trailing idle and progress-note latency do not extend it; idle gaps inside an episode remain. All seven real episodes later left Execute. The mock episodes retained Execute at shutdown, but all had a final assistant response.

| Cadence measure | Existing Execute mocks | Real Execute episodes |
|---|---:|---:|
| Episodes / sessions | 4 / 4 | 7 / 4 |
| Episodes with a usable final plan / no plan projection | 3 / 1 | 6 / 1 |
| Published task-count updates | 10 | 20 |
| Interval between updates, median / maximum seconds | 13.22 / 19.92 | 311.03 / 1,689.32 |
| Tasks ticked per update, median / p90 | 1 / 2 | 4 / 9 |
| Single-task updates / bursts | 8 / 2 | 2 / 18 |
| Updates completing a phase / an entire untouched phase | 6 / 2 | 18 / 17 |
| Tick events in the final 10% of the episode | 2 / 12, 16.67% | 29 / 98, 29.59% |
| Final projected tasks all checked / known incomplete / unknown | 3 / 0 / 1 | 6 / 0 / 1 |
| Plan-affecting calls / all Execute tool calls | 12 / 58, 20.69% | 20 / 441, 4.54% |
| Explicit plan edit/write calls / corroborated shell updates | 11 / 1 | 1 / 19 |
| Plan-affecting call duration, median / p90 seconds | 0.002 / 0.005 | 0.064 / 18.98 |
| Last non-plan file change to next tick, median / p90 seconds | 6.40 / 16.96, n=5 | 49.33 / 249.03, n=11 |

The planned mocks show the individual cadence clearly:

| Scenario 4 model | Updates | Tasks ticked per update | Interval median / max seconds | Ticks in final 10% | Final plan | Plan-affecting call share |
|---|---:|---|---:|---:|---|---:|
| sol | 4 | 1, 1, 1, 1 | 13.22 / 19.92 | 0% | 4 / 4 checked | 4 / 19, 21.05% |
| terra | 3 | 1, 1, 2 | 13.19 / 14.83 | 50% | 4 / 4 checked | 3 / 15, 20.00% |
| Opus | 3 | 1, 1, 2 | 5.63 / 17.48 | 0% | 4 / 4 checked | 3 / 14, 21.43% |

The resume mock published no plan projection because Execute was not linked to the fixture ticket. It still made two explicit plan edits in ten Execute calls. Its zero published count updates do not prove that it left finished work unticked. One real episode likewise lacked a final plan projection. These cases stay unknown rather than counting as failures.

`execute_cadence` measures changes to the producer's `plan.tasks.completed`, not acceptance-criteria checkboxes or every saved plan file. This reuses the runtime's task/phase interpretation. It counts phase completions from the corresponding published phase counters. Repeated identical snapshots do not count as updates. Tick counts are positive count changes; a reopen would be recorded separately, but none occurred here. All observed updates were matched to a nearby plan edit or a shell call mentioning the plan directory, within one second of its result. A compound shell command can update the plan before a later command fails, so a nonzero exit status does not erase the published change.

Call share is a lower bound on plan-edit activity: shell rewrites that do not change the count are not identifiable. Shell calls can also bundle tests and other work, so their whole duration is not checkbox overhead. Mock durations use RPC execution events; real durations use serialized message intervals. There is no A/B timing experiment here to establish that frequent ticks slow the agent. The lag measure uses the last successful non-plan edit/write since the previous update as a task-block proxy. It does not identify the semantic completion time of an individual task, and misses source changes made only through shell scripts. This broader cadence measure includes corroborated shell ticks; the earlier file-edit-to-advancing-tick metric includes explicit edit/write ticks only.

The final snapshot confirms that all planned tasks are checked in three mock and six real episodes. It cannot prove which unchecked tasks were actually finished when a plan is absent, nor whether an assistant's completion claim was true. `finished_tasks_all_ticked` is therefore confirmed only for a fully checked final plan and unknown otherwise.

Recommendation: tick a task after its verification and before starting the next distinct task. Permit a single edit for tasks verified together, but do not wait until an unrelated phase ends. Keep live activity runtime-derived so the card moves even between legitimate checklist checkpoints. Do not auto-check tasks from file edits or a timer: those events do not prove task completion. Test any proposed Execute skill wording against this corpus before adopting it. No skill wording or producer behavior changed in this ticket.

## Ranked drift causes

1. **Turn-end refresh leaves NEXT behind, including answered decisions.** This covers suspected causes 1 and 5. Every observed visible note at a tool start came from before that user turn. The decision-wait mock, session `ff8e1b42db619701`, held an actual RPC question for 20.016 seconds, then displayed "Await your choice about adding negative-input tests before making any changes" for another 30.94 seconds while editing and testing. Two sampled moments contradicted that waiting claim. The terra topic-switch mock, session `116e2ff0fc107f93`, still showed a code-related NEXT after answering the unrelated sky question. Waiting is a request state; a generated NEXT should not own it.
2. **Execute DOING tracks checkbox publication rather than current work.** Suspected causes 3 and 8. Real cadence was predominantly phase-batched: 18/20 updates were bursts, with 17 completing an untouched phase, and a 311.03-second median update interval. Every known final plan was caught up, but intermediate DOING could still lag. The judge marked 6 of 13 visible real DOING moments stale; four occupied intervals longer than 750 ms. Five mock edit-to-tick intervals had a 12.78-second median; two bounded real intervals had a 6.28-second median. Forty real edits had no observed advancing tick, so their delays cannot be estimated. The one stale mock DOING judgment is a sub-heartbeat transition, so it must not be presented as a robust stale-display rate. The deterministic lag and separate meanings still explain why a checklist task and current tool can differ.
3. **Mid-turn narration outlives individual actions.** Suspected cause 6. Narration predates the prior tool's completion at 67.53% of eligible mock tool starts and 67.26% of real ones. In mock session `c6b44e11769ad0f6`, SAID still described fixing, waiting and refactoring after the test-file edit. The judge marked that moment stale. Most other visible mock SAID judgments matched, so replacing all narration with tool text would discard useful context.
4. **A missing note retains an old summary.** Suspected cause 4. One ended mock turn and 102 ended real turns lacked a subsequent note. The mock case is the intentional abort. No completed mock reported a metadata failure. The real count establishes missing updates, not which failure mechanism caused them. Do not treat all 102 as model failures or pending-call drops.
5. **Tool-free note input is a plausible blind spot, not a demonstrated cause here.** Suspected cause 2. The tool reuses Rules' existing transcript parser, which omits tools. However, this study has no tool-aware A/B condition, and several DONE judgments are unclear because the judge also lacks source contents and tool output. Adding more prompt input may help, but the evidence supports fixing stale state ownership first.
6. **Old-handoff SAID fallback remains unmeasured in practice.** Suspected cause 7. Both groups show zero fallback time under the selected/live/unread assumption. Tests verify the fallback for idle text-free turns and suppress it under an unread request. Real bridge loss and acknowledgement are absent from session logs, so zero is not evidence that the reported fallback problem cannot occur.

## Recommendations for 002 and 003

- For 002, keep GOAL tied to the user's task, with an explicit update when the user changes topic. Derive explore/change/verify from observed tools. Do not use the previous turn's NEXT to describe current activity.
- Clear a waiting prediction when the question resolves or a new user turn starts. Let an open question or handoff describe the request. Keep DONE as a past-work summary with an age or turn boundary rather than a claim about all work done in the current turn.
- For 003, give each step the same lens slots, but keep checklist position separate from live activity. Show the observed action in the activity slot and retain the first unchecked task as plan context. Otherwise parity repeats Execute's lag across every step.
- Keep SAID as the latest relevant message, separate from observed activity. Do not call all old narration stale. Add selected-card/bridge availability and acknowledgement evidence before trying to quantify handoff fallback.
- If later work changes progress input or refresh cadence, compare it against these same mocks. Test tool-aware input separately from visibility and freshness changes. No runtime, renderer, or workflow behavior changed in this ticket.

## Artifacts and reproduction

Rules owns the replay, metrics, judge and RPC driver under `tools/card-signal/`. See its README for commands. `mock/metrics.json` contains per-mock timing and numeric aggregates; `mock/timeline.jsonl` contains visible state intervals; `mock/verdicts.jsonl` contains mock-only judge inputs and verdicts; `mock/runs.json` maps scenario/model to session hash. `mock/inputs/` retains the 669 KB mock-only session and slim RPC corpus so replay does not need another model run. Slim RPC records retain exact lifecycle and tool times; replay equivalence was checked against all recorded mock metrics. Other raw mock project copies and streaming logs were removed. The verdict cache is content-addressed by model, prompt and complete sample. Real raw outputs, frozen inputs and caches stay in temporary storage for review, never Git.

Validation reran all 120 exact samples with a model callback that throws on a cache miss: 45 mock hits and 75 real hits, zero model calls. Full CLI reruns also succeeded with an empty HOME and only PATH in the environment, for 45 mock and 75 real samples. The 13 mock runs plus 120 study judgments and five initial judge smoke calls stayed within the approved model mix. Rules passed 92 Python checks, including the Node wrapper, and all 15 Node behavior tests passed. The user-approved cadence addition reused the existing Execute mocks and frozen real sample; it required no new mock or judge calls.

## Ten seeded mock spot checks

Inputs below contain mock conversations only. The seed is `spot-check`, applied to verdict hashes. Each link opens the exact input and verdict, including bounded user/assistant text, shown fields, three previous/next calls and completion/error flags. Excerpts below make the checks readable; the linked JSONL rows preserve the complete inputs. No manual verdicts replaced the model's output.

1. **Sol, scenario 6, start.** User asks "What is 7 - 4?" DONE and roster say "Answered that 2 + 3 = 5." No assistant response or tools appear in this moment's evidence. Judge marks DONE and roster `unclear`; other fields are `n/a`. This tests the judge's evidence limit rather than arithmetic correctness. [Exact input and verdict](mock/verdicts.jsonl#L24).
2. **Sol, scenario 1, start.** User asks for a bug fix, refactor and tests. Roster shows `NOW bash pwd && ls -la`; that command is the current/recent tool. Next calls read `sum.js`, `sum.test.js` and `package.json`. No other field is shown. Judge marks roster `match`. [Exact input and verdict](mock/verdicts.jsonl#L2).
3. **Opus, scenario 4, middle.** DOING and roster say "Run the failing test and inspect sum.js." NOW edits the plan; the previous-call window also contains the source edit. SAID says "Test fails (subtraction instead of addition). Ticking first task and fixing." Next calls test and wait, test again, then tick the plan. Judge marks DOING and roster `stale`, SAID `match`. This is the one-millisecond transition noted above. [Exact input and verdict](mock/verdicts.jsonl#L20).
4. **Opus, scenario 1, start.** NOW and roster show the same compound bash command that lists files, reads source/tests/package metadata and runs `node --test`. Next calls edit `sum.js`, run tests and sleep, then write the refactor. No progress or SAID is shown. Judge marks roster `match`. [Exact input and verdict](mock/verdicts.jsonl#L1).
5. **Sol, scenario 3, middle.** User authorizes the fix after a question. NEXT says "Await your choice about adding negative-input tests before making any changes." DONE says it found the subtraction bug, confirmed the failing test and changed no files. NOW and roster show `edit sum.js`. SAID says it will fix addition, add negative/zero coverage and test. Previous calls read the skill and plan; next calls test, edit tests, then test again. Judge marks NEXT `wrong`, DONE `unclear`, SAID and roster `match`. [Exact input and verdict](mock/verdicts.jsonl#L6).
6. **Terra, scenario 2, start.** User asks to debug and explain the failing test without fixing it. All shown fields are empty; the next three calls read source, read tests and run tests. Judge marks every field `n/a`. [Exact input and verdict](mock/verdicts.jsonl#L5).
7. **Terra, scenario 4, middle.** DOING and roster say "Fix sum and verify the positive case." NOW edits `sum.js`. SAID describes running the test, inspecting source, fixing and verifying before ticking tasks. Previous calls read source and tick the first plan task; next calls run tests plus an eight-second wait, tick the plan and read tests. Judge marks DOING, SAID and roster `match`. [Exact input and verdict](mock/verdicts.jsonl#L22).
8. **Sol, scenario 7, end of aborted turn.** User asked for `sleep 30` before inspecting or fixing. That sleep is the previous tool. The later resume will inspect the project, read the fixture skill and select Execute. The aborted moment shows no fields, so every verdict is `n/a`. [Exact input and verdict](mock/verdicts.jsonl#L26).
9. **Terra, scenario 6, end.** User asks "What is 7 - 4?" SAID answers "7 - 4 = 3." DONE and roster claim "Answered both arithmetic questions correctly." There are no tool calls and the earlier answer is absent from this sample. Judge marks SAID `match`, DONE and roster `unclear`. [Exact input and verdict](mock/verdicts.jsonl#L12).
10. **Sol, scenario 5, end.** DOING and roster say "Check edge coverage." SAID reports the positive-case failure and says it will probe zero, negative and decimal inputs without changes. Previous calls read tests, run tests and publish review items. Next calls run those probes, update items and publish review completion. Judge marks DOING, SAID and roster `match`. [Exact input and verdict](mock/verdicts.jsonl#L10).
