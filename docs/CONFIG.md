# pi-agent-hub Configuration

This page covers runtime state, global config, themes, Skills, and MCP configuration. For dashboard usage, see [Features](FEATURES.md).

## Runtime state

- Global state: `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub` or `~/.pi/agent/pi-agent-hub`
- Config: `config.json` (`skills.poolDirs`, `mcp.catalogPath`, optional managed-session `session.prelude`, `session.worktreeDefault`, dashboard theme sync/override, dashboard shortcuts)
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Latest one-time managed-session theme request: `theme-command.json`
- Multi-repo workspaces: `workspaces/<session-id>`
- Hub-owned Git worktrees: `worktrees/<repo-name>/<session-id-prefix>-<branch-slug>`
- Recent repo history: `repo-history.json`
- Dashboard tmux session: `pi-agent-hub`
- Managed Pi tmux sessions: `pi-agent-hub-<first-12-session-id-chars>`
- Materialized project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<global-state>/mcp.json` by default, configurable in `config.json`
- MCP pool socket: `<global-state>/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

### Generic session context

A Pi extension can append a latest-snapshot custom entry with `customType: "pi-agent-hub-context"`. Version 1 accepts a bounded ticket id, optional subtitle and description, and optional explicit `ready`, `question`, or `blocked` attention. Unknown fields are ignored. Hub copies the latest valid snapshot into its heartbeat. It does not read producer files or persist context in `registry.json`.

Pi's native session name is the canonical title and is sent separately as `heartbeat.piSessionName`. Hub uses the primary repo basename as a provisional label, then caches each nonblank heartbeat name. `R` sends exact `/name <text>` to a live Pi session. `N` remains manual recovery from persisted Pi `session_info`.

If generic context and workflow runtime contain different ticket ids, Hub keeps the workflow ticket id and suppresses context subtitle/description. Attention stays independent and appears only on waiting/idle rows.

### Workflow heartbeat bridge

Hub's extension can also surface workflow-stage state from the optional `workflow-runtime` extension (from the `rules` package). On every heartbeat tick it reads the Pi session branch via `sessionManager.getBranch()` and takes the latest custom entry of this shape:

```json
{
  "type": "custom",
  "customType": "workflow-runtime",
  "data": {
    "activeStep": "execute",
    "ticketId": "workflow-board-001",
    "updatedAt": 1765060000000,
    "activeMode": {
      "id": "focus",
      "short": "FOC",
      "label": "Focus",
      "detail": "turn 4"
    },
    "activity": {
      "id": "implementation-review",
      "label": "Reviewing implementation",
      "pass": 2
    },
    "plan": {
      "phase": { "title": "Bridge context", "index": 2, "count": 4 },
      "tasks": { "completed": 8, "total": 11 },
      "nextStep": "Validate the dashboard"
    },
    "steps": [
      { "id": "plan-md", "short": "PL", "label": "Plan" },
      { "id": "execute", "short": "EX", "label": "Execute" },
      { "id": "review", "short": "RV", "label": "Review" },
      { "id": "reflect", "short": "RF", "label": "Reflect" },
      { "id": "commit", "short": "CM", "label": "Commit" }
    ]
  }
}
```

The producer owns step order, ids, short codes, and optional labels. `activeStep`, finite `updatedAt`, and a nonempty `steps` array are required; each step needs a unique nonblank `id` and nonblank `short`, while `label` and `ticketId` are optional. `updatedAt` is the producer's state-change timestamp, so it can advance during one workflow step—for example, when a focus turn completes—independently of heartbeat cadence. Missing or malformed base workflow metadata silently removes the rail and canonical lane placement without affecting process state; an Active session still appears in `OTHER ACTIVE`. The board requires a `workflow-runtime` version from `rules` that publishes `steps` and `updatedAt` for producer-lane placement. Older payloads have no rail and stay in `OTHER ACTIVE`. No fallback step list is mirrored in Hub.

`activity` and `plan` are independent optional producer projections. A valid activity (`id`, `label`, optional positive `pass`) takes precedence on the card recap. Without activity, Hub shows bounded deterministic phase/task progress and `nextStep`; it does not inspect step ids to choose either path. Task counts are nonnegative integers up to 10,000. A plan can publish at most 100 phase counts, and their aggregate total must also stay at or below 10,000; Hub omits an invalid phase projection while retaining other valid plan fields. Malformed optional projections are omitted without hiding a valid base rail.

`activeMode` is an optional producer-owned display modifier. It requires nonblank `id` and `short`; `label` and `detail` are optional. Hub validates it independently, so malformed mode metadata is omitted without discarding a valid base workflow. Hub does not interpret Rules' private focus execution state. The mode is runtime-only: the controller exposes it only from a fresh, non-shutdown heartbeat with confirmed tmux presence and never writes it to `registry.json`. Stale, missing, shutdown, or stopped sessions retain the base workflow snapshot but lose the transient mode decoration.

The snapshot drives the per-session rail and canonical lanes in the read-only `v` board. Modes change the active step's display only; pipeline identity and lane placement continue to use the ordered base step ids. When visible Active parents report different ordered-id pipelines, Hub deterministically selects the most prevalent pipeline, treats label/short-only versions as compatible, and uses the newest compatible vocabulary. Incompatible and workflowless Active parent trees render once in synthetic `OTHER ACTIVE`; Backlog/Archived remain footer-only. Heartbeats fire on agent start/end, after all `agent_end` handlers settle, and every 15 seconds. Final context is immediate; other producer changes still have the periodic fallback.

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
    "prelude": "eval \"$(ssh-agent -s)\" >/dev/null",
    "worktreeDefault": true
  },
  "dashboard": {
    "themeSync": true,
    "shortcuts": [
      {
        "key": "C-n",
        "label": "refresh name",
        "send": "/session-name refresh"
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
pi-hub config set worktree-default true
pi-hub config unset worktree-default
```

## Dashboard shortcuts

`dashboard.shortcuts` binds extra normal-mode dashboard keys to one-line text sent to the selected live session through the same tmux paste/Enter path as `p`. Shortcuts are ignored in filters, forms, pickers, help, and other edit modes. Valid shortcuts also appear in the `:` intent palette for the selected live parent session. They cannot target stopped, error, or subagent rows.

```json
{
  "version": 1,
  "dashboard": {
    "shortcuts": [
      {
        "key": "C-n",
        "label": "refresh name",
        "send": "/session-name refresh"
      }
    ]
  }
}
```

Supported key spelling includes plain single characters, `C-x`/`ctrl+x`, and `M-x`/`alt+x`. Built-in dashboard keys and tmux return/focus keys are reserved, including the intent palette `:`, theme settings `t`, the panel-close prefix `x`, sidebar return `M-q`, and `M-1` through `M-4`; conflicting entries are rejected rather than shadowing Hub behavior. Shifted digit characters such as `!` are available for custom shortcuts. `send` must be a single nonblank line; this is not a shell-command or macro facility.

Legacy `syncPiNameAfterMs` values remain readable but schedule no delayed copy. Native Pi name changes trigger an immediate heartbeat. `/session-name refresh` is producer-provided and can be configured as an ordinary one-line text send.

## New-session worktree default

New-session forms open with worktree mode on. Set `session.worktreeDefault` to `false` to start every new form in normal-session mode instead. In the form, focus the Worktree row and press `Space`, or use `Ctrl+T` from any field, to toggle it for an individual session. Omitting or unsetting the option restores the worktree default.

```bash
pi-hub config set worktree-default false
pi-hub config unset worktree-default
```

## Session prelude

`session.prelude` is an optional shell snippet that runs before `pi` starts in every new, restarted, or forked managed session. It is useful for machine-local setup such as starting an SSH agent, unlocking an OS credential store, or loading `direnv`; do not store raw secrets in it.

Configure it without editing JSON manually:

```bash
pi-hub config set session-prelude 'eval "$(ssh-agent -s)" >/dev/null'
pi-hub config unset session-prelude
```

On macOS, a machine-local keychain prelude can be configured the same way when needed.

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

Press `t` to open dashboard theme settings. The list contains Pi's `dark` and `light` themes plus custom/package themes from global Pi resources. Project-local themes are deliberately excluded because a synchronized choice becomes Pi's global default. Pi 0.83 or newer is required for the matching Automatic light/dark setting.

Moving through fixed themes previews the dashboard immediately. Selecting Automatic exposes separate light and dark choices; `←`/`→` changes the focused choice. `Space` toggles **Sync to Pi**, `Enter` saves, and `Escape` restores the theme active when the dialog opened. Preview updates dashboard ANSI, dashboard status chrome, and sidebar pane borders only—it does not write settings or alter managed Pi sessions.

Synchronization defaults on when `dashboard.themeSync` is absent or `true`. Pi's global `theme` in `<PI_CODING_AGENT_DIR>/settings.json` is then the source of truth; Hub does not mirror it. Confirming saves through Pi's settings manager, clears any detached Hub override, and asks every currently live managed parent session to apply the resolved concrete theme once. New managed and unmanaged Pi processes inherit the saved global setting normally. Existing subagent processes are not targets, and a running session may change its own theme afterward because Hub does not continuously enforce the choice.

Set `dashboard.themeSync` to `false` by toggling Sync off in the dialog. Hub snapshots the visible Pi theme setting into `dashboard.theme` and thereafter uses that independent override without writing Pi settings or changing Pi sessions. Re-enabling sync pushes the visible Hub setting to Pi globally. The old `dashboard.themeSessionId` anchor is obsolete and is removed the next time theme preferences are saved.

Pi represents Automatic as `<light-theme>/<dark-theme>`. Hub resolves the pair once when the dashboard starts using `COLORFGBG` when available and a dark fallback otherwise; it stays visually stable for that dashboard run instead of following later terminal appearance changes. Existing live processes receive the currently resolved concrete theme once, while new/restarted Pi processes retain Pi's normal Automatic behavior from the saved pair.

The dashboard periodically checks the lightweight effective setting and selected source file, but does not rerun package resolution every second. Reopen/reload the dashboard after installing or removing global theme packages. Missing or invalid selected themes render with Hub's bounded dark theme fallback without rewriting the saved setting.

Managed sessions continue publishing their actual `ctx.ui.theme` snapshot through heartbeats for their own tmux footer and chrome. Session entry, panel assignment, selection movement, and heartbeat freshness never choose or recolor the dashboard theme. The dashboard uses `selectedBg` for selected rows, `accent` for focused panel borders/title badges/slot cues, and `border` or `dim` for inactive panel chrome.
