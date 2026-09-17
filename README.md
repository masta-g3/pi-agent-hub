# pi-agent-hub

Pi-native tmux hub for long-running coding-agent sessions, skills, and MCP.

Use `pi-hub` to see what needs you, keep live sessions side by side, and jump between agents from one terminal dashboard.

New here? See [Features](docs/FEATURES.md) for the daily workflow and full key map.

![pi-agent-hub dashboard](assets/pi-agent-hub-dashboard.png)

*Current dashboard renderer with example sessions. Ticket, request, and workflow context comes from optional Pi extensions.*

## Why pi-agent-hub?

Pi runs the agents. tmux keeps them alive. Hub gives you one keyboard-driven dashboard without replacing either.

| Feature | Why it matters |
| --- | --- |
| Attention-first dashboard | Find explicit requests, runtime errors, active work, and quiet sessions in separate sections. |
| Repository view | Group sessions by their source repo, including worktrees and multi-repo sessions. |
| Pinned live sessions | Keep up to four Pi sessions beside the dashboard and focus them by number. |
| Actions and search | Find sessions, send a message, or run an action without leaving the dashboard. |
| Conversation | Read completed messages below the fleet and answer supported questions inline. |
| Optional workflow board | See workflow position, task progress, and nested subagents from compatible Pi extensions. |
| Project skills and MCP | Choose capabilities for the selected session's primary repo. |
| Multi-repo workspaces | Give one session access to several repos without moving the source folders. |
| Hub-owned worktrees | Create isolated branch sessions and explicitly finish, forget, or discard them. |
| Local and recoverable | No cloud service, custom agent runtime, or hidden repo scanning. Sessions remain normal tmux sessions. |

## Quick start

Requirements: Pi 0.85.1+, Node.js 22.19+, and tmux 3.1+.

```bash
npm install -g pi-agent-hub
pi-hub doctor
pi-hub
```

Press `n` to create a session, `Enter` to open it, and `Ctrl+Q` to return. Agents keep running while you use the dashboard.

| Key | Action |
| --- | --- |
| `n` | Create a Pi session |
| `Enter` | Open/switch to the selected session, or restart it if stopped |
| `Ctrl+Q` | Return from a managed session or live pin |
| `1`–`4` / `P` | Pin into an exact free slot / the first free slot |
| `Alt+1`–`Alt+4` | Focus an occupied pin |
| `x` | Close the selected session's pin without stopping Pi |
| `/` / `:` | Filter sessions / search actions, sessions, and filters |
| `p` | Send a one-line message to the selected live session |
| `c` | Show or hide the selected live session's Conversation panel |
| `i` | Show task context, actions, and live status details |
| `v` / `S` | Switch Status/Repo view / visit the workflow board |
| `←` / `→` | Collapse / expand a subagent tree; add Shift for all trees |
| `r` / `R` | Restart choices / rename |
| `f` / `Shift+F` | Fork / fork and compact |
| `g` / `G` | Move a session to a group / rename its group |
| `A` / `B` / `U` | Archive / move to Backlog / restore |
| `s` / `m` | Pick project skills / MCP servers |
| `t` | Choose a theme |
| `?` / `q` | Help / quit the dashboard |

See [Dashboard keys](docs/FEATURES.md#dashboard-keys) for all controls.

The default Status view puts explicit requests in `NEEDS YOU`, runtime errors in `HEALTH`, running work in `ACTIVE`, and other sessions in `QUIET`. `ARCHIVED` is newest-first. Waiting alone does not mean an agent needs an answer. Explicit requests require an extension that reports them.

Each parent session shows its `[group]` after the title. Press `v` to browse by repository instead. Worktrees stay with their source repo; multi-repo sessions appear under their primary repo. Groups and Backlog/Archive organize sessions without stopping their agents.

The selected-session workspace shows task context and available actions. It stays beside the list in wide terminals; `i` opens it full-width in smaller terminals and toggles live details. `Enter` and double-click open the selected session directly at every width. Hub does not read or display raw pane output or conversation text in this workspace.

Press `c` to read completed messages below the fleet. Compatible question extensions also let you answer inline; otherwise, use **Open in Pi**. Conversation does not store a second transcript or search message content. See [Conversation](docs/FEATURES.md#conversation) for controls and [question integration](docs/CONFIG.md#inline-questions) for setup.

Use `P` to pin a live session beside the dashboard. Terminals 100–159 columns wide support two slots; wider terminals support four. An occupied slot is never replaced. `Alt+1`–`Alt+4` focuses a pin, `Ctrl+Q` returns, and `+` / `-` adjusts the split. `Alt+Q` stays available to Pi for editing the last message.

Press `:` to find an action or session. Selecting a session result reveals it without opening or marking it read. Fresh explicit requests also produce a short notification; select **Locate newest request** to find one, or **Attention bell** to enable the optional sound.

New sessions start as `New · repository`; forks start as `Fork · source name`. You can rename an unlinked session with `R` or use `Alt+R` from inside it. With Rules installed, a linked ticket supplies the session name. See [Session names](docs/FEATURES.md#session-names).

### Optional Pi integrations

Hub works on its own. Pi extensions can add task context, explicit requests, workflow progress, and subagent rows.

- [Rules](https://github.com/masta-g3/rules) supplies skills and a workflow runtime for Plan → Execute → Review → Reflect → Commit. Hub displays its ticket context, requests, and progress. Press `S` for the read-only workflow board.
- [pi-tmux-subagents](https://github.com/masta-g3/pi-tmux-subagents) runs child agents in tmux. Hub shows them under their parent session.
- Your own Pi extensions can publish the supported context and workflow metadata. Configured dashboard shortcuts can send Pi commands to the selected session.

These integrations use Pi's extension system, not a separate Hub plugin loader. Hub displays workflow state; it does not run or advance the workflow. See [Optional integrations](docs/CONFIG.md#optional-integrations) for setup, prerequisites, and the metadata contracts.

## Install

The npm package is `pi-agent-hub`. It exposes `pi-hub` for daily use and `pi-agent-hub` as an alias.

```bash
npm install -g pi-agent-hub
```

If you also install or update through Pi with `pi install npm:pi-agent-hub`, Pi keeps a separate package copy under `~/.pi/agent/npm/node_modules/pi-agent-hub`. An older global npm command earlier on `PATH` can still launch the stale dashboard. Run `pi-hub doctor` after installing or updating and check any `cli package` warning.

POSIX shell fix:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/npm/node_modules/.bin/pi-hub ~/.local/bin/pi-hub
# Put ~/.local/bin before the global npm bin in PATH.
```

On Windows PowerShell, the Pi package bin directory is:

```powershell
$PiBin = "$env:USERPROFILE\.pi\agent\npm\node_modules\.bin"
# Put $PiBin before the global npm prefix in your user PATH.
# Or run: & "$PiBin\pi-hub.cmd" doctor
```

Hub still requires tmux and a compatible shell environment. For local development, see [Development](docs/DEVELOPMENT.md).

## Common commands

```bash
pi-hub              # create, attach, or switch to the dashboard
pi-hub tui          # run directly in the current terminal
pi-hub doctor
pi-hub list
pi-hub explain <session-id-or-unique-prefix>
pi-hub add . -g default
pi-hub add ./api --add-cwd ../web --add-cwd ../shared
pi-hub delete <session-id>
pi-hub mcp-pool      # run the pooled MCP socket daemon
pi-hub config get
pi-hub config set session-prelude '<shell snippet>'
pi-hub config unset session-prelude
pi-hub config set worktree-default true
pi-hub config unset worktree-default
```

`explain` reports the live evidence behind a session's runtime status and dashboard placement without changing registry state.

`add --add-cwd` creates a symlink workspace for multiple repos. Skills and MCP stay attached to the primary repo.

For an isolated branch, enable Worktree with `Ctrl+T` in the new-session form and enter a branch name. Press `w` to finish a clean worktree session, merge its branch into the recorded base branch, and remove its worktrees. Use `d`, then `Shift+D`, to discard clean worktrees and branches without merging. Both require clean worktrees; finish also requires clean base repos.

Normal `delete` stops the session and removes Hub records and its symlink workspace. It keeps Pi conversation files, source repos, and hub-owned worktree directories. Archive and Backlog do not stop Pi; archiving also closes the session's pin. See [Worktree model](docs/FEATURES.md#worktree-model) for the full safety rules.

## Troubleshooting

Hub enables tmux mouse mode for the dashboard session while it runs, then restores your global preference on quit. For SSH use, mouse handling comes from the remote tmux server.

For better modified-key handling, enable extended keys globally if your tmux version supports it:

```tmux
set -g extended-keys on
```

Use `Alt+1`–`Alt+4` to focus pins. `Alt+Arrow` is an optional spatial alias, but terminals can consume these keys for word movement. Numeric focus or tmux prefix plus arrows avoids that conflict.

## Documentation

- [Features](docs/FEATURES.md): daily workflow, keys, session organization, pins, and worktrees.
- [Configuration](docs/CONFIG.md): optional integrations, global config, themes, skills, MCP, and state paths.
- [Development](docs/DEVELOPMENT.md): local setup, tests, package checks, and release workflow.
- [Structure](docs/STRUCTURE.md): project layout and architecture for contributors.
- [Changelog](CHANGELOG.md): release changes.

## Acknowledgements

Thanks to [Ashesh Goplani](https://github.com/asheshgoplani) for [Agent Deck](https://github.com/asheshgoplani/agent-deck). This project ports its core session-dashboard idea into a smaller Pi-native extension. It is not affiliated with Agent Deck. See `LICENSE` for the Agent Deck MIT notice.
