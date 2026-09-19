# pi-agent-hub Features

`pi-agent-hub` keeps Pi coding-agent sessions alive in tmux and gives you one keyboard-driven dashboard to manage them.

## Daily loop

```text
pi-hub
  ↓
pick a session or press n to create one
  ↓
Enter to open it
  ↓
work in Pi
  ↓
Ctrl+Q returns to the dashboard
```

Use `P` to keep a live session beside the dashboard instead. `Alt+1`–`Alt+4` focuses a pin; `Ctrl+Q` returns to the session list.

## Core capabilities

| Capability | How to use it |
| --- | --- |
| Long-running sessions | `n` creates; `Enter` opens or restarts. tmux keeps sessions alive. |
| Attention-first dashboard | Status view separates explicit requests, errors, running work, quiet sessions, and archives. |
| Repository grouping | `v` switches between Status and Repo views. |
| Live pins | `1`–`4` assigns a free slot; `P` chooses the first free one. |
| Search and actions | `/` filters; `:` finds actions, sessions, and named filters. |
| Task context | The selected-session workspace shows requests, task text, workflow position, and actions. |
| Conversation | `c` shows completed messages and supported inline questions below the fleet. |
| Explainable status | `i` or `pi-hub explain <id-or-prefix>` shows the evidence behind status and placement. |
| Direct send | `p` sends a one-line message without opening the session. |
| Custom shortcuts | Configure keys that send Pi commands to a live session. |
| Themes | `t` previews Pi themes and saves a global or Hub-only choice. |
| Multi-repo sessions | `Ctrl+R` adds a repo in the new-session form. |
| Isolated worktrees | `Ctrl+T` enables a branch session; `w` finishes it. |
| Project skills and MCP | `s` and `m` choose capabilities for the primary repo. |
| Optional subagents | `pi-tmux-subagents` reports child agents under their parent. |
| Optional workflows | Compatible Pi extensions supply tickets, explicit requests, workflow steps, and progress. `S` opens the board. |

Hub works without the optional integrations. See [Configuration](CONFIG.md#optional-integrations) to set up Rules, tmux subagents, or your own metadata producer.

## Dashboard keys

| Key | Action |
| --- | --- |
| `n` | Create a new Pi session |
| `Enter` | Open/switch or restart the selected session at every width |
| `1`–`4` | Pin the selected live session into that exact free slot |
| `P` | Pin into the lowest free slot, or focus the session's existing pin |
| `Alt+1`–`Alt+4` | Focus an occupied slot from the dashboard or a live pane |
| `x` | Close the selected session's pin without stopping Pi |
| `+` / `-` | Resize the main pin split by ten percentage points, within 30/70 |
| `Ctrl+Q` | Return to the dashboard from a managed session or pin |
| `/` | Filter sessions |
| `b` | Show or hide Backlog in the current filter |
| `:` | Search actions, sessions, and named filters |
| `p` | Send a one-line message to the selected live session |
| `c` | Show or hide Conversation below the fleet |
| `?` | Show help and status legend |
| `q` | Quit the dashboard |
| `i` | Toggle live details in the action workspace; open it full-width in a narrow terminal |
| `↑↓` / `j` / `k` | Move selection |
| `←` / `→` | Collapse / expand the selected subagent tree |
| `Shift+←` / `Shift+→` | Collapse / expand all trees in the current view |
| `Space` | Toggle the selected tree on the workflow board |
| `r` | Restart choices: `r` resume selected, `n` new conversation, `a` restart all Active parents |
| `R` | Rename the selected live, unlinked session |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session through the group-selection form |
| `Shift+F` | Choose a group, fork, clear inherited ticket/workflow metadata, and compact |
| `a` | Mark the selected waiting session read |
| `A` / `B` / `U` | Archive / move to Backlog / restore to Active |
| `w` | Finish the selected hub-owned worktree session |
| `N` | Sync the Hub title from Pi's saved name |
| `g` / `G` | Move a session to a group / rename its group |
| `K` / `J` | Reorder tied Active/Backlog rows within their group in Status view |
| `Shift+Up` / `Shift+Down` | Same as `K` / `J` |
| `s` / `m` | Pick project skills / MCP servers |
| `Alt+E` | Edit the skill pool path inside the skills picker |
| `t` | Preview and configure the dashboard theme |
| `v` | Toggle Status / Repo fleet grouping |
| `S` | Visit the workflow board or return to the chosen fleet grouping |
| Click / double-click | Select / open a session; double-click folds a section header |

Session actions apply to the exact selected row. Section headers are not sessions. Unavailable actions appear with a reason in `:`.

## Conversation

Press `c` to read the selected live parent session below the fleet. Close pinned panes first. `YOU` and `PI` headings separate completed messages. `PgUp` / `PgDn` scroll the focused history or question area; `End` returns history to the latest messages. An animated working indicator appears while Pi runs.

Supported pending questions appear under `? ANSWER NEEDED`. Press `Tab` from the fleet to focus the answer area. Number keys select options or toggle multiple selections; `t` opens a custom answer. `Enter` advances to the next question or sends the final answers. `←` revisits a previous question when not editing text. `Escape` returns focus to the fleet without cancelling the question.

Direct answers require a [compatible question extension](CONFIG.md#inline-questions). If unavailable, use **Open in Pi**. Native Pi and Hub submissions resolve the same request; only the first valid answer wins. Opening or hiding Conversation neither answers nor cancels a request.

Conversation shows completed text and question/answer exchanges, not tools, thinking, or streaming fragments. It reads the live session without saving a second transcript or searching messages. Stopped sessions require Restart. After updating Hub, reopen the dashboard and reload idle Pi sessions with `/reload` if their extension changed.

## Repo grouping

Press `v` for alphabetical repository sections. Each section contains complete parent/child trees ordered by requests, errors, active work, then quiet work. Archived sessions stay separate and newest-first. Each parent keeps its chosen `[group]` badge after its title.

Repository identity comes from the primary source path. Hub-owned worktrees stay with their source repo; multi-repo sessions appear once under their primary repo. Different folders with the same name remain separate. The action workspace shows the actual path.

Select a repo header and press `Enter`, or double-click it, to fold the section. Header counts show parent sessions and requests; hidden child requests have a separate count. Filters temporarily reveal matching repos. Hub saves the Status/Repo choice, but repo folds reset on dashboard launch.

`S` visits the workflow board and returns to your chosen fleet view. `v` and manual row reordering are unavailable on the board; reordering is also unavailable in Repo view.

## Fork and compact

`Shift+F` creates a child with the default fork name. Rules must confirm that the child's inherited ticket and workflow are cleared before Hub starts compaction. Hub reports success only after compaction finishes and the child still has no linked task. The source conversation and project files stay unchanged; the child retains compacted discussion context.

Use matching updated Hub and Rules extensions. If Rules is missing, disabled, or cannot confirm the reset, Hub reports an error and does not start compaction. The child stays available for inspection. Enable or update Rules, then retry Fork and compact from the original session. Compaction errors and timeouts also leave the child available; a timeout does not mean compaction succeeded or stopped.

Normal `f` forks retain ticket ownership and do not request this reset.

## Intent palette

Press `:` to search built-in actions, configured shortcuts, current sessions, and named filters. Session search includes names, repos, groups, tasks, tickets, requests, and workflow context. It never searches raw pane output or Pi conversation content.

Selecting a session result reveals and selects it in Hub. It does not open, restart, or mark it read. Press `Enter` afterward to open it. Disabled actions stay visible with a reason.

Use `/` for a quick text filter. Named filters share the same filter state. For example, `lifecycle:archived,backlog release` finds matching text in either lifecycle bucket. Lowercase `b` changes Backlog visibility; uppercase `B` moves the session to Backlog. Hub saves the text and lifecycle filter. `Escape` closes the palette without clearing that filter.

## Status vocabulary

```text
● running or starting
◐ waiting
○ idle/read
× error
- stopped
```

Status describes runtime state, not workflow completion or a request for input. Pi prompts report waiting while open; compaction reports running while in progress.

Status view groups complete session trees into these sections:

| Section | What belongs here |
| --- | --- |
| NEEDS YOU | A waiting/idle parent with an explicit request from a Pi extension |
| HEALTH | A parent with a runtime error |
| ACTIVE | A running/starting parent or child |
| QUIET | Other non-archived sessions |
| ARCHIVED | Archived trees, newest-first |

A waiting session alone does not enter `NEEDS YOU`. A running child can put its tree in `ACTIVE`, but a child's request or error does not become the parent's state. Hidden child requests show as `?N` on the parent and a child-request count on the section. Expand the tree to inspect them.

`NEEDS YOU` stays expanded. Other Status sections can fold, and Hub saves those preferences. Filters reveal matching rows without changing their classification. Parent rows show `[group]` after the title, `⎇` for a worktree, and `⧉ N` for multiple repos. `⚙︎N` counts running/starting descendants.

### Action workspace

Select a session to see its identity, explicit request, task text, workflow position, and available actions. Missing information takes no space. The `▸` marker identifies the primary action.

At 120+ columns, the workspace stays beside the list. In smaller terminals, `i` opens it full-width and `Escape` returns. `Enter` and session-row double-click open, switch, or restart directly at every width. Workspace action rows also accept a single click.

Press `i` to show or hide `LIVE DETAILS`: tmux presence, heartbeat, read state, and the evidence behind runtime status and dashboard placement. The CLI equivalent is `pi-hub explain <exact-id-or-unique-prefix>`. It observes the fleet without updating the registry. Neither view captures pane tails or conversation text.

### Requests and notifications

Optional extension attention uses `✓` for a ready handoff, `?` for a question, and `!` for a blocker. Hub displays it on waiting/idle rows only. For supported pending questionnaires, **Answer** opens the inline answer area in Conversation. Other questions use the native Pi session. **Open in Pi** remains available when direct answering is unsupported.

Opening or explicitly focusing a waiting session marks it read. Pin creation, search results, and opening details do not. Use `a` to mark it read manually.

Fresh requests with producer-supplied IDs can show a six-second notification band and a tmux message when you are elsewhere. Click the band or choose **Locate newest request** in `:` to reveal the session without opening it. **Attention bell** is optional and off by default. Requests already present when Hub starts do not announce themselves again.

An empty first-run dashboard teaches create, open a request, and return with `Ctrl+Q`. That coaching ends after the first successful request round trip.

### Workflow board

Press `S` to see Active session trees in workflow lanes. A compatible Pi extension supplies the steps and current position. Sessions without compatible workflow data appear in `OTHER ACTIVE`; Backlog and Archived stay summarized in the footer. Each lane groups parent sessions by their existing group labels.

Rules supplies Plan → Execute → Review → Reflect → Commit. Other producers can supply their own ordered steps. Hub's board is read-only: it does not dispatch skills, advance stages, or infer completion from an idle agent.

Step checks show position, not an execution audit. Earlier positions are checked; the current position is active until the producer reports it complete. Later positions remain pending. A stopped session can retain its last workflow position.

At wider sizes, board cards show activity and plan progress when available. Rules' active focus mode displays `FOC` without creating another workflow lane. Task progress, workflow position, runtime status, and requests remain separate facts.

Subagent trees start collapsed in both fleet and board. Use `←` / `→` for one tree, Shift with those arrows for all trees, or `Space` on the board. Filtering reveals matching child context without changing saved section preferences. Each visible child remains independently selectable.

## Dashboard themes

Press `t` to choose a built-in or globally available Pi theme. Moving between fixed choices previews immediately. Automatic offers separate light/dark choices; use `←` / `→` to change them. `Space` toggles **Sync to Pi**, `Enter` applies, and `Escape` restores the opening theme.

Sync is on by default. Confirmation updates Pi's global default and applies it to current managed parent sessions. Turn sync off for a Hub-only theme. Opening differently themed sessions does not recolor the dashboard. See [Theme behavior](CONFIG.md#theme-behavior) for details.

## Dashboard tmux behavior

`pi-hub` uses one tmux session named `pi-agent-hub`. Outside tmux, it creates or attaches to that session. Inside tmux, it switches the current client to it. `pi-hub tui` runs directly without that wrapper.

`Enter` switches to the selected live session and shows the equivalent tmux command. A stopped or error session restarts instead. Opening a waiting session marks it read. `q` quits the dashboard, not its managed agents.

### Sidebar workspace

Use `1`–`4` to assign a live session to an exact free slot, or `P` for the lowest free slot. If it is already pinned, `P` or its current number focuses it. An occupied slot refuses another session; Hub never replaces or evicts it. `x` closes only the selected session's pin.

| Terminal width | Available layout |
| --- | --- |
| Below 100 columns | No new pins |
| 100–119 | Slots 1 and 2 stacked |
| 120–159 | Slots 1 and 2 side by side |
| 160+ | Four slots in a 2×2 layout |

In the four-slot layout, 1/2 are top-left/top-right and 3/4 are bottom-left/bottom-right. Empty rows or columns give their space to occupied ones. `▢N` marks a pin; `▣N` marks the focused pin. `+` / `-` changes the main split in ten-point steps within 30/70.

`Alt+1`–`Alt+4` focuses occupied slots from the sidebar or live panes. `Ctrl+Q` returns to the sidebar. `Alt+Arrow` is an optional spatial alias; some terminals consume it for word movement, so numeric focus is more reliable.

Shrinking the terminal preserves pins and slot numbers. Hub blocks new pins and resizing when the layout is too small; closing pins still works. Pin creation keeps dashboard focus and does not mark a request read. Explicit focus does.

Pins are live tmux attaches, not copied output. Closing a pin leaves its Pi session running. If the dashboard tmux session is missing, the managed-session return binding recreates it before switching back.

## Return shortcuts

| Key inside a managed session | Action |
| --- | --- |
| `Ctrl+Q` | Return to the dashboard |
| `Alt+Q` | Pi message editing; Hub does not intercept it |
| `Alt+R` | Open Hub's rename dialog, then return to the session after saving |

## New session form

Press `n` to create a session.

| Field | Default |
| --- | --- |
| Primary cwd | Selected session's working directory, or the dashboard directory |
| Extra repos | Selected session's extra repos, if any |
| Group | Primary directory's folder name |

| Key in the form | Action |
| --- | --- |
| `Enter` | Create from a text field; activate the selected picker, toggle, or action |
| `Ctrl+Y` | Create the session from anywhere in the form |
| `Ctrl+F` | Open named directory favorites |
| `Ctrl+S` | Save the current directory set as a favorite |
| `Ctrl+R` | Add another directory row |
| `Ctrl+X` | Remove the focused additional directory |
| `Ctrl+N` / `Ctrl+P` | Cycle known directory suggestions |
| `Ctrl+O` | Open the recent-directory picker |
| `Ctrl+G` | Expand options and focus Group |
| `Ctrl+T` | Toggle worktree mode |
| `Ctrl+L` | Expand options, enable worktree mode, and focus Branch |

Bracketed directory and option values are editable fields, `▾` marks a picker, and actions are listed separately. The focused control changes the fixed help line near the bottom; it does not move the form rows.

A favorite stores a name and an ordered set of directories, with Primary first. Applying one replaces the draft directories and seeds the editable Group from the favorite name. It does not change the worktree choice or branch and never starts a session. In the favorites picker, use `Ctrl+U` to start updating from the current draft, `Ctrl+R` to rename, and `Ctrl+X` to start removal. Update and removal show a confirmation screen; press `Enter` to confirm.

The recent-directory picker uses known paths, not filesystem scanning. Additional directories become links in a runtime workspace. The primary directory owns skills and MCP configuration.

When worktree mode is on, enter a branch name. Hub creates the same branch in every selected repo. The branch does not control the session name. Worktree mode starts off unless `worktree-default` is configured.

## Session names

New sessions and fresh-conversation restarts use `New · <repository>`. Forks use `Fork · <source session name>`. Duplicate defaults gain ` · 2`, ` · 3`, and so on. Worktree sessions use the source repo's folder name.

These are initial names. Manual or agent naming can replace an unlinked session's name; resuming a saved conversation preserves it. `R` renames a live session, and `N` syncs from Pi's saved name.

With Rules installed, a linked ticket owns the name. It identifies the task, not the workflow stage. Hub disables Rename while ticket context is present. In Pi, use `/wf-ticket clear` to unlink the ticket while keeping workflow progress, or `/wf-clear` to clear both. Both stop Focus continuation and release name protection without changing the current name or ticket files. Dismissing only the completed workflow indicator keeps the ticket linked.

Normal Hub forks retain the ticket. Native Pi forks clear it in the child. See [Fork and compact](#fork-and-compact) for the verified reset and failure behavior.

## Groups and session actions

Groups are labels, not project records. `g` moves a session to a label, creating it if needed; `Ctrl+N` / `Ctrl+P` cycles known groups in the dialog. `G` renames the group for every session using it.

Within Status sections, source order keeps groups stable with `default` first. Within each group, errors and unread waits precede running work, read/idle sessions, and stopped sessions. Activity orders rows within these priorities. `K` / `J` breaks exact priority/activity ties only, and is unavailable while filtering or in Repo/board views. Archived always uses archive time.

Backlog and Archive do not stop tmux or Pi. Archiving closes the session's pin; Backlog does not. Children follow their parent's lifecycle and cannot move independently.

Archived shows five recent parent trees by default. Select the older-items row and press `Enter` to show more. After seven days, dashboard cleanup can forget an archived tree only when every parent/child tmux session is confirmed gone. It removes Hub records and owned symlink workspaces, not Pi conversations or worktrees.

Configured [dashboard shortcuts](CONFIG.md#dashboard-shortcuts) send one-line text such as `/session-name refresh` to a selected live session without opening it. They are Pi commands, not shell macros. Configured commands require an idle session with no queued messages, blocking prompt, or editor draft. They use Pi's input pipeline; `p` remains a separate one-line send.

## Project-scoped Skills and MCP

Skills and MCP selections belong to the primary repo:

```text
<project>/.pi/sessions/skills.json
<project>/.pi/sessions/mcp.json
```

Press `s` for the configured skill pools or `m` for the MCP catalog. `←` / `→` switches Enabled/Available columns, `↑` / `↓` moves within a column, and `Space` toggles an item. `Tab` also switches columns. In the skills picker, `Alt+E` edits the pool path.

With no selected session, the pickers use the dashboard directory. Multi-repo sessions attach capabilities only to the primary repo. Restart after changing skills or MCP so Pi reloads tools. See [Configuration](CONFIG.md) for pools and catalogs.

## Multi-repo model

Extra repos are symlinked into a per-session workspace:

```text
<PI_AGENT_HUB_DIR>/workspaces/<session-id>/
  primary-repo -> /path/to/primary
  extra-repo   -> /path/to/extra
  .pi          -> /path/to/primary/.pi
```

Source repos are not moved, cloned, or owned by Hub. Pi starts from the workspace; the selected primary repo remains the project for capabilities and metadata.

At start/restart, Hub combines available `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD` instructions from the selected repo roots into a labeled workspace `AGENTS.md`.

Managed parent launches export `PI_AGENT_HUB_PRIMARY_CWD` so compatible extensions can find project-local files even when Pi starts from a workspace or forked conversation.

## Worktree model

Hub-owned worktrees live under:

```text
<PI_AGENT_HUB_DIR>/worktrees/<repo-name>/<session-id-prefix>-<branch-slug>/
```

Enable Worktree with `Ctrl+T`, or focus its row and press `Space`, then enter a branch. To make it the default:

```bash
pi-hub config set worktree-default true
```

Multi-repo sessions create one worktree per repo using the same branch name. Workspace `.pi` points at the primary source repo's `.pi`, so project configuration does not dirty the worktree.

Hub tells managed agents which worktree maps to which source repo. Compatible subagents receive the same guidance. Task changes belong in the worktree. Agents may inspect the source for required local setup files, but must not modify it for task setup or copy secrets unless the task requires them.

| Action | Result |
| --- | --- |
| Normal `d` delete | Stop the session, remove Hub records and workspace; keep worktree files and branches |
| `w` finish | Merge into recorded base branches, remove worktrees and merged branches, then remove the session |
| `d`, then `Shift+D` discard | Remove clean worktrees and their branches without merging |

Finish/discard checks Git cleanliness before stopping parent and child sessions. Both require clean worktrees; finish also requires clean base repos. Multi-repo operations process additional repos before the primary repo. Normal delete never removes Pi conversation files or source repos.

## Non-goals

Hub stays local and Pi-native. It has no cloud service, custom agent runtime, repo filesystem scanning, or general Git manager. It displays extension-provided workflow data without becoming the workflow engine.
