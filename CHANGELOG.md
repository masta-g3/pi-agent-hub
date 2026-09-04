# Changelog

Release notes for `pi-agent-hub` npm and GitHub releases.

## Unreleased

Use this section while developing. Move entries into a versioned section before publishing.

### Added

- Add independent persisted `v` density and `S` project/stage grouping controls. Density toggles compact rows and adaptive all-session junction cards grouped by existing Hub labels.
- Add producer `plan.phases` metadata support for phase-aware workflow progress.
- Add explicit `x` then `1`–`4` panel close commands, guarded `Alt+1`–`Alt+4` focus jumps, and `Alt+Q` sidebar return from anywhere in the dashboard tmux session.

### Changed

- Start project and board subagent trees collapsed with recursive `▸N`/`▾N` counts; add ephemeral arrow-key controls for one or all trees, filter-only reveal, and a narrower compact preview list.
- Keep the `⎇` worktree marker visible on main-session rows in every grouping and density.
- Make side-panel numbers stable screen quadrants with occupancy-derived row/column layouts and non-destructive assignment keys that keep focus in the sidebar; remove `Shift+1`–`Shift+4` panel focus aliases.
- Mute status glyphs in Backlog and Archived while retaining semantic status colors in Active.
- Removed unused public exports `McpTool`, `PiToolDefinition`, `buildPiCommand`, `sessionDir`, `tmuxMissing`, and `mcpCatalogPath`; removed the unused singular worktree-removal wrapper. The SemVer decision for the narrowed package surface remains deferred to publishing.

### Fixed

- Fix `Alt+1`–`Alt+4` pane lookup so tmux resolves live slot metadata at keypress time and empty slots remain silent no-ops.

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
