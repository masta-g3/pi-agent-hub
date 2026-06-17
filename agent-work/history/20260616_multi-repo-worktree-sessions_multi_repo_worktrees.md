**Feature:** multi-repo-worktree-sessions

## Summary

Implemented hub-owned worktree sessions for multiple repositories while preserving the existing symlink workspace runtime model. A worktree session can now include a primary repo plus extra repo rows; Hub creates one worktree per repo using the same branch name, starts Pi in the per-session workspace, and points workspace `.pi` at the primary source repo so Pi project state does not dirty worktrees.

## Final Behavior

- New-session worktree mode (`Ctrl+T`) supports extra repos (`Alt+A`).
- One branch field creates the same new local branch in every selected repo and becomes the dashboard session title.
- New registry rows use `worktrees[]` as the source of truth for per-repo path, source root, branch, base branch, and role; scalar worktree fields remain for compatibility.
- Multi-repo worktree sessions run through `<PI_AGENT_HUB_DIR>/workspaces/<session-id>` with symlinks to each worktree.
- Normal delete/forget remains conservative: it removes the hub row/workspace/heartbeat but keeps worktree files and branches.
- Finish (`w`) preflights all worktrees and base repos before stopping tmux sessions, then merges/removes additional repos before the primary repo.
- Discard (`Shift+D`) removes all clean worktrees and branches without merging.
- Partial finish/discard failures keep a recoverable registry row with remaining worktree metadata.
- Creation rolls back already-created worktrees if a later repo fails, and reports rollback failures instead of swallowing them.

## Key Files

- `src/core/types.ts` — added `ManagedWorktree` and `ManagedSession.worktrees`.
- `src/core/worktree.ts` — added multi-worktree create, preflight, finish, discard, rollback, and metadata helpers.
- `src/core/multi-repo.ts` — links worktree workspace `.pi` to the primary source repo `.pi`.
- `src/app/session-commands.ts` — allows `worktree + additionalCwds`, records source repo history, and rolls back worktrees/workspace on startup failure.
- `src/app/worktree-session.ts` — finishes/discards all session worktrees and preserves remaining metadata on partial failure.
- `src/app/run-tui.ts`, `src/tui/new-form.ts`, `src/tui/render-model.ts`, `src/tui/layout.ts`, `src/tui/sessions-view.ts` — updated TUI context, form, dialogs, and details for multi-repo worktree sessions.
- Tests updated across `test/worktree.test.ts`, `test/session-commands.test.ts`, `test/multi-repo.test.ts`, `test/new-form.test.ts`, `test/run-tui.test.ts`, and `test/sessions-view.test.ts`.

## Validation

- `npx tsc -p tsconfig.json --noEmit` passed.
- `npm test` passed: 365/365 tests.
- Functional smoke worker passed focused new-form, creation, finish, and discard validation.

## Durable Docs Updated

- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`
