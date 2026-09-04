# pi-agent-hub Features

`pi-agent-hub` keeps Pi coding-agent sessions alive in tmux and gives them a calm keyboard-driven dashboard.

## Daily loop

```text
pi-hub
  ↓
pick a session
  ↓
Enter to inspect/open
  ↓
work in Pi
  ↓
Ctrl+Q returns to the dashboard
```

## Core capabilities

| Capability | How to use it | Why it matters |
| --- | --- | --- |
| Long-running sessions | `n` creates, `Enter` inspects or opens | Sessions keep running in tmux instead of disappearing with a terminal. |
| Dashboard return | `Ctrl+Q` inside a managed session | Jump back to the hub without stopping the agent and complete the coached first request round trip. `Alt+Q` remains available to Pi for editing the last message. |
| In-session rename | `Alt+R` inside a managed session | Open the dashboard rename dialog for the current session, then return to it after saving. |
| Direct send | `p` in the dashboard | Paste and submit a one-line message into the selected live session without opening it. |
| Custom dashboard shortcuts | `dashboard.shortcuts` in config | Bind safe Pi slash-command sends, such as `/session-name refresh`, to dashboard keys. |
| Stable dashboard theme | `t` opens theme settings | Preview Pi global themes, save globally by default, or keep a Hub-only override without following session changes. |
| Attention-first cockpit | Default project view | See explicit requests first, then runtime health, active work, quiet work, and chronological archives. |
| Intent palette | `:` in the dashboard | Search target-aware actions, sessions through bounded context, and named filters without replacing direct keys. |
| Action workspace | Select a session; use `i` below 120 columns | Read positive task context, plain workflow position, exceptional guidance, and enabled actions without reading raw pane output. |
| Explainable status | `i` in the dashboard or `pi-hub explain <id-or-prefix>` | Inspect live tmux, heartbeat, read-state, runtime-decision, cockpit-placement, and workflow provenance without changing session state; `i` adds it to the workspace and the CLI prints it. |
| Multi-repo workspaces | `Alt+A` in the new-session form | Work across repos through a symlink workspace without moving or owning source repos. |
| Hub-owned worktree sessions | `Ctrl+T` in the new-session form, `w` to finish | Create Git worktrees under hub state for one or more repos and explicitly finish, forget, or discard them. |
| Project Skills | `s` picker | Attach Pi skills to the selected session's primary repo. |
| Project MCP servers | `m` picker | Enable MCP tools for the selected session's primary repo. |
| Subagent rows | Automatic when `pi-tmux-subagents` reports them | Expand or collapse selected trees with `←`/`→`; use Shift with those arrows for all trees in the current grouping. |
| Workflow rail + board | Automatic when `workflow-runtime` reports its ordered steps; `S` changes grouping | Switch from the attention cockpit to producer lanes: canonical workflow trees stay in their lanes and all other Active trees appear in `OTHER ACTIVE`. |

## Dashboard keys

| Key | Action |
| --- | --- |
| `n` | Create a new Pi session |
| `Enter` | Open/switch or restart the selected session directly at every width |
| `1`–`4` | Pin the selected live session into that exact free slot; refuse an occupied slot without replacing it |
| `P` | Pin into the lowest free slot, or focus the selected session's existing slot |
| `Alt+1`–`Alt+4` | Focus the corresponding occupied slot from anywhere in the dashboard tmux session |
| `x` | Close the selected session's pin without stopping Pi |
| `+` / `-` | Resize the main pin split by ten percentage points, clamped to 30/70 |
| `Ctrl+Q` | Return from a focused live pane to the sidebar and complete first-run coaching; `Alt+Q` remains available to Pi for editing |
| `/` | Filter sessions |
| `b` | Show or hide Backlog in the lifecycle filter (presentation only) |
| `:` | Search actions, sessions, and named lifecycle/status/group filters |
| `p` | Send a one-line message to the selected live session without opening it |
| `?` | Show help and status legend |
| `q` | Quit the dashboard |
| `i` | Toggle live status and cockpit-placement evidence in the selected session's action workspace |
| `↑↓` / `j` / `k` | Move selection |
| `r` | Open restart choices: `r` restarts selected, `n` starts a new conversation, `a` restarts all active sessions (not Backlog or Archived) |
| `R` | Rename the selected session in a cursor-aware form |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session |
| `Shift+F` | Open the fork group form, fork the selected session, name the new Pi session from the primary repo, clear inherited ticket/workflow metadata, and wait for verified compaction with a handoff instruction |
| `a` | Mark the selected waiting session read |
| `A` | Archive the selected session and close its pin if shown |
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
| `S` | Toggle the project cockpit ↔ read-only workflow board |

## Intent palette

Press `:` to expand a terminal-native command ledger from the dashboard footer. It preserves the current cockpit order and uses deterministic substring matching; it does not rank results, learn history, or persist queries. Direct keys remain available and `?` still opens full Help.

The palette includes built-in dashboard actions, valid configured dashboard shortcuts, current sessions, named lifecycle/status/group filters, and view/Help commands. Disabled actions stay visible with a concise reason and cannot execute. Action identities bind the exact session or project selected when they open a form or picker, so a later selection change cannot redirect submission.

Session results search only bounded Hub context: session identity and primary/additional project metadata, group, subagent identity/task, lifecycle/status, ticket and explicit-attention metadata, and producer workflow context. Raw pane output and Pi conversation content are not searched. Activating a session result stays in Hub: it selects and reveals that exact current session, clears a fleet filter only when the filter excludes it, and never attaches, restarts, or acknowledges it. Use `Enter` afterward to inspect or open the session.

`/` remains the faster free-text fleet filter. Named palette filters use the same fleet filter state. Lifecycle clauses use OR semantics, for example `lifecycle:archived,backlog`; text narrows the selected lifecycle set. The canonical filter context and palette show the active lifecycle selection. `b` toggles only Backlog in that set; lowercase `b` changes presentation visibility, while uppercase `B` still moves the selected session to Backlog. The complete text and lifecycle selection persist in `ui-state.json`. `Escape` closes the palette without changing an existing filter.

## Status vocabulary

```text
● running or starting
◐ waiting
○ idle/read
× error
- stopped
```

Runtime symbols describe liveness only. A waiting row does not imply an explicit request. Any blocking Pi UI prompt reports `waiting` for its prompt span, then restores the prior runtime state; only producer context can turn that wait into explicit attention. The default project cockpit groups complete owner trees into nonempty tiers: `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, then `ARCHIVED`. `NEEDS YOU` requires producer-confirmed attention on a waiting/idle owner. `HEALTH` requires an owner runtime error. `ACTIVE` requires a starting/running owner or descendant. Other non-archived trees appear in `QUIET`. A running child can activate its owner tree, but child attention/error never promotes the owner and tier placement never changes row status, workflow, lifecycle, or attention. Explicit attention on a child row absent from the visible projection appears as `?N child` on the tier and `?N` on the exact owner; each count disappears when that request row becomes visible through expansion, filtering, or exact reveal. During context compaction, the session shows `running` and then returns to its previous state. If compaction retries, it stays `running` until the next agent turn begins.

The action workspace shows positive decision content in one order: identity, explicit request, real task text, plain workflow position, exceptional guidance, and enabled commands. Missing categories contribute no rows. Duplicate status explanations and internal provenance labels stay out of the default view. `▸` marks the primary catalog action. At 120+ columns the workspace is persistent on the right. Below 120 columns, `i` opens the exact-session full-width workspace without attaching, restarting, or acknowledging; `Escape` returns to the fleet. `Enter` and session-row double-click open, switch, or restart directly at every width. Action clicks use the same exact-target catalog dispatcher as direct keys and `:`. Disabled commands stay discoverable only in the palette.

Press `i` to append `LIVE DETAILS` inside that same workspace. It reports useful tmux, heartbeat, read-state, runtime-placement, and workflow evidence after the normal content while suppressing routine absence text. Synthetic Archived/disclosure targets cannot open stale session information. `pi-hub explain <exact-id-or-unique-prefix>` prints the shared semantic evidence after one read-only full-fleet observation; it does not write registry state or provide status history. Raw pane output and Pi conversation content are never rendered or searched.

Backlog remains an independent organization state. Its rows carry a `backlog` tag and can still enter a higher tier when explicit attention, error, or active work requires it. Groups are muted row tags rather than project headings. Archived remains flat and globally newest-first. In project view, `NEEDS YOU` is always expanded; HEALTH, ACTIVE, QUIET, and ARCHIVED each have independent presentation-only collapse state, with counts and navigator entries retained. The complete lifecycle filter and tier-collapse preferences persist in `ui-state.json`; individual subagent disclosure remains ephemeral. Archived shows the newest five parent cascades by default and keeps nested rows in their parent's cascade. Select `… N older archived` and press `Enter` or double-click to expand; use `⌃ show fewer` to collapse. Filtering reveals matching rows without changing tier classification, tree expansion, or saved tier-collapse state. Stage grouping keeps Backlog/Archived summarized in the footer.

Sessions running the optional `workflow-runtime` extension also show a workflow rail on project parent rows as width permits. Its independent mode decoration appears as a short indicator such as `FOC`, even when no workflow rail is valid; Focus does not change lane, tier, ordering, or lifecycle. The action workspace translates the current position into plain language such as `Execute · step 2 of 5`. Running rows omit redundant activity age, while Archived rows retain their time-since-archive label. On the workflow board at 100+ columns, producer activity appears beside an eight-cell `■`/`□` plan bar when valid progress exists; the bar remains visible when long activity text truncates. Without activity, valid progress becomes the recap line. The runtime owns the ordered ids, short codes, friendly labels, activity, plan counts, and optional current-position completion; Hub does not mirror a workflow vocabulary.

Markers describe position, not an execution audit. Steps before the current position are checked even when a producer invokes a later step directly. The current marker is `◉` until the producer reports it complete, then becomes `✓`; later positions remain `·`. A final completed position can therefore retain an all-check rail while idle, stopped, stale, or resumed. A new producer snapshot replaces that state. Completion does not move a card to another lane or change liveness, attention, grouping, or lifecycle.

When Rules focus mode is active, its producer-owned display metadata substitutes `FOC` for the active `EX` short in project rows and uses the mode label in the action workspace. The card stays in the `EXECUTE` lane and reserves `FOC` at its right edge. Focus is display-only in Hub: it adds no lane, ordering priority, control, or animation. Stopped sessions retain their Execute lane but fall back to `EX` and omit stale focus detail.

Pressing `S` switches to the read-only workflow board. Compatible Active workflow parent trees stay in producer-defined vertical lanes. Every remaining Active tree—without workflow metadata or on an incompatible pipeline—appears afterward in synthetic `OTHER ACTIVE`, which deliberately implies no workflow position. Backlog/Archived parents remain summarized in the footer. If multiple pipeline versions are visible, the most prevalent ordered-id sequence wins deterministically and the newest compatible labels/short codes supply the vocabulary.

Every lane and `OTHER ACTIVE` nests cards under the existing top-level parent group, with parent-card counts on lane and group headings. Below 100 columns, board cards stay one line and group headings are suppressed; wider boards can show bounded card context and progress. Subagent trees start collapsed in both project and board grouping. Parents with descendants show `▸`; `→` expands the selected tree to `▾`, `←` collapses it, and adding Shift applies the action to all trees in the current grouping. `Space` remains a board selected-tree toggle. Revealed children stay directly nested and independently navigable; collapsing a selected child returns selection to its top-level parent. Active filters temporarily reveal matching ancestor/descendant context without changing expansion state. Top-level parent rows/cards add an independent `⚙︎N` when descendants are `starting` or `running`; waiting, idle, error, and stopped descendants do not count. Disclosure and the badge add no persistent state or parent-state promotion. `K`/`J` reordering remains project-grouping only.

There is no board feature flag. Install a producer that publishes the soft `workflow-runtime` contract, run `/reload` in an existing Pi session if needed, invoke its workflow, and press `S`. Rich ticket and attention context is optional and arrives through the producer-neutral [`pi-agent-hub-context`](CONFIG.md#generic-session-context) entry.

The project cockpit uses one adaptive row hierarchy. Active main parents use Pi's native name and add bounded explicit-request or ticket context plus ticket/group metadata as width and height permit. Backlog and Archived parents stay single-line. Subagents use compact micro rows with capped visual depth, agent name, task text, and their own status/attention; they do not inherit parent adornments. Missing fields collapse without blank placeholders, and pin mode keeps every fleet row single-line beside its decision strip. On normal 100+ column project and board surfaces, rich owner trees use one `│`/`└` gutter; only `NEEDS YOU` uses the warning tone. The whole visible owner tree receives the selection background, while `▌` remains on the exact selected session. Post-window decoration omits a gutter for a one-line survivor and never claims a false ending for a clipped tree.

At 100+ columns in normal project view, a fixed five-tier navigator shows presentation-owner counts for `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, and `ARCHIVED`. It is mouse-only: clicking a nonzero tier selects its first currently visible presentation owner, while keyboard navigation remains one target per session. The navigator stays composed with disabled zero counts during a no-match filter and is hidden in board, pin, narrow, and full-screen workspace modes. Collapsed tiers keep their counts and navigator entries. Fleet, navigator, separator, outer-border, and workspace hit regions never overlap.

Every visible parent continuation line is clickable: single-click selects its owning session and double-click opens or switches it directly at every width. Keyboard navigation still treats the card as one session. Under height pressure, Hub always keeps the selected title, then selected continuation lines and owning context as room permits; nearby titles outrank nonselected metadata, and no continuation appears without its owner title.

Attention is an independent overlay on waiting/idle rows: `✓` means a ready handoff, `?` an explicit question/choice, and `!` a blocker. Only explicit owner attention enters `NEEDS YOU`; waiting alone does not. For a structured Pi question, Hub shows the bounded first-question summary plus `+N more` and labels the primary action **Answer**. Answer focuses that exact session's existing pin when present or opens the managed session full-screen. Pi's questionnaire remains the only answer surface; Hub does not copy options, accept text, or send blind keystrokes. Running/error/stopped rows keep operational presentation, and subagent attention is never promoted to its parent. The action workspace keeps task and workflow facts separate from exceptional Hub guidance and enabled catalog actions. Workflow step, Hub runtime status, attention, and running-subagent count remain independent axes: the board never infers attention from waiting, promotes child state, advances workflow, dispatches skills, moves stages, or persists board state.

A first-time empty dashboard teaches this loop through the real project tier headers and footer. Coaching remains until Hub successfully acknowledges and opens one explicit request with a producer request ID and later receives a successful `Ctrl+Q` return. Locate, `a`, failed focus, ordinary waiting, and requests without IDs do not complete it. Board, pin, filter, dialog, and full-screen workspace views suppress coaching. Existing users get no full coaching: one versioned **NEW DAILY LOOP** row appears after `NEEDS YOU`, remains below real attention, and dismisses with `Enter` or double-click. Normal package updates do not revive it; only an intentional future cue ID does.

A waiting/idle attention payload with a producer request ID is also eligible for one transient delivery. Hub seeds requests present at dashboard startup without announcing them, then deduplicates fresh requests by exact session and request ID for the current dashboard process. A fresh request remains active for six seconds and, when layout permits, renders below the mode header. The managed dashboard tmux session also sends a six-second status message to attached clients that are not already showing the Hub pane, the exact managed session, or its exact pin; external messages and BEL run only from that dashboard session. Multiple arrivals share one band, and the newest exact request is the locate target. Clicking the band or choosing **Locate newest request** from `:` reveals that row without opening or acknowledging it. `Enter` and `a` retain their selected-row targets; acknowledging the exact current requesting row removes its active marker and recalculates cockpit placement using the acknowledgement/status boundary, while HEALTH, ACTIVE, and ARCHIVED precedence still applies. Delivery has no persisted history, and the optional palette-owned attention bell defaults to Off.

The fleet top line names `FLEET`, `WORKFLOW`, or `PINNED FLEET`. A full-width workspace starts with selected-session identity instead of a separate mode header. Fleet and board headers then fit owner-tree totals, nonzero pin count, `needs you`, health, and filter context at the right edge; filtered counts always use visible/total form. Active parent-row tails preserve a readable title, then degrade in attention order: age drops first, full workflow compacts, active-descendant count drops, workflow drops, and hidden `?N` survives longest. Backlog and Archived use their lifecycle-specific tails. Card richness and responsive width choices are derived per render and are never persisted. Press `?` for the full help/legend and `i` for live evidence in the selected session's action workspace.

## Dashboard themes

Press `t` for the same built-in and globally available theme choices used by Pi Settings → Theme. Moving over fixed choices previews immediately. Automatic expands separate light/dark choices; use `←`/`→` to change either choice. `Space` toggles **Sync to Pi**, `Enter` applies, and `Escape` restores the opening theme.

Sync defaults on: confirmation updates Pi's global default, applies the resolved theme once to current managed parent sessions, and lets future Pi processes inherit it. Turn sync off to persist a Hub-only override without touching Pi. Re-enabling sync pushes the visible Hub choice back to Pi. Project-local themes are excluded, subagents are not propagation targets, and opening/selecting differently themed sessions never recolors the dashboard. See [Theme behavior](CONFIG.md#theme-behavior) for Automatic and persistence details.

## Dashboard tmux behavior

Running `pi-hub` uses one stable tmux session named `pi-agent-hub`:

- outside tmux: create or attach `pi-agent-hub`;
- inside tmux: create it detached if needed, then switch the current client to it.

The dashboard runs the current CLI file's `tui` command inside tmux so it does not recursively create dashboards or depend on a stale `pi-hub` on PATH. It also applies its own tmux status bar instead of inheriting global tmux theme chrome.

`Enter` switches the current tmux client to the selected live session and briefly shows the equivalent `tmux switch-client -t <session>` command at every width. For explicit questions, the same command is labeled **Answer** and first checks for an exact existing pin. On a stopped or error session, the action restarts it instead of attempting to attach. Opening a `waiting` session marks it read before attaching, so it can show `idle` after you return; opening the workspace with `i` does not acknowledge it, and `a` remains the manual mark-read shortcut.

### Sidebar workspace

Use `1`–`4` in the dashboard to pin the selected live session into an exact free slot. Slots 1–2 are available when the whole tmux window is 100–159 columns wide; slots 1–4 are available at 160 columns or wider. `P` chooses the lowest free available slot. If the selected session is already pinned, `P` or its current number focuses that pane. Assigning a different session to an occupied slot is refused with the occupant's title; Hub never replaces, swaps, retargets, or silently evicts a pin. `x` closes only the selected session's pin and never stops its Pi session.

Slot numbers are stable while panes remain attached. At 100–119 columns, slots 1 and 2 stack; at 120–159 they sit side by side. At 160+, slots map to a 2×2 topology (`1` top-left, `2` top-right, `3` bottom-left, `4` bottom-right). Holes remain visible in the `PINNED` summary while occupied columns or rows expand to use available space. `▢N` marks an inactive pinned row, `▣N` marks the focused pin, and pane chrome starts with `LIVE N · <title>` plus owner/ticket context when it fits. `+` and `-` change the main split in ten-point steps from 30/70 through 70/30; a single occupied column resizes vertically.

Guarded `Alt+1`–`Alt+4` bindings focus occupied slots from either the sidebar or another live pane. `Ctrl+Q` returns to the sidebar. `Alt+Q` is not a Hub binding, so Pi can use it to edit the last message. `Alt+Arrow` remains an optional geometry-based alias, but terminal word-navigation mappings can consume modified left/right arrows; numeric focus or tmux prefix plus arrows avoids that conflict. Pin creation keeps sidebar focus and does not acknowledge waiting attention. Explicit focus, spatial focus, return, and full-screen `Enter` reveal the exact session and acknowledge waiting state before focus. While pins exist, the sidebar keeps a compact decision/evidence strip; `i` toggles evidence and `Enter` opens the selected session directly.

Capacity contraction never closes or renumbers existing slots. The layout becomes constrained and blocks new assignment or resizing until the window widens or a pin closes; closing remains safe even when slots 3–4 survive below their normal width. Failed rebuilds restore the prior slot attachments when possible, and an occupied-slot refusal performs no pane mutation.

Slot metadata is transient and self-healing. `@pi_hub_slot` lives only on the tmux pane, never in Hub registry or disk state. Live inspection combines that tag with pane ID, tty-to-managed-session mapping, and geometry; missing or duplicate tags are repaired deterministically, duplicate attaches are reconciled, and user-created panes are ignored. Pin mutation, focus, presence reconciliation, handoff, and shutdown share one serialized lifecycle queue. Rebuilds pre-size managed windows for final geometry, split at final size, and restore `window-size latest`; unexpected preparation failures enter rollback instead of being hidden. A pinned session's own footer is restored when its pin closes or before that session enters full screen. Shared dashboard status, pane-border chrome, and pin bindings remain active while any pin exists; they are restored after the final pin closes or during dashboard shutdown.

If the dashboard tmux session is missing, the temporary return binding recreates it before switching back.

## Return shortcuts

Return shortcuts from a managed `pi-agent-hub-*` session:

| Key | Action |
| --- | --- |
| `Ctrl+Q` | Return to the dashboard and complete a pending first-run request round trip |
| `Alt+Q` | Reserved for Pi message editing; Hub does not intercept it |
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
| `Ctrl+N` / `Ctrl+P` | In the new-session form, cycle known cwd suggestions; in the move-group form, cycle groups; in the command palette, move selection. A configured Ctrl+N shortcut runs only in normal dashboard mode. |
| `Ctrl+O` | Open the recent-repo picker |
| `Ctrl+T` | Toggle hub-owned worktree mode |

Extra repos are symlinked into one runtime workspace. Project rows place an accented `⎇` before a worktree title and show a dim compact `⧉ N` badge after a multi-repo title; the selected-session workspace retains the full branch and compact `⧉N` repository count. The primary cwd remains the main project for skills and MCP state. Hub exports that `ManagedSession.cwd` as `PI_AGENT_HUB_PRIMARY_CWD` to every managed parent process so producer extensions can resolve project-local files when Pi runs from a multi-repo workspace or resumes fork-origin history. It never exports the workspace path or an extra repo as the primary cwd. Hub uses the primary repo basename as a provisional dashboard label until Pi publishes its canonical native session name.

When worktree mode is enabled, the `branch` field creates the same new local branch in every selected repo. It does not control the session name.

## Groups and session actions

Groups are simple labels on sessions. Moving a session to a new label creates that group, and renaming a group updates every session currently using that label. In the project cockpit, groups appear as muted row metadata when width permits. Active and Backlog source rows retain stable `default`-first group order. Inside each group, errors come first, followed by unacknowledged `waiting` rows newest-first, `starting`/`running` rows, acknowledged waiting/idle rows by activity, and stopped rows. The cockpit stable-partitions those complete trees by attention tier while preserving source order inside each tier. Manual row order breaks exact priority/activity ties, so `K`/`J` move a row only inside such a tie. Reordering is disabled while a filter is active and unavailable in Archived because archive time determines its order.

Backlog and Archive are dashboard organization states only: they do not stop tmux or Pi. Archiving closes the selected session's pin if shown; moving to Backlog does not. Subagent rows follow their parent session and cannot be moved directly. Archived rows show compact elapsed ages and become eligible for dashboard cleanup after seven days. Cleanup occurs only after the archived parent and every subagent row are confirmed missing from tmux; it removes Hub registry, heartbeat, and owned workspace state and does not delete Pi conversation files.

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

New-session forms start with worktree mode off. Focus the Worktree row and press `Space`, or press `Ctrl+T` from anywhere in the form, to toggle it. Run `pi-hub config set worktree-default true` if you want every new form to start in worktree mode instead. Then enter the branch name. Hub still uses the primary repo basename as the provisional title; Pi naming is independent. If extra repo rows are present, Hub creates one worktree per repo using that same branch name, then starts Pi in the same symlink workspace shape used by normal multi-repo sessions. Workspace `.pi` points at the primary source repo's `.pi`, not a worktree, so project state does not dirty the worktree.

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
