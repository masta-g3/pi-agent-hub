# pi-sessions

Minimal Pi-native session manager for tmux-managed Pi sessions.

- Pi is the only agent runtime.
- tmux owns long-running sessions.
- `pi-sessions` opens a stable tmux dashboard session for the control center.
- The standalone TUI shows managed sessions, status, preview metadata, filters, and simple actions.
- A tiny Pi extension writes heartbeats and registers enabled MCP tools.

## Install for development

```bash
cd /Users/manager/Code/agents/pi-command-center
npm install
npm test
npm run build
```

## Local dogfood install

Use both installs while testing locally:

```bash
npm link
pi install /Users/manager/Code/agents/pi-command-center
pi-sessions doctor
pi-sessions
```

- `npm link` provides the `pi-sessions` shell command.
- `pi install ...` lets Pi discover the package extension through `package.json#pi.extensions`.

Uninstall local dogfood setup:

```bash
pi remove /Users/manager/Code/agents/pi-command-center
npm unlink -g pi-sessions
```

## CLI

```bash
pi-sessions              # create/attach/switch to the dashboard tmux session
pi-sessions tui          # run the TUI directly in the current terminal
pi-sessions doctor
pi-sessions list
pi-sessions add . -t api -g default
pi-sessions delete <session-id>
pi-sessions mcp-pool       # run the pooled MCP socket daemon
```

`delete` stops the tmux session if it is still alive, removes the registry row, and removes the heartbeat file. Pi conversation/session files are kept.

## Dashboard tmux behavior

Running `pi-sessions` uses one stable tmux session named `pi-sessions-dashboard`:

- outside tmux: create or attach `pi-sessions-dashboard`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs `pi-sessions tui` inside tmux so it does not recursively create dashboards. It also applies its own dark tmux status bar instead of inheriting global tmux theme chrome.

## TUI behavior

When the dashboard is running inside tmux, pressing `enter` on a managed session switches the current tmux client to that session and shows the equivalent `tmux switch-client -t <session>` command. Press `Ctrl+Q` from a managed `pi-sessions-*` session to return to the sessions dashboard. Managed tmux sessions get a Pi-native status footer with `ctrl+q return │ 📁 <session title> | <project>`. Outside tmux direct TUI mode, attach uses normal `tmux attach-session`; return with tmux's standard detach keys.

Groups are implicit flat labels. Use `n` to create a session with any group name, `g` on a selected session to move it to an existing or new group, and `G` to rename the selected session's current group for every session in that group. Use `r` to rename the selected session and `R` to restart it. Editable dialogs share the same form UI with a visible focused field/cursor; rename dialogs are pre-filled with the current value, and `f` opens separate group/title fields with Tab cycling. Text inputs support left/right, Home/End, Ctrl/Alt-left/right word jumps, Ctrl-W or Ctrl/Alt-Backspace word delete, and Delete/Ctrl/Alt-Delete forward delete where the terminal sends those keys.

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
pi install /Users/manager/Code/agents/pi-command-center
```

Package smoke before publishing:

```bash
npm run package:check
npm publish --dry-run
```

The npm name `pi-sessions` is already taken. Before public npm publish, choose a scoped package name such as `@your-scope/pi-sessions` and keep the binary name `pi-sessions`.

## Theme behavior

The standalone TUI reads Pi settings from the current project first (`.pi/settings.json`), then global Pi settings (`~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json`). Custom themes are loaded from `.pi/themes/<name>.json` or `<agent-dir>/themes/<name>.json`. If a theme cannot be loaded, `pi-sessions` falls back to a small built-in dark token map.

## Runtime state

- Global state: `PI_SESSIONS_DIR` or `<PI_CODING_AGENT_DIR>/pi-sessions` or `~/.pi/agent/pi-sessions`
- Config: `config.json`
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
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

If `skills.poolDirs` is omitted, `pi-sessions` keeps the legacy default of `<global-state>/skills/pool`. The `s` picker lists skills from these directories and writes the final project selection to `<project>/.pi/sessions/skills.json`, where `<project>` is the TUI/dashboard current working directory.

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

The `m` picker writes this project state for the TUI/dashboard current working directory. Servers with `pool: true` require `pi-sessions mcp-pool`; they are not started automatically.

## Smoke test with temp state

```bash
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js list
```
