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
| Custom dashboard shortcuts | `dashboard.shortcuts` in config | Bind safe Pi slash-command sends, such as `/session-name refresh`, to dashboard keys. |
| Stable dashboard theme | `t` opens theme settings | Preview Pi global themes, save globally by default, or keep a Hub-only override without following session changes. |
| Attention-first cockpit | Default project view | See explicit requests first, then runtime health, active work, quiet work, and chronological archives. |
| Multi-repo workspaces | `Alt+A` in the new-session form | Work across repos through a symlink workspace without moving or owning source repos. |
| Hub-owned worktree sessions | `Ctrl+T` in the new-session form, `w` to finish | Create Git worktrees under hub state for one or more repos and explicitly finish, forget, or discard them. |
| Project Skills | `s` picker | Attach Pi skills to the selected session's primary repo. |
| Project MCP servers | `m` picker | Enable MCP tools for the selected session's primary repo. |
| Subagent rows | Automatic when `pi-tmux-subagents` reports them | Expand or collapse selected trees with `←`/`→`; use Shift with those arrows for all trees in the current grouping. |
| Workflow rail + board | Automatic when `workflow-runtime` reports its ordered steps; `S` changes grouping and `v` changes density | Switch from the attention cockpit to producer lanes: canonical workflow trees stay in their lanes and all other Active trees appear in `OTHER ACTIVE`. |

## Dashboard keys

| Key | Action |
| --- | --- |
| `n` | Create a new Pi session |
| `Enter` | Open/switch to the selected live session, or restart a stopped/error session |
| `1`–`4` | Assign, replace, move, or swap the corresponding fixed quadrant panel while staying in the sidebar |
| `x`, then `1`–`4` | Close the corresponding panel |
| `F`, then `1`–`4`, or `Alt+1`–`Alt+4` | Focus the corresponding open panel |
| `Alt+Q` or `Ctrl+Q` | Return from a focused panel to the sidebar |
| `o` | Reset side panels to the selected session, or close it when it is the only panel |
| `/` | Filter sessions |
| `p` | Send a one-line message to the selected live session without opening it |
| `?` | Show help and status legend |
| `q` | Quit the dashboard |
| `i` | Toggle compact/full selected-session info |
| `↑↓` / `j` / `k` | Move selection |
| `r` | Open restart choices: `r` restarts selected, `n` starts a new conversation, `a` restarts all active sessions (not Backlog or Archived) |
| `R` | Rename the selected session in a cursor-aware form |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session |
| `a` | Mark the selected waiting session read |
| `A` | Archive the selected session |
| `B` | Move the selected session to Backlog |
| `U` | Restore a Backlog or Archived session to Active |
| `w` | Finish the selected hub-owned worktree session |
| `N` | Sync the selected hub title from Pi's `/name` |
| `g` | Move the selected session to a group; the dialog pre-fills visible existing groups and `Ctrl+N` / `Ctrl+P` cycles them |
| `G` | Rename the selected session's group |
| `K` / `J` | Move the selected Active/Backlog session up/down within its group |
| `Shift+Up` / `Shift+Down` | Same as `K` / `J` |
| `s` | Pick project skills |
| `Alt+E` | Edit the Skill pool path while the `s` picker is open |
| `m` | Pick project MCP servers |
| `t` | Preview and configure the stable dashboard theme; `Enter` applies and `Escape` restores |
| `v` | Toggle compact rows ↔ all-session junction cards |
| `S` | Toggle the project cockpit ↔ workflow-stage lanes |

## Status vocabulary

```text
● running or starting
◐ waiting
○ idle/read
× error
- stopped
```

Runtime symbols describe liveness only. A waiting row does not imply an explicit request. The default project cockpit groups complete owner trees into nonempty tiers: `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, then `ARCHIVED`. `NEEDS YOU` requires producer-confirmed attention on a waiting/idle owner. `HEALTH` requires an owner runtime error. `ACTIVE` requires a starting/running owner or descendant. Other non-archived trees appear in `QUIET`. A running child can activate its owner tree, but child attention/error never promotes the owner and tier placement never changes row status, workflow, lifecycle, or attention. During context compaction, the session shows `running` and then returns to its previous state. If compaction retries, it stays `running` until the next agent turn begins.

Backlog remains an independent organization state. Its rows carry a `backlog` tag and can still enter a higher tier when explicit attention, error, or active work requires it. Groups are muted row tags rather than project headings. Archived remains flat and globally newest-first; its header is the only collapsible project section. It shows the newest five parent cascades by default and keeps nested rows in their parent's cascade. Select `… N older archived` and press `Enter` or double-click to expand; use `⌃ show fewer` to collapse. Filtering reveals matching rows without changing tier classification, tree expansion, or Archived collapse state. Stage grouping keeps Backlog/Archived summarized in the footer.

Sessions running the optional `workflow-runtime` extension also show a workflow rail: the compact current-position marker and short code (`◉EX` or `✓EX`) in project rows and the producer-defined full rail (`✓ PL─◉ EX─· RV─· RF─· CM · ticket`) in the details pane. Project rows retain the title first, then reveal `backlog`, group, workflow short, and activity age as width permits; running rows omit the redundant age, and Archived rows retain their time-since-archive label. Junction cards use the dense marker-only form (`✓◉···`) before producer activity. When activity is absent, deterministic plan progress uses the adaptive `▰`/`▱` phase grid, flattening and then reducing to a ten-cell ratio plus count only as width requires. The runtime owns the ordered ids, short codes, friendly labels, and optional current-position completion; Hub does not mirror a workflow vocabulary.

Markers describe position, not an execution audit. Steps before the current position are checked even when a producer invokes a later step directly. The current marker is `◉` until the producer reports it complete, then becomes `✓`; later positions remain `·`. A final completed position can therefore retain an all-check rail while idle, stopped, stale, or resumed. A new producer snapshot replaces that state. Completion does not move a card to another lane or change liveness, attention, grouping, or lifecycle.

When Rules focus mode is active, its producer-owned display metadata substitutes `FOC` for the active `EX` short in project rows and rails. The card stays in the `EXECUTE` lane and reserves `FOC` at its right edge; expanded details show the producer's `Focus · turn N` text. Focus is display-only in Hub: it adds no lane, ordering priority, control, or animation. Stopped sessions retain their Execute lane but fall back to `EX` and omit stale focus detail.

Pressing `S` switches to the read-only workflow board. Compatible Active workflow parent trees stay in producer-defined vertical lanes. Every remaining Active tree—without workflow metadata or on an incompatible pipeline—appears afterward in synthetic `OTHER ACTIVE`, which deliberately implies no workflow position. Backlog/Archived parents remain summarized in the footer. If multiple pipeline versions are visible, the most prevalent ordered-id sequence wins deterministically and the newest compatible labels/short codes supply the vocabulary.

Every lane and `OTHER ACTIVE` nests cards under the existing top-level parent group, with parent-card counts on lane and group headings. Compact density keeps every card to one row. Subagent trees start collapsed in both project and stage grouping. Parents with descendants show `▸`; `→` expands the selected tree to `▾`, `←` collapses it, and adding Shift applies the action to all trees in the current grouping. `Space` remains a stage-group selected-tree toggle. Revealed children stay directly nested and independently navigable; collapsing a selected child returns selection to its top-level parent. Active filters temporarily reveal matching ancestor/descendant context without changing expansion state. Top-level parent rows/cards add an independent `⚙︎N` when descendants are `starting` or `running`; waiting, idle, error, and stopped descendants do not count. Disclosure and the badge add no persistent state or parent-state promotion. `K`/`J` reordering remains project-grouping only.

There is no board feature flag. Install a producer that publishes the soft `workflow-runtime` contract, run `/reload` in an existing Pi session if needed, invoke its workflow, and press `S`. Rich ticket and attention context is optional and arrives through the producer-neutral [`pi-agent-hub-context`](CONFIG.md#generic-session-context) entry.

In all-session card density, each cockpit tier owns one junction rail in project view; existing Hub groups own the rails in stage lanes. Active main sessions use Pi's native name, an optional `#ticket-id · subtitle` line, and producer-owned activity or deterministic plan progress. Hub starts with the primary repo basename as a provisional cache value. A subtitle that repeats the native name is omitted. Missing fields collapse without blank placeholders. `├`/`└` mark session starts; selection changes them to heavy `┣`/`┗` and highlights the full visible card. Every visible line in a card is clickable: single-click selects its owning session and double-click performs the same open/switch/restart action as the title line. Keyboard navigation still treats the card as one session. Backlog lifecycle rows and subagents stay one line, while Archived stays flat, compact, and chronological. Under height pressure, Hub always keeps the selected title. As capacity permits, it retains the rest of the selected card and its owning section or stage-group headings, then uses nearby title rows before count indicators. Spare rows restore metadata only with its owning title, so clipped cards never show orphaned continuation lines.

Attention is an independent overlay on waiting/idle rows: `✓` means a ready handoff, `?` an explicit question/choice, and `!` a blocker. Only explicit owner attention enters `NEEDS YOU`; waiting alone does not. Running/error/stopped rows keep operational presentation, and subagent attention is never promoted to its parent. The right pane's `work` block retains the bounded ticket description, phase title, task fraction, attention, and deterministic action once; the live preview follows. Workflow step, Hub runtime status, attention, and running-subagent count remain independent axes: the board never infers attention from waiting, promotes child state, advances workflow, dispatches skills, moves stages, or persists board state.

The project top line summarizes visible sessions plus nonzero `needs you` and `health` tree counts; the workflow board retains runtime status counts. Press `?` for the full help/legend and `i` to toggle compact vs full selected-session context. The details pane shows the bounded generic ticket description and explicit attention reason when available.

## Dashboard themes

Press `t` for the same built-in and globally available theme choices used by Pi Settings → Theme. Moving over fixed choices previews immediately. Automatic expands separate light/dark choices; use `←`/`→` to change either choice. `Space` toggles **Sync to Pi**, `Enter` applies, and `Escape` restores the opening theme.

Sync defaults on: confirmation updates Pi's global default, applies the resolved theme once to current managed parent sessions, and lets future Pi processes inherit it. Turn sync off to persist a Hub-only override without touching Pi. Re-enabling sync pushes the visible Hub choice back to Pi. Project-local themes are excluded, subagents are not propagation targets, and opening/selecting differently themed sessions never recolors the dashboard. See [Theme behavior](CONFIG.md#theme-behavior) for Automatic and persistence details.

## Dashboard tmux behavior

Running `pi-hub` uses one stable tmux session named `pi-agent-hub`:

- outside tmux: create or attach `pi-agent-hub`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs the current CLI file's `tui` command inside tmux so it does not recursively create dashboards or depend on a stale `pi-hub` on PATH. It also applies its own tmux status bar instead of inheriting global tmux theme chrome.

When the dashboard is running inside tmux, `Enter` switches the current tmux client to the selected live session and briefly shows the equivalent `tmux switch-client -t <session>` command. On a stopped or error session, `Enter` restarts it instead of attempting to attach. Opening a `waiting` session marks it read before attaching, so it can show `idle` after you return; `a` remains the manual mark-read shortcut.

### Sidebar workspace

Use `1`–`4` in the dashboard to place the selected live session in a fixed screen quadrant: `1` is top-left, `2` top-right, `3` bottom-left, and `4` bottom-right. Empty slots may be assigned in any order and holes remain stable. A bare digit never closes or focuses a panel: it assigns an empty quadrant, replaces its session, moves or swaps an already shown session, and leaves keyboard focus in the sidebar. Close explicitly with `x` then `1`–`4`.

The dashboard remains a narrow left sidebar while panel geometry expands from the occupied quadrants. A single panel fills the content region. `1`+`2` produces side-by-side columns, while `1`+`3` produces stacked rows. Opposite corners such as `1`+`4` expand into two full-height columns rather than leaving blank screen regions. Three occupied quadrants split only the column containing two panels, and all four form an even 2×2 grid. Closing a panel re-expands survivors without changing their numbers. `[n]` pane-title badges keep quadrant identity visible when expansion moves a pane away from its literal corner.

Press `F` then `1`–`4` to focus an open quadrant from the sidebar. Guarded `Alt+1`–`Alt+4` tmux bindings provide the same jump from anywhere in the dashboard session, including inside another panel; an empty target is a no-op. Press `Alt+Q` to return to the sidebar, with `Ctrl+Q` retained as a fallback. Press `o` to reset any current arrangement to one panel showing the selected session. If that session is already the sole panel in any quadrant, `o` closes it. A persistent strip below the dashboard summary maps all four slots to panel titles, including holes and sessions hidden by the current filter. The focused slot and its row `◫1`–`◫4` indicator use the theme accent; inactive indicators are muted. Panel borders use matching `[n] <title>` labels, with an accent border and reverse-color title badge on the focused pane. While any side panel is open, the sidebar omits its built-in details/preview column so the live panels remain the only content preview.

All `1`–`4` assignment, replacement, move, and swap actions leave focus on the sidebar so several sessions can be placed without returning between each action. Use `F` then `1`–`4` or `Alt+1`–`Alt+4` when you want to focus a panel. Explicit close, narrow-width refusal, and `o` reset also leave focus on the sidebar. A single mouse click selects a session row or any visible line in its card; a double-click opens/switches to a live session or restarts a stopped/error session. The mouse wheel moves selection. Hub enables tmux mouse mode only on the dashboard session while it is running and unsets that session override on quit.

Native tmux keys also handle the layout: `prefix+←/→/↑/↓` moves focus, `prefix+z` zooms the focused pane to hide/show neighbors, `prefix+x` closes a pane, and `prefix+{` / `prefix+}` swaps panes. If `Enter` opens a session currently shown in any side pane, Hub closes that pane first to avoid tmux size flapping. Hub refuses to grow a layout when the resulting panels would be narrower than 40 columns.

The side panes are stateless and self-healing: quadrant assignments live only in each pane's `@pi_hub_slot` tmux user option and are never written to Hub's registry. Untagged or duplicate-tagged managed panes are repaired into the lowest free quadrants in geometry order. A managed session's own tmux status footer is hidden while that session appears in a panel, then restored when the panel closes, before full-session entry, and during dashboard shutdown. Because tmux status visibility is session-scoped, another client manually attached to the same paneled session also sees the hidden footer. Hub inspects the current window live and only owns panes whose tty maps to a nested client attached to a `pi-agent-hub-*` managed session. User-created shell/editor panes are never killed or retargeted. If the terminal is squeezed too narrow, the dashboard shows a compact narrow-pane notice instead of exiting; when side panes exist and the window is wide enough again, Hub restores a collapsed sidebar to its normal width. Manual sidebar widths from 40 through 60 columns are preserved when space permits; wider sidebars, or sidebars crowding the content area, shrink to 60 columns or the largest width that retains 40 content columns. If a shown session exits, tmux normally closes its nested pane automatically.

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

While editing the form:

| Key | Action |
| --- | --- |
| `Alt+A` | Add another repo row |
| `Alt+X` | Remove the focused extra repo row |
| `Ctrl+N` / `Ctrl+P` | Cycle known cwd suggestions |
| `Ctrl+O` | Open the recent-repo picker |
| `Ctrl+T` | Toggle hub-owned worktree mode |

Extra repos are symlinked into one runtime workspace. Project rows place an accented `⎇` before a worktree title and show a dim compact `⧉ N` badge after a multi-repo title; selected details retain the full branch and `N repos` wording. The primary cwd remains the main project for skills and MCP state. Hub exports that `ManagedSession.cwd` as `PI_AGENT_HUB_PRIMARY_CWD` to every managed parent process so producer extensions can resolve project-local files when Pi runs from a multi-repo workspace or resumes fork-origin history. It never exports the workspace path or an extra repo as the primary cwd. Hub uses the primary repo basename as a provisional dashboard label until Pi publishes its canonical native session name.

When worktree mode is enabled, the `branch` field creates the same new local branch in every selected repo. It does not control the session name.

## Groups and session actions

Groups are simple labels on sessions. Moving a session to a new label creates that group, and renaming a group updates every session currently using that label. In the project cockpit, groups appear as muted row metadata when width permits. Active and Backlog source rows retain stable `default`-first group order. Inside each group, errors come first, followed by unacknowledged `waiting` rows newest-first, `starting`/`running` rows, acknowledged waiting/idle rows by activity, and stopped rows. The cockpit stable-partitions those complete trees by attention tier while preserving source order inside each tier. Manual row order breaks exact priority/activity ties, so `K`/`J` move a row only inside such a tie. Reordering is disabled while a filter is active and unavailable in Archived because archive time determines its order.

Backlog and Archive are dashboard organization states only: they do not stop tmux or Pi. Subagent rows follow their parent session and cannot be moved directly. Archived rows show compact elapsed ages and become eligible for dashboard cleanup after seven days. Cleanup occurs only after the archived parent and every subagent row are confirmed missing from tmux; it removes Hub registry, heartbeat, and owned workspace state and does not delete Pi conversation files.

Custom normal-mode dashboard shortcuts can be configured in `config.json`; see [Dashboard shortcuts](CONFIG.md#dashboard-shortcuts). They send one-line text to the selected live session without opening it and are intended for Pi-native commands such as `/session-name refresh`.

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

At session start/restart, Hub checks each selected repo root for `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`. When any exist, it writes a generated workspace `AGENTS.md` with labeled sections for each repo so Pi loads the combined instructions from the workspace cwd.

## Worktree model

Worktree sessions are opt-in and hub-owned:

```text
<PI_AGENT_HUB_DIR>/worktrees/<repo-name>/<session-id-prefix>-<branch-slug>/
```

New-session forms start with worktree mode on. Focus the Worktree row and press `Space`, or press `Ctrl+T` from anywhere in the form, to toggle it. Run `pi-hub config set worktree-default false` if you want every new form to start in normal-session mode instead. Then enter the branch name. Hub still uses the primary repo basename as the provisional title; Pi naming is independent. If extra repo rows are present, Hub creates one worktree per repo using that same branch name, then starts Pi in the same symlink workspace shape used by normal multi-repo sessions. Workspace `.pi` points at the primary source repo's `.pi`, not a worktree, so project state does not dirty the worktree.

Hub gives each managed parent agent a mapping from its Hub-owned runtime worktrees to the original repositories. `pi-tmux-subagents` children receive the same mapping when they inherit the optional prompt bridge. Agents make task and setup changes only in the worktrees. When required local configuration is missing, they may inspect the original repository and copy only the required files into the matching worktree; they must not modify the original repository for task setup or copy secrets unless the task requires them. Generated multi-repo workspace instructions include the same mapping.

Normal `d` delete is conservative: it removes the dashboard row, workspace, and heartbeat, but keeps hub-owned worktree files. From the delete dialog, `Shift+D` discards clean hub-owned worktrees and branches without merging. Press `w` on a clean hub-owned worktree session to stop its session/subagent tmux processes, merge each worktree branch into its recorded base branch, remove the worktrees, prune Git metadata, delete the merged local branches, and remove the dashboard row. Dirty worktrees or dirty base repos block finish so files are preserved.

## Non-goals

`pi-agent-hub` intentionally stays small:

- no cloud service;
- no custom agent runtime;
- no repo filesystem scanning;
- no broad Git/worktree manager beyond the explicit hub-owned create/finish flow;
- no Agent Deck remotes/tools registry clone.

Pi runs the agents. tmux keeps them alive. The hub gives you one stable place to see and steer them.
