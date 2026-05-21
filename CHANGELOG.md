# Changelog

Release notes for `pi-agent-hub` npm and GitHub releases.

## Unreleased

Use this section while developing. Move entries into a versioned section before publishing.

### Added

### Changed

### Fixed

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
