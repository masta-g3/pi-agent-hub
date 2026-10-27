# Dense one-line rows

**Feature:** ui-polish-006
**Branch:** `ui-polish-006`
**Integration target:** `ui-polish-integration`

## Outcome

- Added an automatic density rung for Active fleet parents in Status and Repo grouping at 61+ columns: rich cards → two-line neighbors → one-line neighbors → scrolling. No setting or persisted state was added.
- Measured the two-line fit with existing continuation priorities. Unselected parents collapse only when that rung overflows; the selected owner retains its card where space permits.
- Dense rows keep the bold title, trailing worktree/new markers, muted group · age, and producer workflow grid aligned under section labels. Group drops before age; an explicit step label replaces an over-wide grid before the title becomes unreadable. Hidden child-request counts keep priority.
- Both the content-height rung and existing short-height trigger use the same title-row renderer. Selected short-window rows keep group/age only in their retained metadata line, without duplicate title-tail text.
- Preserved board rendering, lifecycle rows, subagent micro rows, and phone behavior. Dense rows have one exact-session mouse target and no continuation targets.
- Updated AGENTS.md, docs/STRUCTURE.md, and docs/FEATURES.md. The reflection candidate is resolved; no follow-up tickets remain.

## Verification

- Added fit-boundary, sparse-fleet, aligned-grid, tail-retention, title-readability, marker, overflow, short-window, and real mouse/keyboard tests. Updated crowded-window expectations and cockpit frames.
- Code-critic confirmed the single renderer and approved the duplicate-metadata correction. Docs-critic approved the user-facing density description.
- Merged integration tip `f90cdc2`, including ui-polish-009, before the final commit. No conflicts or additional fixes were needed.
- Final `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test`: **1,246 passed**.
- `npm run typecheck` and `git diff --check` passed.

## Handoff

Commit stays on the ticket branch. The parent owns integration and worktree closeout; no push, PR, or cleanup was performed.
