# Key notation consistency

**Feature:** ui-polish-002

**Branch:** ui-polish-002

**Integration target:** ui-polish-integration

## Delivered

- Added `formatKey()` beside the dashboard binding matcher. Catalog display keys use `Ctrl+O`, `Alt+N`, arrow modifiers, and named keys; printable key case stays intact. Config bindings and matching are unchanged.
- Help shows primary display keys only. Enter aliases, rename `e`, and sync `Alt+N` remain supported but hidden.
- Normalized dialog, picker, palette, filter, coaching, and footer hint notation and sentence-case action labels.
- Header counts say `sessions`, including filtered and workflow-board counts. Parent-only counting is unchanged. Help says `subagent rows`.
- Phone `i` is labeled `Workspace`, matching intermediate-width footers. Existing whole-item fitting drops Filter at 44 columns and no longer fits Next in ordinary 60-column footers; coaching footers can retain Next. Parent accepted this consequence. No footer-priority change.
- Corrected existing key notation and phone-footer examples in `README.md` and `docs/FEATURES.md`. No new rules or behavior added.

## Integration

- Merged initial integration tip `2613317` before implementation, including footer/cursor and color-role tickets.
- Before commit, merged integration tip `a9ccf7a`, including row hierarchy (`ui-polish-004`), through merge commit `f36b2ed`.
- Resolved cockpit-frame and render-model assertion conflicts by retaining 004's row glyphs/alignment and 002's session counts/Workspace wording. Kept 004's Help status legend with 002's key notation. Layout changes from this ticket remain strings only.

## Validation and review

- Baseline: 1,168 tests passed. Review: 1,174 tests passed.
- After integration: `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test` passed all 1,187 tests.
- Guard rerun: `env -u PI_TMUX_SUBAGENTS_JOB_ID node --test dist/test/key-notation.test.js` passed all six tests. These cover formatting, primary Help keys/hidden aliases, and rendered hints at 80 and 160 columns across palette, workspace, and dialog families.
- Existing interaction tests preserve shortcut behavior and phone Filter/Next tap routing. Updated frame fixtures retain width-safe geometry.
- `git diff --check` passed.
- Code critic `81e66201-8616-4393-9133-acea89062279` returned LGTM with no actionable findings; 57 targeted tests passed. No feedback rejected.
- Docs critic skipped for minor factual/notation corrections. No new follow-up tickets. Existing dependency audit findings remain tracked by the parent; no dependency changes made.

## Closeout boundary

Plan archived and ticket completed on the ticket branch. Parent owns integration and worktree closeout. No push, PR, global install, or worktree cleanup performed.
