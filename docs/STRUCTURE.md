# pi-sessions Structure

`pi-sessions` is a minimal TypeScript package for managing Pi sessions in tmux. It is Pi-only: Pi remains the agent runtime, tmux remains the process substrate, and this package supplies the dashboard/registry glue.

## Layout

```text
src/
  cli.ts                 command entrypoint (`pi-sessions`)
  index.ts               public exports
  app/                   dashboard launcher, controller, refresh loop, and shared session actions for the standalone TUI
  core/                  registry, paths, tmux, Pi process args, status reducer
  extension/             tiny Pi extension for session heartbeats
  mcp/                   MCP catalog/project config, direct clients, pool, tool adapter
  skills/                project skill attach/detach and pool discovery
  tui/                   pure render model, terminal layout, shared text/form primitives, picker, and theme helpers
test/                    Node test-runner tests compiled by TypeScript
docs/STRUCTURE.md        this onboarding guide
```

## Runtime state

- Global sessions state lives under `PI_SESSIONS_DIR` or `<PI_CODING_AGENT_DIR>/pi-sessions`.
- Optional global config lives at `config.json`; it can set skill pool directories and the MCP catalog path.
- The session registry is `registry.json`.
- `pi-sessions` opens a stable dashboard tmux session named `pi-sessions-dashboard`; use `pi-sessions tui` to run the TUI directly without the dashboard wrapper.
- Managed Pi sessions write heartbeat files under `heartbeats/<session-id>.json` through the extension.
- Managed tmux sessions use the `pi-sessions-<first-12-session-id-chars>` name.
- Project skill state lives in `<project>/.pi/sessions/skills.json`; available skills come from `skills.poolDirs` in global config or the legacy `<global-state>/skills/pool`.
- Project MCP enablement lives in `<project>/.pi/sessions/mcp.json`; available MCP servers come from the configured catalog path or `<global-state>/mcp.json`.
- In the standalone TUI, `<project>` for Skills/MCP pickers is the dashboard process cwd, not the selected session cwd.
- Pooled MCP uses a Unix socket at `<global-state>/pool/pool.sock`; run `pi-sessions mcp-pool` explicitly when pooled servers are enabled.
- Inside-tmux switch return state lives under `return-key/` while a temporary `Ctrl+Q` binding is active; `pi-sessions doctor` reports active/stale return state.

## Build and test

```bash
npm install
npm test
npm run build
node dist/cli.js --help
node dist/cli.js tui
```

## Design rules

- Keep status logic centralized in `src/core/status.ts`.
- Keep tmux shelling centralized in `src/core/tmux.ts`. The default dashboard launcher creates/attaches/switches to `pi-sessions-dashboard`; direct TUI mode is `pi-sessions tui`. Inside-tmux managed-session attach uses native `switch-client` plus a temporary guarded `Ctrl+Q` return binding that can recreate the dashboard before returning and only restores the previous binding after a successful return switch; dashboard recreation must preserve `PI_CODING_AGENT_DIR`/`PI_SESSIONS_DIR` via `dashboardEnv()`. Outside-tmux direct TUI attach remains normal `tmux attach-session`. Dashboard and managed-session tmux chrome is configured there too: dashboard overrides status/window styles and formats so global tmux themes do not leak in, while managed status-right shows `ctrl+q return │ 📁 <session title> | <project>`.
- Keep extension loading idempotent. Managed sessions still pass `--extension` so linked CLI usage works without `pi install`; when the package is also installed, the extension may load twice in one Pi process. Suppress duplicate registration, but clear active process guards on `session_shutdown` so later sessions can register.
- Delete sessions through `src/app/delete-session.ts`: stop tmux, remove the registry row, remove the heartbeat, and keep Pi conversation/session files. The TUI pauses the refresh loop before deletion so stale snapshots cannot rewrite deleted rows.
- Groups are implicit flat labels on sessions, not separate records. Creating a session with a new group label creates the group; pressing `g` in the TUI moves the selected session to an existing or new group, while `G` renames the selected session's current group for all sessions in that group. Pressing `K`/`J` or Shift-Up/Shift-Down reorders the selected session within its current group. Pressing `r` renames the selected session title; pressing `R` restarts it. Do not add separate empty-group lifecycle unless the model changes.
- Session row order is stable and user-controlled: `ManagedSession.order` is optional registry data, legacy rows fall back to group-relative registry order, and new/forked/group-moved sessions append to the target group. Controller navigation and render grouping must both use `src/core/session-order.ts`; status and title changes must not move rows, and stopped sessions stay in-place instead of rendering in a separate subsection.
- Keep rendering pure and testable in `src/tui/*`; ANSI styling must stay width-safe via theme helpers.
- Use `src/tui/text-input.ts` for cursor-aware single-line editing across all TUI text inputs, including forms, slash filter, and picker search. Use `src/tui/form.ts` plus `renderForm()` for editable dialogs. Keep `src/tui/new-form.ts` limited to new-session defaults, cwd suggestions, and validation; reserve `renderDialog()` for non-editable confirmations. Editable dialogs should show the same visible affordances as the new-session form: focused-field marker, cursor, hint text, and concise footer. Use `▶` sparingly as the primary-action cue in confirmations, empty states, and no-match states.
- Use single bulk writes for multi-item project state changes; avoid parallel read-modify-write loops against JSON files.
- Keep clipboard integration best-effort. The UI must always show the actionable tmux command even when clipboard tooling is missing.
- Prefer small functions and explicit data shapes over framework abstractions.
