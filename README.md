# pi-sessions

Minimal Pi-native session manager for tmux-managed Pi sessions.

- Pi is the only agent runtime.
- tmux owns long-running sessions.
- The standalone `pi-sessions` TUI shows managed sessions, status, preview metadata, filters, and simple actions.
- A tiny Pi extension writes heartbeats and registers enabled MCP tools.

## Install for development

```bash
cd /Users/manager/Code/agents/pi-sessions
npm install
npm test
npm run build
```

## CLI

```bash
node dist/cli.js --help
node dist/cli.js doctor
node dist/cli.js list
node dist/cli.js add . -t api -g default
node dist/cli.js delete <session-id>
node dist/cli.js
```

`delete` stops the tmux session if it is still alive, removes the registry row, and removes the heartbeat file. Pi conversation/session files are kept.

After linking or publishing, the binary is `pi-sessions`.

## TUI attach behavior

When `pi-sessions` is running inside tmux, pressing `enter` on a managed session switches the current tmux client to that session and shows the equivalent `tmux switch-client -t <session>` command. Press `Ctrl+Q` from a managed `pi-sessions-*` session to return to the sessions dashboard. Outside tmux, attach uses normal `tmux attach-session`; return with tmux's standard detach keys.

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
pi install /Users/manager/Code/agents/pi-sessions
```

## Theme behavior

The standalone TUI reads Pi settings from the current project first (`.pi/settings.json`), then global Pi settings (`~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json`). Custom themes are loaded from `.pi/themes/<name>.json` or `<agent-dir>/themes/<name>.json`. If a theme cannot be loaded, `pi-sessions` falls back to a small built-in dark token map.

## Runtime state

- Global state: `<PI_CODING_AGENT_DIR>/pi-sessions` or `~/.pi/agent/pi-sessions`
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<agent-dir>/pi-sessions/mcp.json`
- MCP pool socket: `<agent-dir>/pi-sessions/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

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

## Smoke test with temp state

```bash
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_SESSIONS_DIR="$TMP/sessions" node dist/cli.js list
```
