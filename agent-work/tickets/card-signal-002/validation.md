# Open Session Card validation

## Result

- Final wording passed three metadata-only trials and a confirming live topic-switch run: `Debug failing test` stayed identical after the fix, then changed to `Explain blue sky`. No temporary qualifier remained.
- GOAL stayed identical across all three turns of one addition-debugging task.
- GOAL changed when a second session switched from debugging to explaining the blue sky.
- Current producer replay matched all 12 recorded tool lifecycles. The debug track ended `explore✓ change✓ verify◉`. The tool-free topic switch cleared the previous topic's track.
- DOING described the in-flight tool and its short argument, then cleared. It never reused NEXT. The corrected replay passed the Rules entry through Hub's real context/lens parsers and renderer; the card showed GOAL, DOING and WHERE without DONE/NEXT.

## Model budget and evidence

Execute used exactly two new mock sessions on `openai/gpt-6.1-sol`. There were five completed turns, five progress notes and no metadata failures. No judge calls or model retries ran. The existing runtime still owns the separate progress-note model call; the stage track and DOING make no model calls.

- `mock/debug/`: a three-turn open-ended investigation, fix and edge-test task; 9 tools, session hash `9217570495ce1ad2`.
- `mock/topic-switch/`: the existing 001 scenario 2, debugging followed by a tool-free sky explanation; 3 tools, session hash `d3937c81cc3c4814`.
- Each directory retains the prompts, original session, slim exact-clock RPC events and run manifest. These small mock-only inputs support review and replay without another model run. Raw streaming logs and throwaway projects were removed.

Debug GOAL, repeated exactly: `Investigate this tiny project's failing addition tests without changing files`.

Topic-switch GOALs: `Debug the failing test without fixing it.` → `Explain why the sky is blue in two short sentences.`

## Findings and corrections

The live runs exposed that Pi's `tool_execution_end` event contains no arguments. The first implementation incorrectly read bash arguments there, so its raw saved stages missed verify calls. Classification now gets captured at tool start and applied only on completion. The lifecycle test now uses the real event shape, and it failed before this fix. The original model runs remain unchanged as evidence. The current producer was validated by deterministic replay of their captured starts, ends and model notes, with no new model call.

The initial debug GOAL included the first turn's temporary no-change restriction. Stability was correct, but this qualifier became misleading after permission to fix. The prompt now asks for the lasting purpose and excludes temporary restrictions, permissions, turn instructions and completion status. Execute did not give this refinement another live run because its two-run budget was exhausted. The first separately authorized Review run below tested it and reproduced the restriction problem. The approved prompt experiment and final confirmation then resolved this observed qualifier issue; both attempts remain as evidence.

Further lifecycle checks cover stage retention on resume without reviving DOING, reset on step start and `/wf-clear`, ignoring late unfinished calls after reset, abort cleanup, asynchronous first goals, changed-goal reseeding including newer observations, orchestration precedence, subagent suppression and publication only on change. Hub coverage includes narrow terminals down to 30 columns, ticket-copy precedence, unchanged workflow fields and quiet TASK fallback.

## Reproduce without model calls

From Hub, after `npm run build` (with Rules beside Hub):

```sh
node --experimental-strip-types agent-work/tickets/card-signal-002/validate.mjs
node --experimental-strip-types ../rules/tools/card-signal/cli.ts replay agent-work/tickets/card-signal-002/mock/debug/session.jsonl --out /tmp/card-signal-002-debug
node --experimental-strip-types ../rules/tools/card-signal/cli.ts replay agent-work/tickets/card-signal-002/mock/topic-switch/session.jsonl --out /tmp/card-signal-002-switch
```

`validate.mjs` checks current producer stages against independent expectations for each recorded tool, exact GOAL equality/change, and real Hub rendering. The 001 CLI reproduces the original display timeline (including the pre-fix stage bug); its old schema does not project GOAL or stages. Current replay reported 40 debug intervals and 21 topic-switch intervals.

## Checks

- Rules: `env -u PI_AGENT_HUB_PRIMARY_CWD -u PI_AGENT_HUB_FORK_COMPACT uv run pytest -q` — **92 passed**.
- Hub: `npm test` — **1,710 passed**.
- Hub: `npm run package:check`, run after tests, not concurrently — **passed**.
- Targeted Hub card/parser tests — **35 passed**.
- `validate.mjs` — **5 GOAL notes, 12 tool lifecycles, Hub render checks passed**.
- `git diff --check` — **passed in both repositories**.

No nested specialist was required by Execute. None was launched during that phase.

## Review verification

The parent authorized one additional `openai/gpt-6.1-sol` mock for the final prompt. `mock/review-topic-switch/` retains its original session, slim RPC events, prompts and manifest (hash `68113d56c9b8daed`). The topic-switch scenario includes an extra same-topic fix turn, so the single run tests restriction removal, goal stability and topic switching. It completed three turns, three notes and five tools with no metadata failure or retry.

Observed GOALs:

1. `Debug the failing test and explain the bug without fixing it.`
2. The identical GOAL, after `sum.js` was fixed and `node --test` passed.
3. `Explain why the sky is blue.`

**Initial review finding (resolved below):** the earlier prompt still included the temporary no-fix restriction despite explicitly asking the model to omit restrictions. It then preserves that misleading phrase after the user authorizes a fix. At that handoff no further prompt patch or model run was attempted. The parent then approved the bounded experiment below.

Raw live stage snapshots now match all five completed calls. The first turn ends `explore✓ change· verify◉`; the second ends `explore✓ change✓ verify◉`; the tool-free topic switch removes the track. `validate.mjs` now checks all three sessions: eight GOAL notes, 17 tool lifecycles and raw stage snapshots from this final live run. Its structural checks do not claim the restriction-containing GOAL is semantically correct.

Review fixed two independent leaks:

- GOAL is omitted under an open Answer/Reply panel, where the lens DOING suppresses other progress fields. A regression checks both panel kinds at 60 and 160 columns.
- Resuming a subagent with an inherited open-session lens now republishes the normalized snapshot without that lens. Fresh subagents, every active workflow step and orchestration takeover are also covered.

Review reruns: Rules **92 passed**; Hub **1,711 passed**; package check passed afterward, not concurrently; targeted card/parser tests **36 passed** before the final full run; model-free validation and both `git diff --check` commands passed. The 001 replay CLI produced **32 intervals** for the final live run with no model calls.

Craft reviewer: `code-critic`, job `855db51e-a4c9-42d9-9c13-6edf69a8526f`. Initial result: LGTM; no craft changes requested. A follow-up reviewed the two material fixes; its result is recorded in the plan. No other specialist was launched. Temporary projects, streaming logs and CLI output were removed after useful mock evidence was retained.

## Approved prompt experiment and final confirmation

The parent approved at most three metadata-only trials, then one confirming `openai/gpt-6.1-sol` mock only if the trials removed the qualifier, retained the same-topic goal and changed it on topic switch. All three calls used the actual session metadata pipeline and `gpt-6-luna` with its existing 128-token limit, medium reasoning and five-second timeout. No fallback model or retries were needed.

One candidate replaced the abstract lasting-purpose instruction with an action-and-object task title and a concrete contrast: `Debug addition`, not `Debug addition without fixing it`. It explicitly preserves the prior goal across fixes, more tests and permission changes. No parser stripping, fallback, extra production call or model change was added.

| Metadata trial | Recorded input | Returned GOAL |
| --- | --- | --- |
| 1 | Initial debug turn, no prior goal | `Debug addition tests` |
| 2 | Same-topic fix turn, trial 1 goal supplied | `Debug addition tests` |
| 3 | Recorded sky topic switch, trial 2 goal supplied | `Explain blue sky` |

`prompt-trials.json` retains the exact candidate, inputs, raw results, parsed notes and model/attempt metadata. The candidate passed all three checks, so it replaced the production GOAL instructions before the conditional live confirmation.

The single confirming live run is retained under `mock/confirmed-topic-switch/` (hash `db9c9996199e8ce7`). It used the same three-turn debug → authorized fix → sky scenario. All three turns and progress notes completed without metadata failure. Its GOALs were `Debug failing test`, `Debug failing test`, then `Explain blue sky`. All five classified tool calls advanced the expected stages. Its sixth call, `hand_off`, did not advance a stage or supply DOING. Republished context entries kept the same progress timestamp and are deduplicated by the replay validator.

Final model-free replay passes **11 distinct GOAL notes and 23 tool lifecycles across four sessions**, including raw live stage checks for the last two runs. The confirming run has **34 replay intervals**. This demonstrates the requested sampled behavior, not a universal guarantee about model-generated labels.

Verification after the prompt update: Rules full suite **92 passed**; the four-session model-free validator and replay CLI passed; diff whitespace checks passed. Hub production code did not change after its **1,711-test** and sequential package-check pass. A final code-critic pass reviewed the prompt and updated replay validator; its result is recorded in the plan.

Total additional budget after the parent's latest approval: **three metadata calls and one confirming mock run**. No further calls ran. No residual qualifier work was registered because the candidate and live confirmation passed.
