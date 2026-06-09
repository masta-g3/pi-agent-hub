# pi-agent-hub Features

`pi-agent-hub` keeps Pi coding-agent sessions alive in tmux and gives them a calm keyboard-driven dashboard.

## Daily loop

```text
pi-hub
  ↓
pick a session
  ↓
Enter to open/switch
  ↓
work in Pi
  ↓
Ctrl+Q returns to the dashboard
```

## Core capabilities

| Capability | How to use it | Why it matters |
| --- | --- | --- |
| Long-running sessions | `n` creates, `Enter` opens | Sessions keep running in tmux instead of disappearing with a terminal. |
| Dashboard return | `Ctrl+Q` inside a managed session | Jump back to the hub without stopping the agent. |
| In-session rename | `Alt+R` inside a managed session | Open the dashboard rename dialog for the current session, then return to it after saving. |
| Direct send | `p` in the dashboard | Paste and submit a one-line message into the selected live session without opening it. |
| Custom dashboard shortcuts | `dashboard.shortcuts` in config | Bind safe Pi slash-command sends, such as `/session-summary name`, to dashboard keys. |
| Stable grouping/order | `g`, `G`, `K`, `J` | Keep sessions organized without status/title resorting. |
| Multi-repo workspaces | `Alt+A` in the new-session form | Work across repos through a symlink workspace without moving or owning source repos. |
| Hub-owned worktree sessions | `Ctrl+T` in the new-session form, `w` to finish | Create one-repo Git worktrees under hub state and explicitly finish, forget, or discard them. |
| Project Skills | `s` picker | Attach Pi skills to the selected session's primary repo. |
| Project MCP servers | `m` picker | Enable MCP tools for the selected session's primary repo. |
| Subagent rows | Automatic when `pi-tmux-subagents` reports them | See child agent work nested under the parent session. |

## Dashboard keys

| Key | Action |
| --- | --- |
| `n` | Create a new Pi session |
| `Enter` | Open or switch to the selected session |
| `/` | Filter sessions |
| `p` | Send a one-line message to the selected live session without opening it |
| `?` | Show help and status legend |
| `q` | Quit the dashboard |
| `i` | Toggle compact/full selected-session info |
| `↑↓` / `j` / `k` | Move selection |
| `r` | Open restart choices: `r` restarts selected, `n` starts a new conversation, `a` restarts all |
| `R` | Rename the selected session in the dashboard footer |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session |
| `a` | Mark the selected waiting session read |
| `w` | Finish the selected hub-owned worktree session |
| `N` | Sync the selected hub title from Pi's `/name` |
| `g` | Move the selected session to a group |
| `G` | Rename the selected session's group |
| `K` / `J` | Move the selected session up/down within its group |
| `Shift+Up` / `Shift+Down` | Same as `K` / `J` |
| `s` | Pick project skills |
| `Alt+E` | Edit the Skill pool path while the `s` picker is open |
| `m` | Pick project MCP servers |

## Status vocabulary

```text
● running or starting
◐ waiting for you
○ idle/read
× error
- stopped
```

Zero counts are hidden in the dashboard summaries, so `◐2 ×1` means only waiting and error sessions are currently visible.

The dashboard top line summarizes visible sessions and nonzero status counts in fixed order. Press `?` for the full help/legend and `i` to toggle compact vs full selected-session metadata. The details pane can also show extension-provided session metadata; see [Configuration](CONFIG.md#session-metadata).

## Dashboard tmux behavior

Running `pi-hub` uses one stable tmux session named `pi-agent-hub`:

- outside tmux: create or attach `pi-agent-hub`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs `pi-hub tui` inside tmux so it does not recursively create dashboards. It also applies its own tmux status bar instead of inheriting global tmux theme chrome.

When the dashboard is running inside tmux, `Enter` switches the current tmux client to the selected managed session and briefly shows the equivalent `tmux switch-client -t <session>` command. Opening a `waiting` session marks it read before attaching, so it can show `idle` after you return; `a` remains the manual mark-read shortcut.

If the dashboard tmux session is missing, the temporary return binding recreates it before switching back.

## Return shortcuts

Return shortcuts from a managed `pi-agent-hub-*` session:

| Key | Action |
| --- | --- |
| `Ctrl+Q` | Return to the dashboard |
| `Alt+R` | Return to the dashboard rename dialog for the current session, then switch back after saving |

## New session form

Press `n` to create a session.

| Field | Default |
| --- | --- |
| Primary cwd | Selected session's cwd, or the dashboard cwd if nothing is selected |
| Extra repos | Selected session's extra repos, if any |
| Group | Primary cwd folder name |
| Title | Random two-word slug |

While editing the form:

| Key | Action |
| --- | --- |
| `Alt+A` | Add another repo row |
| `Alt+X` | Remove the focused extra repo row |
| `Ctrl+N` / `Ctrl+P` | Cycle known cwd suggestions |
| `Ctrl+O` | Open the recent-repo picker |
| `Ctrl+T` | Toggle hub-owned worktree mode |

Extra repos are symlinked into one runtime workspace. The primary cwd remains the main project for skills and MCP state.

When worktree mode is enabled, the form supports one primary repo only. The `branch` field creates a new local branch and also becomes the session title shown in the dashboard.

## Groups and session actions

Groups are simple labels on sessions.

| Key | Action |
| --- | --- |
| `g` | Move the selected session to a group |
| `G` | Rename the selected session's group everywhere |
| `K` / `J` | Move the selected session up/down within its group |
| `Shift+Up` / `Shift+Down` | Same as `K` / `J` |
| `p` | Send a one-line message to the selected live session without opening it |
| `r` | Open restart choices: `r` restarts selected, `n` starts a new conversation, `a` restarts all |
| `R` | Rename the selected session in the dashboard footer |
| `w` | Finish the selected hub-owned worktree session |
| `N` | Sync the selected hub title from Pi's `/name` |

Reordering is disabled while a filter is active.

Custom normal-mode dashboard shortcuts can be configured in `config.json`; see [Dashboard shortcuts](CONFIG.md#dashboard-shortcuts). They send one-line text to the selected live session without opening it and are intended for Pi-native commands such as `/session-summary name`.

## Project-scoped Skills and MCP

Skills and MCP state attach to the selected session's primary repo:

```text
<project>/.pi/sessions/skills.json
<project>/.pi/sessions/mcp.json
```

The `s` picker lists skills from the configured skill pool directories and writes the final project selection once. It also shows the active Skill pool path; press `Alt+E` in the picker to edit that path and reload the available Skills. In Skills/MCP pickers, `↑`/`↓` moves within the current column, `←`/`→` switches between Enabled and Available (`Tab` also works), and `Space` toggles the selected item. The `m` picker writes enabled MCP servers for the selected project. If no session is selected, both pickers fall back to the dashboard current working directory.

For multi-repo sessions, extra repos are available in the runtime workspace, but Skills/MCP still belong to the primary repo. Restart the session after changing Skills or MCP so Pi reloads tools.

## Multi-repo model

Extra repos are symlinked into a per-session runtime workspace:

```text
<PI_AGENT_HUB_DIR>/workspaces/<session-id>/
  primary-repo -> /path/to/primary
  extra-repo   -> /path/to/extra
  .pi          -> /path/to/primary/.pi
```

Source repos are not moved, cloned, or owned by `pi-agent-hub`.

## Worktree model

Worktree sessions are opt-in and hub-owned:

```text
<PI_AGENT_HUB_DIR>/worktrees/<repo-name>/<session-id-prefix>-<branch-slug>/
```

Press `Ctrl+T` in the new-session form to enable worktree mode, then enter the branch name. The branch name is also the session title. Worktree mode supports one primary repo in v1 and cannot be combined with extra repos.

Normal `d` delete is conservative: it removes the dashboard row and heartbeat, but keeps hub-owned worktree files. From the delete dialog, `Shift+D` discards a clean hub-owned worktree and branch without merging. Press `w` on a clean hub-owned worktree session to stop its session/subagent tmux processes, merge the worktree branch into the recorded base branch, remove the worktree, prune Git metadata, delete the merged local branch, and remove the dashboard row. Dirty worktrees or dirty base repos block finish so files are preserved.

## Non-goals

`pi-agent-hub` intentionally stays small:

- no cloud service;
- no custom agent runtime;
- no repo filesystem scanning;
- no broad Git/worktree manager beyond the explicit hub-owned create/finish flow;
- no Agent Deck remotes/tools registry clone.

Pi runs the agents. tmux keeps them alive. The hub gives you one stable place to see and steer them.
