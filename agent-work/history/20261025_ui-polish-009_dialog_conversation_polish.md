# Dialog and conversation polish

**Feature:** ui-polish-009

**Branch:** `ui-polish-009` → `ui-polish-integration`

**Epic:** ui-polish-000

**Depends on:** ui-polish-002

## Implemented

- Shared `renderForm` accepts an opt-in primary field marker. New-session Create uses existing validation to stay accent-colored when submittable and muted when invalid; focused styling and Cancel remain unchanged. Section headings align with field labels.
- New-session directory fields show one Create/Choose directory/Cancel footer and no duplicate chooser hint. Existing Enter and Ctrl+Y creation bindings remain intact.
- Conversation speaker headers use colored labels without full-width rules. Short transcripts size to their content so the answer card follows immediately; long transcripts preserve scrolling, anchors, and clipped-speaker labels.
- Question hints share one width-fitted line using existing footer helpers. Only real errors or delivery state add a status row. Exact Enter/Esc mouse hit regions prevent other hint text from submitting an answer; custom-answer forms have no duplicate footer.

## Verification and review

- Added regression coverage for validation-driven button colors, unchanged ordinary forms, heading alignment, retained creation keys, label-only speakers, short-answer docking, long-history scrolling, width-safe hints, visible row targets, and separate Send/Escape mouse actions at 80/120/160 columns.
- Code-critic found accidental submission from the merged Escape hint. Fixed it with existing footer key ranges and a failing-then-passing regression. Second pass approved; no remaining actionable findings.
- Live smoke used a disposable isolated tmux server and state directory at 100×30 and 40×20. New-session layout and footer passed; no managed session was created and the global install was untouched.
- Merged integration tip `9766eb6` before commit, including Help/workspace rows and header tier chips; merge and autostash reapplication had no conflicts.
- Final `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test`: **1,232 passed, zero failures**. The first post-merge run had one transient missing-heartbeat failure in unchanged `test/fork-compact-startup.test.ts`; its 13-test targeted rerun and the full rerun passed without code changes.
- `git diff --check` passed. Earlier review typecheck passed.

## Reflection and handoff

No material scope changes, new dependencies, persisted state, or alternate renderers. Existing guidance remains accurate; no durable documentation changes or follow-up tickets were needed. Rendering details remain in owning code and tests rather than duplicating them in docs. Docs-critic was skipped because no guidance changed.

Parent owns integration and worktree closeout. No push, PR, or worktree cleanup is authorized for this ticket runner.
