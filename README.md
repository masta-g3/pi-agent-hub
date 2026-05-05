# pi-sessions

Minimal Pi-native session manager for tmux-managed Pi sessions.

`pi-sessions` is a minimal Pi-native port of [Agent Deck](https://github.com/asheshgoplani/agent-deck), pared down to Pi as the only agent runtime and tmux as the process substrate.

- Pi is the only agent runtime.
- tmux owns long-running sessions.
- `pi-sessions` opens a stable tmux dashboard session for the control center.
- The standalone TUI shows managed sessions, status, preview metadata, filters, and simple actions.
- A tiny Pi extension writes heartbeats and registers enabled MCP tools.

## Acknowledgements

Thanks to [Ashesh Goplani](https://github.com/asheshgoplani) for [Agent Deck](https://github.com/asheshgoplani/agent-deck). This project ports its core session-dashboard idea into a smaller Pi-native extension and intentionally removes broader multi-agent/runtime scope. See `LICENSE` for the Agent Deck MIT notice.

## Install

`pi-sessions` is not published to npm yet. Install from a local clone for now:

```bash
git clone https://github.com/masta-g3/pi-sessions.git
cd pi-sessions
npm install
npm run build
npm link
pi install "$PWD"
pi-sessions doctor
pi-sessions
```

- `npm link` provides the `pi-sessions` shell command.
- `pi install "$PWD"` lets Pi discover the package extension through `package.json#pi.extensions`.
- Re-run `npm run build` after pulling updates.

Uninstall local setup:

```bash
pi remove /path/to/pi-sessions
npm unlink -g pi-sessions
```

## Development

```bash
npm test
npm run package:check
```

## CLI

```bash
pi-sessions              # create/attach/switch to the dashboard tmux session
pi-sessions tui          # run the TUI directly in the current terminal
pi-sessions doctor
pi-sessions list
pi-sessions add . -t api -g default
pi-sessions add ./api -t fullstack --add-cwd ../web --add-cwd ../shared
pi-sessions delete <session-id>
pi-sessions mcp-pool       # run the pooled MCP socket daemon
```

`add --add-cwd` creates a multi-repo session: `cwd` stays the primary repo, extra paths are symlinked into a per-session workspace, and Pi starts from that workspace. `delete` stops the tmux session if it is still alive, removes the registry row, removes the heartbeat file, and removes any owned multi-repo workspace. Pi conversation/session files and source repos are kept.

## Dashboard tmux behavior

Running `pi-sessions` uses one stable tmux session named `pi-sessions-dashboard`:

- outside tmux: create or attach `pi-sessions-dashboard`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs `pi-sessions tui` inside tmux so it does not recursively create dashboards. It also applies its own dark tmux status bar instead of inheriting global tmux theme chrome.

## TUI behavior

When the dashboard is running inside tmux, pressing `enter` on a managed session switches the current tmux client to that session and shows the equivalent `tmux switch-client -t <session>` command. Press `Ctrl+Q` from a managed `pi-sessions-*` session to return to the sessions dashboard; if the dashboard tmux session is missing, the temporary return binding recreates it before switching back. Managed tmux sessions get a Pi-native status footer with `ctrl+q return │ 📁 <session title> | <project>`. Outside tmux direct TUI mode, attach uses normal `tmux attach-session`; return with tmux's standard detach keys.

Groups are implicit flat labels. Use `n` to create a session; when a session is selected, the form defaults cwd and group to that session's context, otherwise cwd defaults to the dashboard cwd and group to the cwd basename. The title defaults to a random two-word slug. Add optional comma-separated `extra cwd(s)` to create a multi-repo session with those repos symlinked into one runtime workspace. Cycling known cwd suggestions updates the group until the group field is edited. Use `g` on a selected session to move it to an existing or new group, and `G` to rename the selected session's current group for every session in that group. Use `K`/`J` or Shift-Up/Shift-Down to reorder the selected session within its current group; reordering is disabled while a filter is active. Use `r` to rename the selected session and `R` to restart it. Editable dialogs share the same form UI with a visible focused field/cursor; rename dialogs are pre-filled with the current value, and `f` opens separate group/title fields with Tab cycling. Text inputs support left/right, Home/End, Ctrl/Alt-left/right word jumps, Ctrl-W or Ctrl/Alt-Backspace word delete, and Delete/Ctrl/Alt-Delete forward delete where the terminal sends those keys.

## Pi package

The package declares its extension in `package.json`:

```json
{
  "pi": {
    "extensions": ["dist/src/extension/index.js"]
  }
}
```

Local install:

```bash
pi install "$PWD"
```

Package smoke before publishing:

```bash
npm run package:check
npm publish --dry-run
```

The npm name `pi-sessions` is already taken. Before public npm publish, choose a scoped package name such as `@your-scope/pi-sessions` and keep the binary name `pi-sessions`.

## Theme behavior

The standalone TUI reads Pi settings from the current project first (`.pi/settings.json`), then global Pi settings (`~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json`). Custom themes are loaded from `.pi/themes/<name>.json` or `<agent-dir>/themes/<name>.json`. While open, the dashboard periodically reloads that same Pi theme state and updates its ANSI colors when tokens change, so Pi theme changes from tools such as `pi-theme-sync` are reflected without restarting the dashboard.

Built-in Pi theme names `light` and `dark` map to compact `pi-sessions` token maps. Missing or invalid custom themes fall back to the built-in dark token map. Dashboard tmux status/footer chrome is configured separately and is not theme-synced.

## Runtime state

- Global state: `PI_SESSIONS_DIR` or `<PI_CODING_AGENT_DIR>/pi-sessions` or `~/.pi/agent/pi-sessions`
- Config: `config.json`
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Multi-repo workspaces: `workspaces/<session-id>`
- Dashboard tmux session: `pi-sessions-dashboard`
- Managed Pi tmux sessions: `pi-sessions-<first-12-session-id-chars>`
- Project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<global-state>/mcp.json` by default, configurable in `config.json`
- MCP pool socket: `<global-state>/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

## Global config

Optional global config lives at `config.json` under the global state directory:

```json
{
  "version": 1,
  "skills": {
    "poolDirs": [
      "~/.pi/agent/skills",
      "~/.pi/agent/pi-sessions/skills/pool"
    ]
  },
  "mcp": {
    "catalogPath": "~/.pi/agent/pi-sessions/mcp.json"
  }
}
```

If `skills.poolDirs` is omitted, `pi-sessions` keeps the legacy default of `<global-state>/skills/pool`. The `s` picker lists skills from these directories and writes the final project selection to `<project>/.pi/sessions/skills.json`, where `<project>` is the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected.

## MCP catalog example

```json
{
  "version": 1,
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "mcp-filesystem",
      "args": ["."],
      "pool": false
    }
  }
}
```

Enable per project:

```json
{
  "version": 1,
  "enabledServers": ["filesystem"]
}
```

The `m` picker writes this project state for the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected. In multi-repo sessions, Skills/MCP state applies to the primary repo only; the runtime workspace exposes that state through its `.pi` symlink. Servers with `pool: true` require `pi-sessions mcp-pool`; they are not started automatically.

## Smoke test with temp state

```bash
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js list
```
