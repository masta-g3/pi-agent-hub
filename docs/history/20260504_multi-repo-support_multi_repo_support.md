# Multi-repo session support

Implemented minimal symlink-based multi-repo support for `pi-sessions`.

## What changed

- `ManagedSession` now keeps `cwd` as the primary repo and can store `additionalCwds` plus `workspaceCwd`.
- Multi-repo sessions start Pi from `<PI_SESSIONS_DIR>/workspaces/<session-id>`, a pi-sessions-owned symlink workspace containing:
  - one symlink per repo, with duplicate basenames numbered (`web`, `web-1`, ...)
  - `.pi -> <primary-repo>/.pi` so runtime project state resolves to the primary repo
- Add/start/restart/fork recreate or reuse the effective workspace cwd before launching tmux/Pi.
- Delete removes only the owned workspace, then registry/heartbeat data; source repos and Pi conversation files are preserved.
- CLI creation supports repeatable `--add-cwd`.
- TUI creation supports an optional comma-separated `extra cwd(s)` field.
- Session rows/details show repo count, extra paths, and runtime workspace; filtering matches additional repo basenames.
- Skills/MCP pickers target the selected session's primary `cwd`, falling back to dashboard cwd when no session is selected.

## Key decisions

- Keep `cwd` as primary project state; use `effectiveSessionCwd()` only for runtime launch cwd.
- Use symlinks only; no worktrees, sandboxing, repo records, or Agent Deck mode matrix.
- Treat duplicate-only extra paths as a single-repo session.
- Validate repo paths exist and are directories before creating dangling workspace symlinks.
- Scope Skills/MCP state to the primary repo only.

## Verification

- `npm test` passed after implementation and after review fixes: 180/180.
- Review fix: `removeMultiRepoWorkspace()` now derives the owned workspace path when `additionalCwds` exists but `workspaceCwd` is absent.
- Durable docs updated in `README.md`, `docs/STRUCTURE.md`, and `AGENTS.md`.

## Follow-up

Created pending ticket `multi-repo-001` for improving TUI multi-repo creation UX because 2-3 repo launch flows are expected to be common.
