# Worktree Support — Completed

Implemented lightweight, hub-owned Git worktree sessions for `pi-hub`.

## Summary

Users can create a one-repo worktree session from the TUI new-session form with `Ctrl+T`. The branch field creates the new local branch and also becomes the session title. Worktrees are stored under hub state at:

```text
<PI_AGENT_HUB_DIR>/worktrees/<repo-name>/<session-id-prefix>-<branch-slug>/
```

The dashboard now exposes explicit worktree lifecycle actions:

- `w` then `w`: finish a clean worktree session by merging the branch into the recorded base branch, removing the worktree, pruning Git metadata, deleting the merged local branch, and removing the dashboard row.
- `d` then `d`: forget the dashboard session only; keep the worktree and branch on disk.
- `d` then `Shift+D`: discard a clean worktree and branch without merging, then remove the dashboard row.

Normal delete remains conservative and does not destroy worktree files.

## Key implementation details

- Added `src/core/worktree.ts` for minimal Git helpers:
  - branch validation via `git check-ref-format --branch`;
  - hub-owned worktree creation;
  - clean-state checks;
  - finish merge/remove/prune/delete;
  - discard/remove without merge.
- Added worktree metadata to `ManagedSession`:
  - `worktreePath`, `worktreeRepoRoot`, `worktreeBranch`, `worktreeBaseBranch`, `worktreeOwnedByHub`.
- Added `src/app/worktree-session.ts` for app-level finish/discard flows and registry cleanup.
- Integrated worktree creation into `addManagedSession()` while rejecting worktree + extra repos in v1.
- Added rollback cleanup if session startup fails after worktree creation.
- Rejected forks of worktree-backed sessions in v1 to avoid multiple sessions sharing one owned worktree.
- Normal delete still removes registry rows/heartbeats and multi-repo workspaces, but leaves hub-owned worktree directories intact.
- Worktree finish/discard stops parent and cascaded subagent tmux sessions only after preflight clean checks pass.
- New-session suggestions now use the original repo root for worktree sessions and exclude hub-owned worktree paths from cwd suggestions/history cycling.

## TUI behavior

- New-session form shows a readonly worktree status row and toggles worktree mode with `Ctrl+T`.
- In worktree mode, the separate title field is hidden; branch becomes the session title.
- Session rows show a compact `[wt]` marker; details show branch/base/path metadata.
- Delete dialog for worktree sessions clearly distinguishes:
  - forget dashboard row only (`d`),
  - discard worktree/branch (`Shift+D`),
  - finish/merge instead (`w`).

## Documentation updated

- `README.md`
- `docs/FEATURES.md`
- `docs/STRUCTURE.md`
- `docs/CONFIG.md`
- `AGENTS.md`

## Validation

Validated with:

```bash
npx tsc -p tsconfig.json --noEmit
npm test
```

Final test run passed `329/329`.
