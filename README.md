# pi-agent-hub

Pi-native tmux hub for long-running coding-agent sessions, skills, and MCP.

Use `pi-hub` to keep multiple Pi sessions visible, grouped, restartable, and easy to jump between from one terminal dashboard.

New here? See [Features](docs/FEATURES.md) for the dashboard workflow and core capabilities.

![pi-agent-hub dashboard](assets/pi-agent-hub-dashboard.png)

## Why pi-agent-hub?

Most agent managers try to become the runtime. `pi-agent-hub` stays small: Pi runs the agents, tmux keeps them alive, and the hub gives you one keyboard-driven dashboard to manage them.

| Feature | Why it matters |
| --- | --- |
| Pi-native | Uses Pi sessions, extensions, skills, MCP, and project state directly. |
| tmux-native | Sessions keep running as normal tmux sessions; you can attach, switch, or recover manually. |
| One stable dashboard | `pi-hub` always brings you back to the same control center. |
| Return shortcuts | `Ctrl+Q` jumps from a managed session back to the dashboard; `Alt+R` opens rename from inside a session. |
| Project-scoped skills/MCP | Pick skills and MCP servers for the selected session's primary repo. |
| Multi-repo workspaces | Extra repos are symlinked into a runtime workspace; source repos are not moved or owned. |
| Hub-owned worktrees | Create isolated branch sessions for one or more repos; finish, forget, or discard them explicitly from the dashboard. |
| Small surface area | No cloud service, no custom agent runtime, no hidden repo scanning. |

## Quick start

Requirements: Pi 0.83+, Node.js 22.19+, and tmux 3.1+.

```bash
npm install -g pi-agent-hub
pi-hub doctor
pi-hub
```

Common dashboard keys (see [Features](docs/FEATURES.md#dashboard-keys) for the full map):

| Key | Action |
| --- | --- |
| `n` | Create a new Pi session |
| `Enter` | Open/switch to the selected live session, or restart a stopped/error session |
| `1`–`4` | Assign, replace, move, swap, or focus a fixed quadrant panel |
| `x`, then `1`–`4` | Close the corresponding panel |
| `F`, then `1`–`4`, or `Alt+1`–`Alt+4` | Focus the corresponding open panel |
| `Alt+Q` / `Ctrl+Q` | Return from a panel to the sidebar |
| `o` | Reset side panels to the selected session, or close it when it is the only panel |
| `/` | Filter sessions |
| `p` | Send a one-line message to the selected live session without opening it |
| `?` | Show help and status legend |
| `i` | Toggle compact/full selected-session info |
| `v` | Toggle compact rows ↔ all-session junction cards |
| `S` | Toggle the project cockpit ↔ workflow-stage lanes |
| `q` | Quit the dashboard |
| `r` | Open restart choices (`r` selected, `n` new conversation, `a` all active sessions) |
| `R` | Rename the selected session |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session |
| `a` | Mark the selected waiting session read |
| `A` / `B` / `U` | Archive, move to Backlog, or restore the selected session |
| `w` | Finish a hub-owned worktree session |
| `N` | Sync the selected hub title from Pi's `/name` |
| `↑↓` / `j` / `k` | Move selection |
| `←` / `→` | Collapse or expand the selected subagent tree; add Shift for all trees |
| `g` / `G` | Move a session to a group (Ctrl+N/P cycles visible groups) or rename its group |
| `K` / `J` | Move the selected Active/Backlog session up/down within its group |
| `s` / `m` | Pick project skills or MCP servers; `←→` switches Enabled/Available |
| Click / double-click | Select / open, switch, or restart from any visible card line |

The default project cockpit shows complete session trees in attention order: `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, then chronological `ARCHIVED`. Only explicit producer attention on a waiting/idle owner enters `NEEDS YOU`; waiting alone does not. A running child can activate its owner tree, but child attention/error never promotes the parent. Runtime status, workflow position, lifecycle, attention, and child activity remain independent. Groups and Backlog appear as row metadata, while Archived remains the only collapsible project section.

`v` toggles compact rows and junction-rail cards. `S` switches to workflow-stage lanes, where compatible Active workflow trees stay in producer-defined lanes and all others appear in `OTHER ACTIVE`, nested under their existing group labels. Top-level parents show `⚙︎N` for starting/running descendants. Subagent trees start collapsed in both views: `←`/`→` changes the selected tree, Shift applies to all trees, and `Space` remains a board selected-tree toggle. Filters reveal matching child context without changing tier or disclosure state. The right pane keeps full available plan context.

## Install

The npm package is `pi-agent-hub`; it exposes both commands, with `pi-hub` as the shorter daily-use command and `pi-agent-hub` kept for compatibility. Most users install the CLI with npm:

```bash
npm install -g pi-agent-hub
```

If you also install or update the package through Pi (`pi install npm:pi-agent-hub`), Pi updates its package copy under `~/.pi/agent/npm/node_modules/pi-agent-hub`. If an older global npm `pi-hub` appears earlier on `PATH`, your shell can still run the stale dashboard. Run `pi-hub doctor` after install/update and follow any `cli package` warning.

POSIX shell fix:

```bash
mkdir -p ~/.local/bin
ln -sf ~/.pi/agent/npm/node_modules/.bin/pi-hub ~/.local/bin/pi-hub
# ensure ~/.local/bin appears before the global npm bin in PATH
```

Windows PowerShell fix:

```powershell
$PiBin = "$env:USERPROFILE\.pi\agent\npm\node_modules\.bin"
# Add $PiBin before the global npm prefix in your user PATH, then reopen the terminal.
# Or run: & "$PiBin\pi-hub.cmd" doctor
```

For local development, see [Development](docs/DEVELOPMENT.md).

## Common commands

```bash
pi-hub              # create/attach/switch to the dashboard tmux session
pi-hub tui          # run the TUI directly in the current terminal
pi-hub doctor
pi-hub list
pi-hub add . -g default
pi-hub add ./api --add-cwd ../web --add-cwd ../shared
pi-hub delete <session-id>
pi-hub mcp-pool     # run the pooled MCP socket daemon
pi-hub config get
pi-hub config set session-prelude '<shell snippet>'
pi-hub config unset session-prelude
pi-hub config set worktree-default true
pi-hub config unset worktree-default
```

`add --add-cwd` creates a multi-repo session: `cwd` stays the primary repo, extra paths are symlinked into a per-session workspace, and Pi starts from that workspace. Worktree sessions are created from the TUI new-session form by focusing the Worktree row and pressing `Space`, or with `Ctrl+T`; the branch does not control Pi's native session name. New forms start with worktrees on. Set `worktree-default false` to open them in normal-session mode instead; either toggle can still change the mode per session. `delete` stops the tmux session if it is still alive, removes the registry row, removes the heartbeat file, and removes any owned multi-repo workspace. Dashboard archive/backlog/restore only reorganizes rows and never stops tmux or Pi. Archived is a flat newest-first list that shows five parent cascades by default; select the older-items row and press `Enter` or double-click to expand it. Archived cascades become eligible for dashboard cleanup after seven days, but are forgotten only when every tmux session in the cascade is confirmed gone. Pi conversation/session files, source repos, and hub-owned worktree directories are kept by normal delete; use dashboard `w` to merge and remove a clean hub-owned worktree, or `d` then `Shift+D` to discard a clean worktree and branch without merging.

## Troubleshooting

For SSH/tmux use, mouse behavior comes from the remote tmux server. Hub enables tmux mouse mode only on the dashboard session while `pi-hub` is running, then unsets that session override on quit so your global tmux preference applies again. It does not force global tmux mouse settings.

For better modified-key handling, enable extended keys globally if your tmux version supports it:

```tmux
set -g extended-keys on
```

## Documentation

- [Features](docs/FEATURES.md): dashboard workflow, keybindings, groups, status vocabulary, multi-repo workspaces, and worktree behavior.
- [Configuration](docs/CONFIG.md): runtime state, global config, Skills/MCP selection, themes, and state paths.
- [Development](docs/DEVELOPMENT.md): local setup, tests, package checks, and smoke testing.
- [Structure](docs/STRUCTURE.md): project layout and architecture notes for contributors.

## Acknowledgements

Thanks to [Ashesh Goplani](https://github.com/asheshgoplani) for [Agent Deck](https://github.com/asheshgoplani/agent-deck). This project ports its core session-dashboard idea into a smaller Pi-native extension. It is not affiliated with Agent Deck. See `LICENSE` for the Agent Deck MIT notice.
