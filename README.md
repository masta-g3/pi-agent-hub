# pi-agent-hub

Tmux session hub for Pi coding agent sessions and subagents.

`pi-agent-hub` is a small Pi-native port of [Agent Deck](https://github.com/asheshgoplani/agent-deck), pared down to Pi as the only agent runtime and tmux as the process substrate.

- Pi is the only agent runtime.
- tmux owns long-running sessions.
- `pi-agent-hub` opens one stable dashboard tmux session for the control center.
- The standalone TUI shows managed sessions, status, preview metadata, filters, and simple actions.
- A tiny Pi extension writes heartbeats and registers enabled MCP tools.

![pi-agent-hub dashboard](assets/pi-agent-hub-dashboard.png)

## Acknowledgements

Thanks to [Ashesh Goplani](https://github.com/asheshgoplani) for [Agent Deck](https://github.com/asheshgoplani/agent-deck). This project ports its core session-dashboard idea into a smaller Pi-native extension. It is not affiliated with Agent Deck. See `LICENSE` for the Agent Deck MIT notice.

## Install

Install from npm:

```bash
pi install npm:pi-agent-hub
pi-agent-hub doctor
pi-agent-hub
```

Local development install:

```bash
git clone https://github.com/masta-g3/pi-agent-hub.git
cd pi-agent-hub
npm install
npm run build
npm link
pi install "$PWD"
pi-agent-hub doctor
pi-agent-hub
```

- `npm link` provides the `pi-agent-hub` shell command.
- `pi install "$PWD"` lets Pi discover the package extension through `package.json#pi.extensions`.
- Re-run `npm run build` after pulling updates.

Uninstall local setup:

```bash
pi remove /path/to/pi-agent-hub
npm unlink -g pi-agent-hub
```

## Development

```bash
npm test
npm run package:check
```

## CLI

```bash
pi-agent-hub              # create/attach/switch to the dashboard tmux session
pi-agent-hub tui          # run the TUI directly in the current terminal
pi-agent-hub doctor
pi-agent-hub list
pi-agent-hub add . -t api -g default
pi-agent-hub add ./api -t fullstack --add-cwd ../web --add-cwd ../shared
pi-agent-hub delete <session-id>
pi-agent-hub mcp-pool     # run the pooled MCP socket daemon
```

`add --add-cwd` creates a multi-repo session: `cwd` stays the primary repo, extra paths are symlinked into a per-session workspace, and Pi starts from that workspace. `delete` stops the tmux session if it is still alive, removes the registry row, removes the heartbeat file, and removes any owned multi-repo workspace. Pi conversation/session files and source repos are kept.

## Dashboard tmux behavior

Running `pi-agent-hub` uses one stable tmux session named `pi-agent-hub`:

- outside tmux: create or attach `pi-agent-hub`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs `pi-agent-hub tui` inside tmux so it does not recursively create dashboards. It also applies its own tmux status bar instead of inheriting global tmux theme chrome.

## TUI behavior

When the dashboard is running inside tmux, pressing `enter` on a managed session switches the current tmux client to that session and shows the equivalent `tmux switch-client -t <session>` command. Opening a `waiting` session marks it read before attaching, so it can show `idle` after you return; `a` remains the manual mark-read shortcut. Press `Ctrl+Q` from a managed `pi-agent-hub-*` session to return to the dashboard, or `Alt+R` to return directly into the rename dialog for that session and switch back after saving. If the dashboard tmux session is missing, the temporary return binding recreates it before switching back.

Groups are implicit flat labels. Use `n` to create a session; when a session is selected, the form defaults primary cwd, existing extra repos, and group to that session's context, otherwise primary cwd defaults to the dashboard cwd. Group defaults to the primary cwd basename and keeps auto-updating when the primary cwd changes until edited. Title defaults to a random two-word slug. Use `alt-a` to add extra repo rows and `alt-x` to remove the focused extra repo row; extra repos are symlinked into one runtime workspace. Cycling known cwd suggestions with `ctrl-n`/`ctrl-p` works on any repo row, and `ctrl-o` opens a searchable recent-repo chooser for the focused repo field. Use `g` on a selected session to move it to an existing or new group, and `G` to rename the selected session's current group for every session in that group. Use `K`/`J` or Shift-Up/Shift-Down to reorder the selected session within its current group; reordering is disabled while a filter is active. Use `r` to rename the selected session and `R` to restart it.

## Pi package

The package declares its extension in `package.json`:

```json
{
  "pi": {
    "extensions": ["dist/src/extension/index.js"]
  }
}
```

Package smoke before publishing:

```bash
npm run package:check
npm publish --dry-run
```

## Theme behavior

The standalone TUI reads Pi settings from the current project first (`.pi/settings.json`), then global Pi settings (`~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json`). Custom themes are loaded from `.pi/themes/<name>.json` or `<agent-dir>/themes/<name>.json`. While open, the dashboard periodically reloads that same Pi theme state and updates its ANSI colors when tokens change, so Pi theme changes from tools such as `pi-theme-sync` are reflected without restarting the dashboard.

Built-in Pi theme names `light` and `dark` map to compact theme token maps. Missing or invalid custom themes fall back to the built-in dark token map. Dashboard tmux status/footer chrome is configured separately; dashboard and managed-session tmux status bars are refreshed from the same loaded theme while the dashboard is running.

## Runtime state

- Global state: `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub` or `~/.pi/agent/pi-agent-hub`
- Config: `config.json`
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Multi-repo workspaces: `workspaces/<session-id>`
- Recent repo history: `repo-history.json`
- Dashboard tmux session: `pi-agent-hub`
- Managed Pi tmux sessions: `pi-agent-hub-<first-12-session-id-chars>`
- Project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<global-state>/mcp.json` by default, configurable in `config.json`
- MCP pool socket: `<global-state>/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

On first run, `pi-agent-hub` migrates existing local state from the old `pi-sessions` default path, rewrites managed tmux names when safe, and keeps a symlink at the old state path so already-running legacy processes can keep writing heartbeats until they are restarted. `doctor` reports conflicts it cannot resolve automatically.

## Global config

Optional global config lives at `config.json` under the global state directory:

```json
{
  "version": 1,
  "skills": {
    "poolDirs": [
      "~/.pi/agent/skills",
      "~/.pi/agent/pi-agent-hub/skills/pool"
    ]
  },
  "mcp": {
    "catalogPath": "~/.pi/agent/pi-agent-hub/mcp.json"
  }
}
```

If `skills.poolDirs` is omitted, `pi-agent-hub` uses `<global-state>/skills/pool`. The `s` picker lists skills from these directories and writes the final project selection to `<project>/.pi/sessions/skills.json`, where `<project>` is the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected.

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

The `m` picker writes this project state for the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected. In multi-repo sessions, Skills/MCP state applies to the primary repo only; the runtime workspace exposes that state through its `.pi` symlink. Servers with `pool: true` require `pi-agent-hub mcp-pool`; they are not started automatically.

## Smoke test with temp state

```bash
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_AGENT_HUB_DIR="$TMP/sessions" node dist/cli.js doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_AGENT_HUB_DIR="$TMP/sessions" node dist/cli.js list
```
