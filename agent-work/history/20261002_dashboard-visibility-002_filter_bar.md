**Feature:** dashboard-visibility-002 → Filter bar
**Session:** 01a0f8d6-ffb9-701e-9ed6-d5f7f47e29d6
**Worktree:** none; existing /Users/manager/Code/agents/pi-agent-hub checkout, main
**Start branch:** n/a
**PR target:** n/a

## Delivered

- One prominent FILTERING/FILTERED bar above fleet, Repo, board and pinned results replaces the footer-only filter prompt and duplicate header query.
- Live preview remains unpersisted. Enter applies; blank Enter clears. Editing Escape restores the pre-edit filter; normal dashboard Escape clears.
- Restored filters, zero matches and all-matching filters remain visible. Hidden counts use projection-owned matching/total owner trees, Active-only on the board, not folded or offscreen row counts.
- Narrow layouts reserve state and exit controls. At three rows high the bar takes priority over the mode summary. Bar cells own no action targets; list, navigator, workspace and pinned decision targets retain exact identities.
- Slash leaves full-screen details through existing workspace cleanup, including evidence, while ordinary wide evidence remains unchanged. An empty registry permits clearing a restored filter but keeps slash inert.
- Reuses existing prompt state, text-input editing, projections, theme/layout helpers and guarded clear/apply paths. No new dependencies, persisted fields or shortcuts.

## Scope and review

- Preserved unrelated theme-loading, heartbeat, atomic-JSON, observation and shortcut changes in the shared checkout. Installation approval for all pending code did not expand this feature's review or commit scope.
- Plan/design review informed the shared bar. Code critic identified evidence cleanup and three-row priority issues; both were fixed with failing regression tests. Re-review: LGTM.
- Reflection updated `docs/FEATURES.md` filter controls and `docs/STRUCTURE.md` placement/count/height boundaries. Docs critic: LGTM. No global guidance or follow-up tickets needed.

## Verification

- Execution: 424 focused tests and an isolated real tmux keyboard smoke passed (edit/apply/cancel, 40-column resize, clear).
- Review: clean temporary lockfile dependencies passed typecheck and 425 relevant tests, including an unrelated pre-existing theme test excluded from this commit.
- Shared checkout node_modules are stale and lack the committed Pi TuiMainScreen API. Clean dependency staging passes. User approved validating the exact staged commit independently and bypassing the local pre-commit hook rather than replacing shared checkout dependencies.
- Exact feature-only staged snapshot: clean dependency installation passed typecheck and all 1,065 tests. Commit used the user-approved local-hook bypass; unrelated edits were excluded from the staged snapshot.
- Temporary builds never replaced checkout dist; temporary scripts/output were removed. Git whitespace checks passed.

## Installation boundary

The user approved installing all pending code changes. A separate temporary build passed typecheck, all 1,066 tests and package checks, then installed a tested tarball globally. Pi already references `/opt/homebrew/lib/node_modules/pi-agent-hub`. Running dashboards were not stopped. That installed snapshot predates the final two review fixes; reinstall the reviewed build separately if requested.

Installation staging and obsolete ticket patch/log evidence were removed at closeout; the reviewed feature is reproduced by this commit. No push, new branch, worktree or Rules repository change belongs to this ticket.
