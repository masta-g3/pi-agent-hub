# Row hierarchy

**Feature:** ui-polish-004
**Branch / integration target:** `ui-polish-004` → `ui-polish-integration`
**Epic:** ui-polish-000
**Dependency:** ui-polish-003

## Outcome

- Fleet and board parent rows keep a fixed disclosure slot, blank without descendants, and one state slot. Explicit waiting/idle attention replaces the row's runtime glyph; runtime and attention remain independent in data, placement, evidence, and the action workspace.
- Worktree markers follow the title and precede `new`. Their width is reserved before fitting the title, so worktree state does not shift its start column. Markers survive title truncation; `new` yields before the readable title minimum.
- Parent session titles use bold primary text. Group and repo names use muted text without bold; subagent names retain secondary weight.
- Unselected running/starting rows show static `●`. Only the visible selected running/starting row requests spinner frames. Synthetic selections, off-screen rows, and covering screens do not trigger row animation; Conversation retains its independent working spinner.
- Reused the shared row renderer, existing badge-fitting logic, theme emphasis, and render-clock symbols. Added no persistence, settings, dependencies, or parallel renderers.

## Documentation and review

- Updated `AGENTS.md` and `docs/STRUCTURE.md` title order, fitting, weight, and motion contracts.
- Resolved the reflection candidate in `docs/FEATURES.md`: selected-only animation, trailing worktree markers, and attention/runtime glyph placement.
- Code critic `90435591-5809-459d-8863-e6436e49ede8` and docs critic `402573c3-0328-4049-8fbe-663ed86290c2` reported no actionable findings. Accepted both clean reviews; no rejected feedback or follow-up tickets.
- No product or architecture deviations and no discovered work. Local dependency installation reported 13 existing audit vulnerabilities; remediation was outside this ticket.

## Integration and validation

- Merged integration at `b278d663` before execution to include ui-polish-003 color-role guards.
- Before commit, merged integration tip `2613317`, including ui-polish-001 footer labels and initial cursor fixes. Resolved the shared cockpit-frame conflict by preserving the new footer labels and this ticket's row hierarchy. No implementation conflicts remained.
- Added regression coverage for title alignment at 44/80/120/160 columns, attention glyphs, trailing marker fitting, text weight, selected-only frames, synthetic selections, and visible-row animation state.
- Baseline: 1158 tests passed. Execute and review: 1171 tests passed. Final post-merge command `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test`: **1181 passed, 0 failed**, including color-role guards, footer/cursor tests, and cockpit fixtures.
- `git diff --check` passed. No temporary project artifacts retained. No global install changes, push, PR, ticket-to-integration merge, or worktree cleanup performed; parent owns integration and closeout.
