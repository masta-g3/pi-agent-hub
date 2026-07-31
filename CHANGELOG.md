# Changelog

Release notes for `pi-agent-hub` npm and GitHub releases.

## Unreleased

Use this section while developing. Move entries into a versioned section before publishing.

### Added

- Add explicit `x` then `1`–`4` panel close commands, guarded `Alt+1`–`Alt+4` focus jumps, and `Alt+Q` sidebar return from anywhere in the dashboard tmux session.
- Add tmux server epoch tracking, automatic Active-session recovery after whole-server replacement, and a manual `pi-hub recover` command.

### Changed

- Make side-panel numbers stable screen quadrants with occupancy-derived row/column layouts and non-destructive assignment keys; remove `Shift+1`–`Shift+4` panel focus aliases.
- Removed unused public exports `McpTool`, `PiToolDefinition`, and `buildPiCommand`; moved `cliTuiCommand` into `core/tmux` and deleted the shallow `core/cli-command` module.

### Fixed

- Fix `Alt+1`–`Alt+4` pane lookup so tmux resolves live slot metadata at keypress time and empty slots remain silent no-ops.
- Preserve specific per-session recovery failures for missing project directories or unreadable Pi history while continuing to recover other sessions.

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
