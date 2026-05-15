# pi-agent-hub Structure

`pi-agent-hub` is a minimal TypeScript package for managing Pi coding-agent sessions in tmux. It is Pi-only: Pi remains the agent runtime, tmux remains the process substrate, and this package supplies the dashboard/registry glue.

## Layout

```text
src/
  cli.ts                 command entrypoint (`pi-hub`; `pi-agent-hub` remains an alias)
  index.ts               public exports
  app/                   dashboard launcher, controller, refresh loop, and shared session actions for the standalone TUI
  core/                  registry, paths, tmux, Pi process args, status reducer, multi-repo workspace helpers
  extension/             tiny Pi extension for session heartbeats
  mcp/                   MCP catalog/project config, direct clients, pool, tool adapter
  skills/                project skill attach/detach and pool discovery
  tui/                   pure render model, terminal layout, shared text/form primitives, picker, and theme helpers
test/                    Node test-runner tests compiled by TypeScript
docs/STRUCTURE.md        this onboarding guide
```

## Runtime state

- Global state lives under `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub`.
- Optional global config lives at `config.json`; it can set skill pool directories and the MCP catalog path.
- The session registry is `registry.json`.
- `pi-hub` opens a stable dashboard tmux session named `pi-agent-hub`; use `pi-hub tui` to run the TUI directly without the dashboard wrapper. The `pi-agent-hub` command remains available as a compatibility alias.
- Managed Pi sessions write heartbeat files under `heartbeats/<session-id>.json` through the extension.
- Optional `pi-tmux-subagents` compatibility uses flat registry rows with `kind: "subagent"`, `parentId`, `agentName`, `taskPreview`, and `resultPath`; the dashboard renders those rows nested under their parent with a short agent-name row label, while task preview belongs in details/filtering. Standalone subagent state remains owned by `pi-tmux-subagents`.
- Managed tmux sessions use the `pi-agent-hub-<first-12-session-id-chars>` name.
- Multi-repo sessions keep `ManagedSession.cwd` as the primary repo and start Pi from `<global-state>/workspaces/<session-id>`, a symlink workspace containing the primary repo, each additional repo, and `.pi -> <primary>/.pi`.
- Recent repo choices for the new-session picker live in `<global-state>/repo-history.json`; current registry paths are merged with this bounded history at TUI startup.
- Project skill state lives in `<project>/.pi/sessions/skills.json`; available skills come from `skills.poolDirs` in global config or `<global-state>/skills/pool`.
- Project MCP enablement lives in `<project>/.pi/sessions/mcp.json`; available MCP servers come from the configured catalog path or `<global-state>/mcp.json`.
- In the standalone TUI, `<project>` for Skills/MCP pickers is the selected session's primary cwd, with dashboard cwd as the fallback when nothing is selected. For multi-repo sessions, Skills/MCP state applies to the primary repo only.
- Pooled MCP uses a Unix socket at `<global-state>/pool/pool.sock`; run `pi-hub mcp-pool` explicitly when pooled servers are enabled.
- Inside-tmux switch return state lives under `return-key/` while a temporary `Ctrl+Q` binding is active; `pi-hub doctor` reports active/stale return state.

## Build and test

```bash
npm install
npm test
npm run build
node dist/cli.js --help
node dist/cli.js tui
```

## Design rules

- Keep public names centralized in `src/core/names.ts`; `pi-hub` is the primary CLI command, `pi-agent-hub` is a compatibility alias, and runtime state/tmux names remain `pi-agent-hub`.
- Keep status logic centralized in `src/core/status.ts`. The TUI acknowledges a `waiting` session before attach/switch so opening it clears the unread/waiting indicator; keep that ordering when changing attach behavior.
- Keep tmux shelling centralized in `src/core/tmux.ts`. The default dashboard launcher creates/attaches/switches to `pi-agent-hub`; direct TUI mode is `pi-hub tui`. Inside-tmux managed-session attach uses native `switch-client` plus temporary guarded root bindings: `Ctrl+Q` returns to the dashboard, and `Alt+R` writes a dashboard action then returns into the selected session's rename dialog and switches back after a successful rename. Return binding scripts can recreate the dashboard before returning and only restore previous bindings after a successful return switch; dashboard recreation must preserve `PI_CODING_AGENT_DIR`/`PI_AGENT_HUB_DIR` via `dashboardEnv()`. Outside-tmux direct TUI attach remains normal `tmux attach-session`. Dashboard and managed-session tmux chrome is configured there too: both override status/window styles and formats so global tmux themes do not leak in, derive colors from `src/core/chrome.ts` theme tokens when available, sync active managed status bars from the dashboard on load/theme changes, and keep managed status-right as `ctrl+q return · alt+r rename │ 📁 <session title> | <project>`.
- Keep extension loading idempotent. Managed sessions still pass `--extension` so linked CLI usage works without `pi install`; when the package is also installed, the extension may load twice in one Pi process. Suppress duplicate registration, but clear active process guards on `session_shutdown` so later sessions can register.
- Delete sessions through `src/app/delete-session.ts`: stop tmux, remove any owned multi-repo workspace, remove the registry row, remove the heartbeat, and keep Pi conversation/session files. The TUI pauses the refresh loop before deletion so stale snapshots cannot rewrite deleted rows.
- Groups are implicit flat labels on sessions, not separate records. Creating a session with a new group label creates the group; pressing `g` in the TUI moves the selected session to an existing or new group, while `G` renames the selected session's current group for all sessions in that group. Pressing `K`/`J` or Shift-Up/Shift-Down reorders the selected session within its current group. Pressing `r` renames the selected session title; pressing `R` restarts it. Do not add separate empty-group lifecycle unless the model changes.
- Session row order is stable and user-controlled: `ManagedSession.order` is optional registry data, unordered rows fall back to group-relative registry order, and new/forked/group-moved sessions append to the target group. Controller navigation and render grouping must use `src/core/session-tree.ts`, which builds on `src/core/session-order.ts` and nests optional subagent rows under parents. Status and title changes must not move rows, and stopped sessions stay in-place instead of rendering in a separate subsection.
- Keep rendering pure and testable in `src/tui/*`; ANSI styling must stay width-safe via theme helpers. The dashboard theme follows Pi settings through `src/tui/theme.ts` and the small refresh loop in `src/app/run-tui.ts`; tmux chrome uses the same loaded `SessionsTheme` structurally through `src/core/chrome.ts` while keeping tmux option writes outside pure render code.
- Use `src/tui/text-input.ts` for cursor-aware single-line editing across all TUI text inputs, including forms, slash filter, and picker search. Use `src/tui/form.ts` plus `renderForm()` for editable dialogs. Keep `src/tui/new-form.ts` limited to new-session defaults, cwd suggestions, and validation; reserve `renderDialog()` for non-editable confirmations. Editable dialogs should show the same visible affordances as the new-session form: focused-field marker, cursor, hint text, and concise footer. Use `src/tui/repo-picker.ts` for focused repo selection; do not add filesystem scanning or async project discovery to populate choices. Use `▶` sparingly as the primary-action cue in confirmations, empty states, and no-match states.
- Use single bulk writes for multi-item project state changes; avoid parallel read-modify-write loops against JSON files.
- Keep clipboard integration best-effort. The UI must always show the actionable tmux command even when clipboard tooling is missing.
- Prefer small functions and explicit data shapes over framework abstractions.
