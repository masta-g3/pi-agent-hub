# Changelog

Release notes for `pi-agent-hub` npm and GitHub releases.

## Unreleased

Use this section while developing. Move entries into a versioned section before publishing.

### Added

### Changed

### Fixed

## 1.2.0 - 2026-05-26

### Added

- Render nested subagent rows recursively with depth-aware indentation.
- Keep ancestor context visible when filtering for nested subagents.

### Changed

- Simplify dashboard shortcuts: `r` opens restart choices, `R` renames, `N` syncs the Pi name, and `q` quits.
- Improve restart/new-conversation flows and two-column picker keyboard navigation.

### Fixed

- Prune stale subagent rows when their tmux sessions no longer exist.

## 1.1.1 - 2026-05-21

### Fixed

- Clarify README and feature docs so multi-repo workspaces and hub-owned worktrees are presented as separate features.

## 1.1.0 - 2026-05-21

### Added

- Add hub-owned Git worktree sessions with TUI creation via `Ctrl+T`.
- Add explicit worktree finish, forget, and discard flows.
- Show worktree markers and metadata in dashboard rows/details.

### Changed

- Use the worktree branch name as the session title in worktree mode.
- Exclude hub-owned worktree paths from new-session repo suggestions and cycling.

### Fixed

- Keep worktree tmux sessions alive when finish preflight fails because the base repo is dirty.

## 1.0.4 - 2026-05-20

Current published version when this changelog was introduced. Earlier release notes were tracked through Git history and npm package versions.
