# Changelog

Release notes for `pi-agent-hub` npm and GitHub releases.

## Unreleased

Use this section while developing. Move entries into a versioned section before publishing.

### Added

- Add an attention-first Status view, repository grouping with `v`, and a read-only workflow board with `S`.
- Add selected-session task context and actions, live status evidence with `i`, and `pi-hub explain`.
- Add a Conversation panel with completed messages, a working indicator, and inline answers through compatible question extensions.
- Add `:` search for actions, sessions, and filters, plus notifications for fresh explicit requests.
- Add up to four live session pins with stable slots, `Alt+1`–`Alt+4` focus, and `x` to close the selected session's pin.
- Add producer-owned workflow progress, completion markers, and optional focus-mode display.
- Add dashboard theme preview and Pi theme synchronization.
- Document optional Rules and subagent setup and refresh the dashboard image.

### Changed

- Start fleet and board subagent trees collapsed; use arrow keys for one tree and Shift with arrows for all trees.
- Size session rows to the available space and show each parent's group after its title, alongside worktree and multi-repo indicators.
- Use `Ctrl+Q` to return to the dashboard; leave `Alt+Q` available for Pi message editing.
- Keep pin assignment non-destructive and preserve existing pins when the terminal shrinks.
- Open sessions directly with `Enter` at every width; use `i` for the full-width workspace in narrow terminals.
- Use distinct initial session/fork names and preserve linked ticket titles.
- Keep the dashboard responsive while compact forks prepare; expose retry and cancellation for failed preparation.
- Send configured commands through Pi's guarded input pipeline instead of simulated keystrokes.
- Require Pi 0.85.1 or later.
- Removed unused public exports `McpTool`, `PiToolDefinition`, `buildPiCommand`, `sessionDir`, `tmuxMissing`, and `mcpCatalogPath`; removed the unused singular worktree-removal wrapper. The SemVer decision for the narrowed package surface remains deferred to publishing.

### Fixed

- Resolve pin focus through live pane identity instead of stale slot targets.
- Keep fresh attention requests visible after earlier requests were acknowledged.

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
