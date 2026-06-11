# pi-agent-hub Configuration

This page covers runtime state, global config, themes, Skills, and MCP configuration. For dashboard usage, see [Features](FEATURES.md).

## Runtime state

- Global state: `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub` or `~/.pi/agent/pi-agent-hub`
- Config: `config.json` (`skills.poolDirs`, `mcp.catalogPath`, optional managed-session `session.prelude`, dashboard theme anchor, dashboard shortcuts)
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Optional session metadata: `session-metadata/<session-id>.json`
- Multi-repo workspaces: `workspaces/<session-id>`
- Hub-owned Git worktrees: `worktrees/<repo-name>/<session-id-prefix>-<branch-slug>`
- Recent repo history: `repo-history.json`
- Dashboard tmux session: `pi-agent-hub`
- Managed Pi tmux sessions: `pi-agent-hub-<first-12-session-id-chars>`
- Project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<global-state>/mcp.json` by default, configurable in `config.json`
- MCP pool socket: `<global-state>/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

### Session metadata

Extensions can publish dashboard-only semantic metadata for a managed session by writing:

```text
<global-state>/session-metadata/<session-id>.json
```

Hub treats this file as extension-owned transient state: it displays known fields in the selected-session details pane, removes the file on session delete, and never uses it for liveness, status counts, ordering, or Hub title changes.

```json
{
  "source": "my-extension",
  "goal": "Improve Hub metadata rendering",
  "status": "Generic metadata is visible in the dashboard",
  "nextStep": "Verify the details pane",
  "stage": "reviewing",
  "confidence": 0.86,
  "updatedAt": 1765060000000
}
```

Display rules:

- At least one of `goal`, `status`, `nextStep`, or `stage` must be present.
- If `confidence` is present and below `0.5`, Hub hides the metadata block.
- `source` and `updatedAt` are shown as provenance/freshness in the metadata header when present.

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
  },
  "session": {
    "prelude": "security show-keychain-info ~/Library/Keychains/login.keychain-db >/dev/null 2>&1 || security unlock-keychain ~/Library/Keychains/login.keychain-db"
  },
  "dashboard": {
    "themeSessionId": "last-entered-session-id",
    "shortcuts": [
      {
        "key": "C-n",
        "label": "summarize name",
        "send": "/session-summary name",
        "syncPiNameAfterMs": 1500
      }
    ]
  }
}
```

Use the CLI for common config changes:

```bash
pi-hub config get
pi-hub config set session-prelude '<shell snippet>'
pi-hub config unset session-prelude
```

## Dashboard shortcuts

`dashboard.shortcuts` binds extra normal-mode dashboard keys to one-line text sent to the selected live session through the same tmux paste/Enter path as `p`. Shortcuts are ignored in filters, forms, pickers, help, and other edit modes. They cannot target stopped, error, or subagent rows.

```json
{
  "version": 1,
  "dashboard": {
    "shortcuts": [
      {
        "key": "C-n",
        "label": "summarize name",
        "send": "/session-summary name",
        "syncPiNameAfterMs": 1500
      }
    ]
  }
}
```

Supported key spelling includes plain single characters, `C-x`/`ctrl+x`, and `M-x`/`alt+x`. Built-in dashboard keys and tmux return keys are reserved. `send` must be a single nonblank line; this is not a shell-command or macro facility.

`syncPiNameAfterMs` is a pi-agent-hub-specific post-action for `/session-summary name` workflows: after sending the shortcut, Hub waits that many milliseconds and then syncs the selected dashboard title from Pi's latest `session_info.name`, equivalent to pressing `N` later. `/session-summary name` is not built into Hub; it is provided by the optional [`pi-session-summary`](https://github.com/masta-g3/pi-session-summary) Pi extension.

## Session prelude

`session.prelude` is an optional shell snippet that runs before `pi` starts in every new, restarted, or forked managed session. It is useful for machine-local setup such as unlocking the macOS login keychain, starting an SSH agent, or loading `direnv`; do not store raw secrets in it.

Configure it without editing JSON manually:

```bash
pi-hub config set session-prelude 'security show-keychain-info ~/Library/Keychains/login.keychain-db >/dev/null 2>&1 || security unlock-keychain ~/Library/Keychains/login.keychain-db'
pi-hub config unset session-prelude
```

The dashboard itself and direct `pi-hub tui` runs do not run `session.prelude`.

## Skills configuration

If `skills.poolDirs` is omitted, `pi-agent-hub` uses `<global-state>/skills/pool`. Each pool directory contains skill folders, for example `my-skills/prime/SKILL.md`.

The `s` picker lists skills from these directories, shows the active pool path, and lets you edit it with `Alt+E`. The picker edits one pool directory for simplicity; saving replaces `skills.poolDirs` with that single path. Missing or empty directories are allowed and show an empty picker so you can create or populate the pool later.

Applying the picker writes the final project selection to:

```text
<project>/.pi/sessions/skills.json
```

`<project>` is the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected.

## MCP configuration

Available MCP servers come from the configured catalog path or `<global-state>/mcp.json` by default.

Example catalog:

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

The `m` picker writes project MCP state for the selected session's primary cwd, or the TUI/dashboard current working directory when no session is selected:

```text
<project>/.pi/sessions/mcp.json
```

In multi-repo sessions, Skills/MCP state applies to the primary repo only; the runtime workspace exposes that state through its `.pi` symlink.

Servers with `pool: true` require `pi-hub mcp-pool`; they are not started automatically.

```bash
pi-hub mcp-pool
```

## Theme behavior

The dashboard uses the last-entered managed session as its theme anchor when that session still exists, falling back to the initially selected session. Managed sessions publish the active `ctx.ui.theme` name/path and resolved color tokens through the heartbeat, so manual theme changes and theme-sync extensions are reflected without package-specific integration. The last-entered theme anchor is stored as `dashboard.themeSessionId` in hub config.

For the anchored session, a fresh live theme wins. When no fresh live theme is available, the standalone TUI reads Pi settings from that session project or dashboard project first (`.pi/settings.json`), then global Pi settings (`~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json`). Custom themes are loaded from `.pi/themes/<name>.json`, `<agent-dir>/themes/<name>.json`, configured theme paths, or package theme resources.

While open, the dashboard periodically reloads the effective theme state and updates its ANSI colors when tokens change.

Built-in Pi theme names `light` and `dark` map to compact theme token maps. Missing or invalid custom themes fall back to the built-in dark token map. Dashboard tmux status/footer chrome is configured separately; dashboard and managed-session tmux status bars are refreshed from the same effective theme while the dashboard is running.
