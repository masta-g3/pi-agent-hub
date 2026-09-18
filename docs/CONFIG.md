# pi-agent-hub Configuration

This page covers optional integrations, runtime state, global config, themes, skills, and MCP. For dashboard usage, see [Features](FEATURES.md).

## Optional integrations

Hub manages sessions without Rules or subagent tooling. Install these only for the extra workflow and child-agent features.

### Rules workflow

[Rules](https://github.com/masta-g3/rules) supplies workflow skills and the `workflow-runtime` Pi extension. It reports linked tickets, explicit requests, workflow position, and plan progress. Hub displays those facts in the session list, action workspace, and `S` board. Rules owns workflow execution; Hub does not advance steps.

Rules currently deploys through a repository sync script, not a Hub plugin installer. Before running it, review its [setup instructions](https://github.com/masta-g3/rules#setup) and back up your agent configuration. The script copies global instructions, skills, agents, and extensions into Claude, Cursor, and Pi directories; prunes managed assets, including Codex workflow assets; and updates Pi settings. It targets `~/.pi/agent`, not a custom `PI_CODING_AGENT_DIR`.

The sync script requires Bash 4.3+, `rsync`, and `jq`. The workflow's backlog helpers require [uv](https://docs.astral.sh/uv/). On macOS, the bundled Bash 3.2 is too old; use a newer Bash on `PATH`.

```bash
git clone https://github.com/masta-g3/rules.git
cd rules
bash ./sync-prompts.sh
```

Start a new Pi session, or run `/reload` in an existing one. In a Hub-managed session, try `/skill:plan-md` with a task. Once the workflow starts, return with `Ctrl+Q` and press `S` to see its lane. For tracked work, initialize the project with `/skill:project-init`, then use the ticket workflow described in Rules.

Ticket and plan display uses project files. Rules' optional automatic naming and turn-end attention also use model calls and need working provider access. `/session-metadata-status` reports their state; `/session-metadata-disable` turns those optional calls off. Installing Rules alone does not make every waiting session an explicit request.

### Tmux subagents

[pi-tmux-subagents](https://github.com/masta-g3/pi-tmux-subagents) runs child Pi agents in tmux and reports their parent relationship to Hub.

```bash
pi install npm:pi-tmux-subagents
```

Reload or restart the parent Pi session after installation. When a managed parent launches a child, expand its Hub row with `→`. Children keep their own status and task text. Running children keep their loaded code until relaunched.

Rules' sync also adds this package to Pi settings. You do not need a second installation for the same setup.

### Inline questions

Conversation can display completed messages without an extra question package. Answering questionnaires inside Hub requires a producer that supports its external-answer protocol. Rules' attention metadata alone does not provide this.

The verified integration is the `2.10.1-hub.1` fork of `@juicesharp/rpiv-ask-user-question`. It retains the original package name. Do not assume the ordinary npm release supports this protocol or load both copies together.

Download the [verified tarball](https://github.com/masta-g3/pi-agent-hub/raw/afa0fa7549b8e1b2804b0308f6ed8f3187f46fa8/agent-work/tickets/cockpit-013/juicesharp-rpiv-ask-user-question-2.10.1-hub.1.tgz). Its SHA-256 is `e91e010cf2f12c609c1ea1689a89616fbc126006f2ec50a5d129b4546ec6744c`. Review the included `package/docs/hosts.md` before installation. Extensions run with your user's permissions.

Install the verified archive into a new versioned directory, not over a running package:

```bash
shasum -a 256 /path/to/juicesharp-rpiv-ask-user-question-2.10.1-hub.1.tgz
# Continue only if the checksum matches above.
PATCH_HOME="$HOME/.local/share/pi-hub-questions/2.10.1-hub.1"
mkdir -p "$PATCH_HOME"
cp /path/to/juicesharp-rpiv-ask-user-question-2.10.1-hub.1.tgz "$PATCH_HOME/"
cd "$PATCH_HOME"
npm install --save-exact ./juicesharp-rpiv-ask-user-question-2.10.1-hub.1.tgz
```

Close running Pi sessions and back up Pi settings. Use `pi list` to find the existing questionnaire source. If present, remove it with `pi remove <original-source>` and remove any explicit extension path that also loads it. Then register the replacement directory:

```bash
pi install "$PATCH_HOME/node_modules/@juicesharp/rpiv-ask-user-question"
```

Do not pass the `.tgz` directly to `pi install`; Pi treats local files as extension source. Restart Pi and verify that exactly one `ask_user_question` tool is available. Keep `package.json`, `package-lock.json`, and the archive together. To reproduce this dependency set in a new directory or on another machine, copy all three there and run `npm ci` before registering that package directory with Pi. This local installation does not follow upstream updates. To roll back, close Pi, remove the replacement source, and restore the original source from your saved settings.

Without this integration, use **Open in Pi** to answer. See [Conversation](FEATURES.md#conversation) for dashboard controls.

### Your own integrations

Use Pi extensions to publish the [session context](#generic-session-context) and [workflow metadata](#workflow-heartbeat-bridge) below. Hub reads these supported entries through its heartbeat extension. There is no separate Hub plugin loader or custom-widget API.

For keyboard actions, configure [dashboard shortcuts](#dashboard-shortcuts) that send a one-line Pi command. Skills and MCP remain project-scoped capabilities, not dashboard plugins.

## Runtime state

- Global state: `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub` or `~/.pi/agent/pi-agent-hub`
- Config: `config.json` (`skills.poolDirs`, `mcp.catalogPath`, optional managed-session `session.prelude`, `session.worktreeDefault`, dashboard theme sync/override, dashboard shortcuts, optional attention bell)
- Registry: `registry.json`
- Heartbeats: `heartbeats/<session-id>.json`
- Latest one-time managed-session theme request: `theme-command.json`
- Multi-repo workspaces: `workspaces/<session-id>`
- Hub-owned Git worktrees: `worktrees/<repo-name>/<session-id-prefix>-<branch-slug>`
- Recent repo history: `repo-history.json`
- Named new-session directory favorites: `session-favorites.json`
- Dashboard tmux session: `pi-agent-hub`
- Managed Pi tmux sessions: `pi-agent-hub-<first-12-session-id-chars>`
- Materialized project skills: `<project>/.pi/skills`
- Project skill state: `<project>/.pi/sessions/skills.json`
- Project MCP state: `<project>/.pi/sessions/mcp.json`
- MCP catalog: `<global-state>/mcp.json` by default, configurable in `config.json`
- MCP pool socket: `<global-state>/pool/pool.sock`
- Temporary tmux return binding state: `return-key/active.json` and `return-key/previous.tmux`

### Generic session context

A Pi extension can append a custom entry with `customType: "pi-agent-hub-context"`. Each entry is a complete snapshot. Version 1 requires `version: 1` and a finite `updatedAt` timestamp. Ticket and attention are optional:

```json
{
  "type": "custom",
  "customType": "pi-agent-hub-context",
  "data": {
    "version": 1,
    "updatedAt": 1765060000000,
    "ticket": {
      "id": "auth-001",
      "subtitle": "Validate email before account creation"
    },
    "attention": {
      "kind": "question",
      "text": "Which sign-in provider should we use?",
      "requestId": "auth-001-provider-choice"
    }
  }
}
```

Ticket IDs allow up to 80 characters, subtitles 64, and descriptions 240. Attention requires `kind` of `ready`, `question`, or `blocked` and nonblank `text` of up to 150 characters. Publish a fresh snapshot without `attention` to clear a request.

Attention can include an optional nonblank `requestId` of at most 64 characters. The producer owns this identity: attention remains visible without it, but only an unseen session/request ID pair is eligible for transient delivery. Unknown fields are ignored. Hub copies the latest valid snapshot into its heartbeat. It does not read producer files or persist context in `registry.json`.

Pi's native session name is the canonical title and is sent separately as `heartbeat.piSessionName`; Hub caches each nonblank heartbeat name. See [Session names](FEATURES.md#session-names) for initial names and ticket ownership. `R` renames an unlinked live session without submitting its editor contents. `N` reads the saved Pi name from `session_info`; it does not generate a new name.

If generic context and workflow runtime contain different ticket ids, Hub keeps the workflow ticket id and suppresses context subtitle/description. Attention stays independent and appears only on waiting/idle rows.

### Workflow heartbeat bridge

Hub's extension can also display workflow state from a compatible producer, such as Rules' `workflow-runtime` extension. On every heartbeat tick it reads the Pi session branch via `sessionManager.getBranch()` and takes the latest custom entry of this shape:

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

The producer owns step order, ids, short codes, and optional labels. `activeStep`, finite `updatedAt`, and a nonempty `steps` array are required; each step needs a unique nonblank `id` and nonblank `short`, while `label` and `ticketId` are optional. `updatedAt` is the producer's state-change timestamp, so it can advance during one workflow step—for example, when a focus turn completes—independently of heartbeat cadence. Missing or malformed base workflow metadata silently removes the rail and canonical lane placement without affecting process state; an Active session still appears in `OTHER ACTIVE`. A producer must publish `steps` and `updatedAt` for workflow lanes. Hub has no built-in step list.

`activity` and `plan` are independent optional producer projections. A valid activity (`id`, `label`, optional positive `pass`) takes precedence on the card recap. Without activity, Hub shows bounded deterministic phase/task progress and `nextStep`; it does not inspect step ids to choose either path. Task counts are nonnegative integers up to 10,000. A plan can publish at most 100 phase counts, and their aggregate total must also stay at or below 10,000; Hub omits an invalid phase projection while retaining other valid plan fields. Malformed optional projections are omitted without hiding a valid base rail.

Optional `currentStepComplete: true` marks the current workflow position complete. Earlier positions also show checks; later ones stay pending. These markers show position, not proof that each step ran. Completion does not change runtime status or move the session to another lane.

`activeMode` is an optional producer-owned display modifier. It requires nonblank bounded `id` and `short`; `label` and `detail` are optional and bounded. Mode and workflow are validated independently. A valid mode can appear without a rail, and malformed mode does not discard a valid workflow. Hub does not interpret Rules' private focus execution state. The mode is runtime-only: the controller exposes it only from a fresh, non-shutdown heartbeat with confirmed tmux presence and never writes it to `registry.json`. Stale, missing, shutdown, or stopped sessions retain the base workflow snapshot but lose the transient mode decoration.

Compaction is separate from mode and workflow state. Its bounded heartbeat `operation` has `kind: "compact"`, an `id`, and a `phase` of `running`, `complete`, `error`, or `cancelled`, with an optional bounded `error`. Successful completion clears after five seconds. Error and cancellation evidence remains until new work or compaction. The dashboard exposes operation evidence only with fresh, non-shutdown liveness and confirmed tmux presence. Generic operations never enter the registry. Fork readiness instead uses durable `forkPreparation` control, described in [Structure](STRUCTURE.md).

The snapshot drives the per-session rail and canonical lanes in the read-only `S` workflow board. Modes change the active step's display only; pipeline identity and lane placement continue to use the ordered base step ids. When visible Active parents report different ordered-id pipelines, Hub deterministically selects the most prevalent pipeline, treats label/short-only versions as compatible, and uses the newest compatible vocabulary. Incompatible and workflowless Active parent trees render once in synthetic `OTHER ACTIVE`; Backlog/Archived remain footer-only. Heartbeats fire on agent start/end, after all `agent_end` handlers settle, and every 15 seconds. Final context is immediate; other producer changes still have the periodic fallback.

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
    "worktreeDefault": false
  },
  "dashboard": {
    "themeSync": true,
    "attentionBell": false,
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

### Attention bell

`dashboard.attentionBell` enables a best-effort BEL when a fresh request is delivered externally. It defaults to `false`. Use the unbound **Attention bell: On/Off** action in the `:` palette to persist the setting. BEL remains silent when any attached client is already showing Hub or a request in the fresh batch. Text delivery to other eligible clients still proceeds.

### Dashboard view state

`ui-state.json` stores presentation preferences. `grouping` selects the fleet (`project`) or workflow board (`stage`); optional `fleetGrouping` selects `status` or `repo`, with `status` used when absent. `S` retains that fleet choice across board visits. The dashboard filter is saved as JSON-safe data with `text` and an ordered `lifecycle` array. Lifecycle values are `active`, `backlog`, and `archived`; the selected values match with OR semantics. For example, `lifecycle:archived,backlog release` shows matching Archived or Backlog rows narrowed by `release`. The file also stores independent collapse flags for HEALTH, ACTIVE, QUIET, and ARCHIVED. NEEDS YOU is always expanded. Repo-section folds and individual subagent disclosure last only for the current dashboard process. Filtered reveals, navigator state and card richness are not persisted. Legacy string filters are normalized when loaded; unknown values are ignored.

The lowercase `b` dashboard command toggles Backlog in the saved lifecycle selection. It changes visibility only. Uppercase `B` remains the lifecycle action that moves the selected session to Backlog.

## Dashboard shortcuts

`dashboard.shortcuts` binds extra normal-mode dashboard keys to one-line Pi input for the selected live session. Commands use Pi's input/template pipeline and require an idle session with no queued messages, blocking prompt, or editor draft. There is no tmux-paste fallback; `p` remains a separate send path. Shortcuts are ignored in filters, forms, pickers, help, and other edit modes. Valid shortcuts also appear in the `:` intent palette for the selected live parent session. They cannot target stopped, error, or subagent rows.

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

Supported key spelling includes plain single characters, `C-x`/`ctrl+x`, and `M-x`/`alt+x`. Built-in dashboard and tmux focus/return keys are reserved, including `1`–`4` exact slot assignment, `M-1`–`M-4` (`Alt+1`–`Alt+4`) slot focus, `P` next-free/focus, `x` selected-pin close, `+`/`-` resize, `M-q` (`Alt+Q`, reserved for Pi message editing), `C-q` return, the intent palette `:`, theme settings `t`, and fleet grouping `v`; conflicting entries are rejected rather than shadowing Hub behavior. `Ctrl+N` is intentionally configurable in normal dashboard mode, but forms and the command palette keep precedence for their own cycling/navigation behavior. `F` and `o` are available for explicit configured sends. Move any configured `v` send to a free key before starting the dashboard; `v` is reserved for fleet grouping. Shifted digit characters such as `!` are also available. `send` must be one nonblank line; this is not a shell-command or macro facility.

Legacy `syncPiNameAfterMs` values remain readable but schedule no delayed copy. Native Pi name changes trigger an immediate heartbeat. `/session-name refresh` is producer-provided and can be configured as an ordinary one-line text send.

## New-session worktree default

New-session forms open with worktree mode off. Set `session.worktreeDefault` to `true` to start every new form in worktree mode instead. In the form, focus the Worktree row and press `Space`, or use `Ctrl+T` from any field, to toggle it for an individual session. Omitting or unsetting the option restores the normal-session default.

```bash
pi-hub config set worktree-default true
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

Moving through fixed themes previews the dashboard immediately. Selecting Automatic exposes separate light and dark choices; `←`/`→` changes the focused choice. Those choices remain intact when browsing fixed themes and returning to Automatic within the same dialog. `Space` toggles **Sync to Pi**, `Enter` saves, and `Escape` restores the theme active when the dialog opened. Preview updates dashboard ANSI, dashboard status chrome, and sidebar pane borders only. It does not write settings or alter managed Pi sessions.

Synchronization defaults on when `dashboard.themeSync` is absent or `true`. Pi's global `theme` in `<PI_CODING_AGENT_DIR>/settings.json` is then the source of truth; Hub does not mirror it. Confirming saves through Pi's settings manager, clears any detached Hub override, and asks every currently live managed parent session to apply the resolved concrete theme once. New managed and unmanaged Pi processes inherit the saved global setting normally. Existing subagent processes are not targets, and a running session may change its own theme afterward because Hub does not continuously enforce the choice.

Set `dashboard.themeSync` to `false` by toggling Sync off in the dialog. Hub snapshots the visible Pi theme setting into `dashboard.theme` and thereafter uses that independent override without writing Pi settings or changing Pi sessions. Re-enabling sync pushes the visible Hub setting to Pi globally. The old `dashboard.themeSessionId` anchor is obsolete and is removed the next time theme preferences are saved.

Pi represents Automatic as `<light-theme>/<dark-theme>`. On macOS, Hub follows system light/dark appearance and rechecks it through the dashboard's theme refresh loop. On other platforms, Hub uses its process's `COLORFGBG` value, or dark when no usable value is available. Appearance changes recolor the dashboard without rewriting the saved pair or sending another theme command to Pi sessions. Saving with sync enabled sends the currently resolved theme once to live managed parent sessions; new or restarted Pi processes use Pi's normal Automatic behavior from the saved pair.

The dashboard periodically checks the lightweight effective setting and selected source file, but does not rerun package resolution every second. Reopen/reload the dashboard after installing or removing global theme packages. Missing or invalid selected themes render with Hub's bounded dark theme fallback without rewriting the saved setting.

Managed sessions continue publishing their actual `ctx.ui.theme` snapshot through heartbeats for their own tmux footer and chrome. Session entry, panel assignment, selection movement, and heartbeat freshness never choose or recolor the dashboard theme. The dashboard uses `selectedBg` for selected rows, `accent` for focused panel borders/title badges/slot cues, and `border` or `dim` for inactive panel chrome.
