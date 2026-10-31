# pi-agent-hub Features

`pi-agent-hub` keeps Pi agents alive in tmux. Supervise them and reply from one session list.

## Daily loop

Start `pi-hub` and press `n` to create a session. Then work from the list:

```text
] Next request → Tab Answer or p Reply → ] Next request
```

Every selected parent session card frames the no-pin list, open-sided at 30 columns. Its border uses the request color when the session needs you, the health color for an error, and a muted color otherwise. `i` Details; `Enter` opens Pi; `Ctrl+Q` returns; Pi's `Alt+W` opens the next request.

Pins and follow view are opt-in. Use `P` to keep a live session beside the list, or `o` for one pane that follows selection. `Alt+1`–`Alt+4` focuses a pin; `Ctrl+Q` returns.

## Core capabilities

| Capability | How to use it |
| --- | --- |
| Long-running sessions | `n` creates; `Enter` opens or restarts. tmux keeps sessions alive. |
| Attention-first dashboard | Status view separates explicit requests, errors, running work, quiet sessions, and archives. |
| Repository grouping | `v` switches between Status and Repo views. |
| Live pins | `1`–`4` assigns a free slot; `P` chooses the first free one. |
| Follow view | `o` shows the selected session beside the list and follows the selection. |
| Search and actions | `/` filters; `:` finds actions, sessions, and named filters. |
| Task context | Fleet cards keep the task and request separate, with workflow position and selected-session actions. |
| Card answers | `Tab` answers supported questions without opening Pi. |
| Conversation | `c` shows read-only completed messages and question/answer history below the fleet. |
| Explainable status | `i` or `pi-hub explain <id-or-prefix>` shows the evidence behind status and placement. |
| Reply | `p` edits a reply on the card: Send while idle, or Steer/Queue while busy. |
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
| `o` | Turn follow view on or off |
| `Ctrl+Q` | Return to the dashboard from a managed session or pin |
| `/` | Filter sessions |
| `b` | Show or hide Backlog in the current filter |
| `:` | Search actions, sessions, and named filters |
| `]` | Select the next visible session that needs you, without opening it |
| `Tab` | Answer a supported pending question on the selected card |
| `n` / `C` / `O` in answer focus | Edit this question's note / toggle Context / show Original; text editors keep literal keys |
| `p` | Reply on the selected live parent's card |
| `c` | Show or hide Conversation below the fleet |
| `?` | Show help and status legend |
| `q` | Quit the dashboard |
| `i` | Toggle Details in the selected fleet card or pinned strip; below 120 columns the board opens its full-width view |
| `↑↓` / `j` / `k` | Move selection |
| `←` / `→` | Collapse / expand the selected subagent tree |
| `Shift+←` / `Shift+→` | Collapse / expand all trees in the current view |
| `Space` | Toggle the selected tree on the workflow board |
| `r` | Restart choices: `r` resume selected, `n` new conversation, `a` restart all Active parents |
| `R` | Rename the selected live, unlinked session |
| `d` | Delete or forget the selected session |
| `f` | Fork the selected session through the group-selection form |
| `F` | Choose a group, fork, clear inherited ticket/workflow metadata, and compact |
| `a` | Mark the selected session read; this also clears an open question or blocker from `NEEDS YOU` |
| `y` | Copy the selected handoff's evidence path |
| `A` / `B` / `U` | Archive (Done, Abandoned, or archive only) / move to Backlog / restore or reopen to Active |
| `w` | Finish the selected hub-owned worktree session |
| `N` | Sync the Hub title from Pi's saved name |
| `g` / `G` | Move a session to a group / rename its group |
| `K` / `J` | Reorder tied Active/Backlog rows within their group in Status view |
| `Shift+↑` / `Shift+↓` | Same as `K` / `J` |
| `s` / `m` | Pick project skills / MCP servers |
| `Alt+E` | Edit the skill pool path inside the skills picker |
| `t` | Preview and configure the dashboard theme |
| `v` | Toggle Status / Repo fleet grouping |
| `S` | Visit the workflow board or return to the chosen fleet grouping |
| Click / double-click | Select / open a session; double-click folds a section header. In dialogs, click selects, double-click confirms, and footer hints are tappable; Delete and Finish choices need keys |

Session actions apply to the exact selected row. Section headers are not sessions. Unavailable actions appear with a reason in `:`.

Press `?` for a static reference grouped into Session actions, Pins, Views, and Filters, followed by navigation, dialogs, and the status legend. Help uses base action names and primary keys even when no session is selected; it does not show availability. Keys stay aligned on the right. At 160+ columns, sections use two columns. Palette-only filters have no key and share the note `via : palette`. Use `↑` / `↓` or `PgUp` / `PgDn` to scroll, and `Esc` to return.

## Conversation

Press `c` to read the selected live parent's completed messages below the fleet. Close pinned panes or leave follow view first. `YOU` and `PI` headings separate messages. `PgUp` / `PgDn` scroll history; `End` returns to the latest messages. A working indicator appears while Pi runs.

Conversation is read-only. It shows completed text and validated question/answer history, not tools, thinking, or streaming fragments. It reads the live bridge without saving a second transcript or searching messages. Opening or hiding it neither answers nor cancels a request. Stopped sessions require Restart. After updating Hub, reopen the dashboard and run `/reload` in existing idle Pi sessions if their extension changed.

## Answer from a card

`Tab` opens questions and closes Conversation. Board/pin/follow panels share content, without an extra frame.

- Ask first, conditions indented. `C` Context / `O` Original change display only; ambiguity keeps original text.
- Filled `[1]` tiles mark cursors, not checks. `[Recommended]` needs an explicit marker, never inferred.
- Numbers/`↑`/`↓` choose; numbers/`Space` toggle multi-select. `t`/**Type something.** edits literal text. A catch-all may share the row; its number and custom route stay distinct.
- `n` edits per-question notes (8,192 UTF-16 units). `Enter` saves; `Esc` returns, keeping them. Notes stay exact-request-bound and send with that question, never as its answer.
- Outside input, `←`/`→` visits questions; `Enter` confirms/advances or sends all confirmed answers. `Esc` leaves input, then focus without declining; `Tab` restores choices.
- `PgUp`/`PgDn` scroll. Descriptions: all at 100+, cursor only below. Exact live-call previews appear when available; **preview in Pi** remains answerable.

Answers require [rpiv 2.15.0+](CONFIG.md#inline-questions) official events. `Tab` explains unavailable questions, keeping **Open in Pi**; older Hub bridges request `/reload` in Pi. Native/Hub submissions race; first valid answer wins. **Submitting**, **✓ Sent · Accepted**, **Rejected**, or **Delivery unknown** stays visible. Accepted never moves selection; unknown delivery never retries. Check Pi before retrying.

## Reply

Press `p` to edit a reply on the selected live parent's card. `Enter` sends; `Esc` leaves focus and keeps the draft in dashboard memory. `Ctrl+U` clears it. Reopening restores the draft for the exact Pi conversation and bridge instance; restart or replacement drops it. A new draft for a ready handoff starts with `Go ahead: <recommendation>` when one exists. Nothing sends until you press `Enter`.

Idle Pi offers **Send**. Busy Pi starts with **Steer now**, which delivers before its next model call after current tool calls finish. Press `Tab` to focus delivery and `←` / `→` to choose **Queue for later**, which delivers after the run. Press `Tab` back to the text and `Enter` to submit. If idle Pi becomes busy before submission, Hub rejects the send without losing text and exposes the busy choices.

Replies use Pi's exact-session bridge without changing its editor draft. Idle Send expands commands and prompt templates; busy Steer/Queue send literal text. Card feedback uses **Submitting**, **Accepted**, **Rejected**, or **Delivery unknown**. Accepted means dispatch, not task completion. Unknown delivery never retries automatically; check Pi before retrying. Use `]` to move on.

After updating Hub, reopen the dashboard and run `/reload` in existing Pi sessions once idle to enable the bridge. New sessions load it automatically.

## Repo grouping

`v` groups complete parent/child trees alphabetically by repository: errors and unanswered requests first, then other trees by last interaction, newest-first. Open, focus, answer and send count as interaction. Archived stays separate, newest-first. `[group]` sits in selected card frame tops (metadata if needed), below other rich titles, or before Backlog/Archived titles.

Repository identity comes from the primary source path. Hub-owned worktrees stay with their source repo; multi-repo sessions appear once under their primary repo. Different folders with the same name remain separate. The selected card shows repository context.

Select a repo header and press `Enter`, or double-click it, to fold the section. Header counts show parent sessions and requests; hidden child requests have a separate count. Filters temporarily reveal matching repos. Hub saves the Status/Repo choice, but repo folds reset on dashboard launch.

`S` visits the workflow board and returns to your chosen fleet view. `v` and manual row reordering are unavailable on the board; reordering is also unavailable in Repo view.

## Fork and compact

`F` creates a child with the default fork name. Rules must confirm that the child's inherited ticket and workflow are cleared before Hub starts compaction. Hub reports success only after compaction finishes and the child still has no linked task. The source conversation and project files stay unchanged; the child retains compacted discussion context.

Use matching updated Hub and Rules extensions. If Rules is missing, disabled, or cannot confirm the reset, Hub reports an error and does not start compaction. The child stays available for inspection. Enable or update Rules, then retry Fork and compact from the original session. Compaction errors and timeouts also leave the child available; a timeout does not mean compaction succeeded or stopped.

Normal `f` forks retain ticket ownership and do not request this reset.

## Intent palette

Press `:` to search built-in actions, configured shortcuts, current sessions, and named filters. Session search includes names, repos, groups, tasks, tickets, requests, and workflow context. It never searches raw pane output or Pi conversation content.

Selecting a session result reveals and selects it in Hub. It does not open, restart, or mark it read. Press `Enter` afterward to open it. Disabled actions stay visible with a reason. `Esc` closes the palette without clearing the dashboard filter.

## Session filters

Use `/` for a live text filter. The `FILTERING` bar above results shows input focus. `Enter` applies the draft and returns to navigation; an empty draft clears the filter. `Esc` cancels editing and restores the filter that was active before the edit.

Applied filters show a `FILTERED` bar, including filters restored on launch. When space allows, `N hidden` counts owner trees excluded by the filter, not folded or offscreen rows; the workflow board counts only Active trees. Use `/` to edit or `Esc` to clear from the normal dashboard. With no registered sessions, a restored filter offers only `Esc` to clear.

Named filters share the same filter state. For example, `lifecycle:archived,backlog release` finds matching text in either lifecycle bucket. Lowercase `b` changes Backlog visibility; uppercase `B` moves the session to Backlog. Hub saves the text and lifecycle filter.

## Status vocabulary

```text
● running or starting (only the selected row animates)
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
| NEW | A new or forked parent you have not opened, focused, answered, or sent to yet |
| ACTIVE | A running/starting parent or child |
| QUIET | Other non-archived sessions |
| ARCHIVED | Archived trees, newest-first |

Click a tier count in the Status header, such as `NEEDS YOU 3`, to select its first session and reveal the section without opening or marking it read. Zero counts are hidden; narrow headers show fewer tiers. Repo, board, and pinned summaries are not clickable.

A waiting session alone does not enter `NEEDS YOU`. A running child can put its tree in `ACTIVE`, but a child's request or error does not become the parent's state. Hidden child requests show as `?N` on the parent and a child-request count on the section. Expand the tree to inspect them.

`NEEDS YOU` and `NEW` stay expanded. Other Status sections can fold, and Hub saves those preferences. A folded `ACTIVE` or `QUIET` header shows `◐ N unread` when it hides parents with an unread finished reply (the yellow `◐`). Filters reveal matching rows without changing their classification. Active fleet parents give titles their own line, including in the pinned sidebar. The next line shows `[group]`, `⧉ N` for multiple repos, an Execute task count when reported and space allows, and workflow markers aligned under shared step labels. A parent you have not opened yet shows a `new` badge after its title until your first open, pin focus, answer, or send; Status omits it under the `NEW` heading, and Repo, board, and pinned views keep it. The worktree marker follows the title, before any `new` badge: `⎇` is active, `⎇…` awaits merge, `⎇!` needs cleanup or verification, and `⎇✓` means directory cleanup was verified. When worktree lifecycle evidence is present, selected-session controls show owner, branch, source and worktree paths, per-repository state, outcome, and verification. A cleaned marker does not by itself mean changes were merged. `⚙︎N` counts running/starting descendants. Backlog and Archived rows stay single-line.

### Details

The selected fleet card expands in place. It keeps the task and request separate and adds whole `key Label` actions that fit the width. A collapsed question leads with its asking sentence. While a request is shown, the activity label is hidden, and a guidance line appears only for a concrete obstacle such as reloading Pi. Under a section header that names the steps, the frame's top edge carries the progress markers, and a branch with no repo name beside it follows the group. Worktree paths appear in Details. **All actions** opens `:`. `Enter` and double-click open, switch, or restart Pi at every width. Action items also accept a single click.

Press `i` to toggle `LIVE DETAILS` inside the card. Details show tmux presence, heartbeat, read state, and the evidence behind runtime status and placement. The CLI equivalent is `pi-hub explain <exact-id-or-unique-prefix>`; it observes the fleet without updating the registry. Neither view captures pane tails or searches conversations.

Only the board keeps a side workspace at 120+ columns. Below 120, `i` opens its full-width view and `Esc` returns. Board and pin actions put labels first and keys on the right; an accent `▌` and bold label mark the primary action. They retain identity, closure, request, task, workflow, and available actions when present. During Execute, a reported plan adds phase, counts and the first unchecked task, not proof of current activity. Progress bars stay on the board.

### Requests and notifications

Optional extension attention uses `✓` for a ready handoff, `?` for a question, and `!` for a blocker. Hub displays it on waiting/idle rows only, in place of the runtime glyph. Runtime status remains separate in Details. A handoff can add a recommendation (`→`) and an evidence path or URL (`▤`) below the request; press `y` or choose **Copy path** to copy that path on macOS. On other systems, copy the visible path manually. Rules publishes `✓` and `!` only when the agent calls its `hand_off` tool. For supported pending questionnaires, **Tab Answer** opens the card panel. Other questions and subagents offer **Open in Pi**. Selecting, reading, or marking a handoff read never approves it; a reply approves only what it says.

While you work inside a managed session, its bottom bar shows `⚑ N need you · alt+w next` when other sessions need you. `Alt+W` opens the top one, the same way `Enter` does from the dashboard.

Opening or explicitly focusing a waiting session marks it read. Pin creation, search results, and opening details do not. Use `a` to mark it read manually. Reading does not answer: an open question or blocker stays in `NEEDS YOU` until you answer it, the agent moves on, or you press `a`. A read handoff leaves `NEEDS YOU`.

Fresh requests with producer-supplied IDs can show a six-second notification band and a tmux message when you are elsewhere. Click the band or choose **Locate newest request** in `:` to reveal the session without opening it. **Attention bell** and desktop notifications (`dashboard.attentionNotify`, see [Configuration](CONFIG.md#desktop-notifications)) are optional and off by default. Requests already present when Hub starts do not announce themselves again.

Managed parent sessions always receive a dashboard agent note that asks them to use `ask_user_question` and `hand_off` when available, with context, a recommendation, and handoff evidence.

An empty first-run dashboard teaches create, open a request, and return with `Ctrl+Q`. That coaching ends after the first successful request round trip. The dismissible daily-loop cue teaches `Tab`, `p`, `Enter`, safe `Esc`, and `Alt+W`.

### Workflow board

Press `S` to see Active session trees in workflow lanes. A compatible Pi extension supplies the steps and current position. Sessions without compatible workflow data appear in `OTHER ACTIVE`; Backlog and Archived stay summarized in the footer. Each lane groups parent sessions by their existing group labels.

Rules supplies Plan → Execute → Review → Reflect → Commit. Other producers can supply their own ordered steps. Hub's board is read-only: it does not dispatch skills, advance stages, or infer completion from an idle agent.

Step checks show position, not an execution audit. Earlier positions are checked; the current position is active until the producer reports it complete. Later positions remain pending. A stopped session can retain its last workflow position.

At wider sizes, board cards show activity and plan progress when available, with the reported phase above the task bar. Full no-pin Active cards show title, group/repo/branch metadata, task, then request. Branch drops before repo as width shrinks. The workflow grid appears at 80+ columns, a plain step below 80, and task counts/age at 160+. At 100+ columns, incomplete live activity and plan phase appear below the request. Selected task/request text scrolls instead of being dropped; short panes drop optional neighbor lines first. At 61+ columns, if two-line fleet rows still do not fit, unselected Active parents use one line before scrolling; the selected tree keeps more detail when space permits. When the whole fleet fits, a blank line separates cards in a group. Rules' active focus mode displays `FOC` without creating another workflow lane. Task progress, workflow position, runtime status, and requests remain separate facts.

Subagent trees start collapsed in both fleet and board. Use `←` / `→` for one tree, Shift with those arrows for all trees, or `Space` on the board. Filtering reveals matching child context without changing saved section preferences. Each visible child remains independently selectable.

## Dashboard themes

Press `t` to choose a built-in or globally available Pi theme. Moving between fixed choices previews immediately. Automatic offers separate light/dark choices; use `←` / `→` to change them. `Space` toggles **Sync to Pi**, `Enter` applies, and `Esc` restores the opening theme.

Sync is on by default. Confirmation updates Pi's global default and applies it to current managed parent sessions. Turn sync off for a Hub-only theme. Opening differently themed sessions does not recolor the dashboard. See [Theme behavior](CONFIG.md#theme-behavior) for details.

## Dashboard tmux behavior

`pi-hub` uses one tmux session named `pi-agent-hub`. Outside tmux, it creates or attaches to that session. Inside tmux, it switches the current client to it. `pi-hub tui` runs directly without that wrapper.

`Enter` switches to the selected live session and shows the equivalent tmux command. A stopped or error session restarts instead. Opening a waiting session marks it read. `q` quits the dashboard, not its managed agents.

### Sidebar workspace

Use `1`–`4` to assign a live session to an exact free slot, or `P` for the lowest free slot. If it is already pinned, `P` or its current number focuses it. An occupied slot refuses another session; Hub never replaces or evicts it. `x` closes only the selected session's pin.

| Terminal width | Available layout |
| --- | --- |
| Below 100 columns | No new pins; existing pins hide (see [Phone and small terminals](#phone-and-small-terminals)) |
| 100–119 | Two pins in any slots, stacked |
| 120–159 | Two pins in any slots; 1+3 or 2+4 stack, other pairs sit side by side |
| 160+ | Four pins in a 2×2 layout |

### Follow view

Press `o` with a live session selected, no pins open, and at least 100 columns. One pane opens beside the list and shows the selected session. When you stop moving the selection for about 200 ms, the pane switches to the new session. Keyboard focus stays in the list.

- `Enter` or double-click on a live row moves typing into the pane, like focusing a pin. It marks a waiting session read. `Ctrl+Q` returns to the list.
- `Enter` on a stopped or error row restarts it, as usual. The pane keeps the last live session, and its title names the selected row's state.
- The Open action in the selected-session controls or `:` palette still opens Pi full screen.
- Switching the pane never marks a session read, changes its order, or counts as interaction.
- Follow view and pins do not mix: `o` asks you to close pins first, and pin keys ask you to leave follow view first.
- Below 100 columns the pane hides like pins and returns, still following, when the window widens.
- `o` again closes the pane. Pi keeps running.
- Follow view is off by default. Enable **Follow view by default: On** to open it at startup and reopen it on the next live selection after you archive, stop, or delete the session it shows. After `o` closes it, it stays closed until you press `o` again. It does not open while pins or Conversation are open. Use **Follow view by default: On/Off** in the `:` palette to change the default; see [Follow view default](CONFIG.md#follow-view-default).

Slot numbers keep their 2×2 positions: 1/2 are top-left/top-right and 3/4 are bottom-left/bottom-right. Empty rows or columns give their space to occupied ones. `▢N` marks a pin; `▣N` marks the focused pin. `+` / `-` changes the main split in ten-point steps within 30/70.

`Alt+1`–`Alt+4` focuses occupied slots from the sidebar or live panes. `Ctrl+Q` returns to the sidebar. `Alt+←`/`Alt+→` is an optional spatial alias; some terminals consume it for word movement, so numeric focus is more reliable. Hub never binds `Alt+↑`/`Alt+↓`, because Pi uses `Alt+↑` to edit queued messages.

Shrinking the terminal preserves pins and slot numbers. Hub blocks new pins and resizing when the layout is too small; closing pins still works. Pin creation keeps dashboard focus and does not mark a request read. Explicit focus does.

Pins are live tmux attaches, not copied output. Closing a pin leaves its Pi session running. If the dashboard tmux session is missing, the managed-session return binding recreates it before switching back.

### Phone and small terminals

A phone and a desktop can attach to the same dashboard. tmux sizes the shared window to the client you used last.

- Below 100 columns, Hub hides open pins and gives the dashboard the whole window. Pins keep running. Rows keep their `▢N` markers, and the header shows `N pins hidden`.
- `Enter` or `Alt+1`–`Alt+4` opens a hidden pin full screen. Back on a desktop-size window, Hub restores the pin layout.
- At ≤60 columns only the outer frame drops; the selected parent card frame remains, with open sides below 40. The footer starts `] Next request · p Reply · : All actions · ? Help`, or `] Next · p Reply · : Actions` below 40. Trailing items drop whole; tap to run their key.
- No-pin fleet cards use a plain workflow step below 80 columns. Board/pin rows switch below 40. The dashboard works down to 30 columns, including answering and replying.
- Below 100 columns and 20 rows, unselected fleet neighbors use one line. The selected card keeps task/request content. Focused Answer/Reply panels reserve identity and local keys while their body scrolls. If no body row fits, use **Open in Pi**. The narrow board alone has a tappable `Esc Back` full-width view.
- Inside a session, tap `ctrl+q return` (or `⌂ hub` on narrow clients) in the status bar to return. Tapping needs tmux 3.4+ and `set -g mouse on`; Hub does not change mouse handling inside Pi sessions.

## Return shortcuts

| Key inside a managed session | Action |
| --- | --- |
| `Ctrl+Q` | Return to the dashboard; with tmux 3.4+ and mouse on, a tap on the status-bar return hint also works |
| `Alt+Q` | Pi message editing; Hub does not intercept it |
| `Alt+R` | Open Hub's rename dialog, then return to the session after saving |
| `Alt+W` | Open the top session that needs you, other than this one |

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

Bracketed directory and option values are editable fields, `▾` marks a picker, and actions are listed separately. The focused control changes the help/error area near the bottom; the footer controls stay fixed.

A favorite stores a name and an ordered set of directories, with Primary first. Applying one replaces the draft directories and seeds the editable Group from the favorite name. It does not change the worktree choice or branch and never starts a session. In the favorites picker, use `Ctrl+U` to start updating from the current draft, `Ctrl+R` to rename, and `Ctrl+X` to start removal. Update and removal show a confirmation screen; press `Enter` to confirm.

The recent-directory picker uses known paths, not filesystem scanning. Additional directories become links in a runtime workspace. The primary directory owns skills and MCP configuration.

When worktree mode is on, enter a branch name. Hub creates the same branch in every selected repo. The branch does not control the session name. Worktree mode starts off unless `worktree-default` is configured.

## Session names

New sessions and fresh-conversation restarts use `New · <repository>`. Forks use `Fork · <source session name>`. Duplicate defaults gain ` · 2`, ` · 3`, and so on. Worktree sessions use the source repo's folder name.

These are Hub titles, not Pi names. New conversations start unnamed in Pi so a producer such as Rules can name them from the first request. Forks pass their title to Pi as `--name`, because Pi copies the source session's name into the fork. Manual or agent naming can replace an unlinked session's name; resuming a saved conversation preserves it. `R` renames a live session, and `N` syncs from Pi's saved name.

With Rules installed, a linked ticket owns the name. It identifies the task, not the workflow stage. Hub disables Rename while ticket context is present. In Pi, use `/wf-ticket clear` to unlink the ticket while keeping workflow progress, or `/wf-clear` to clear both. Both stop Focus continuation and release name protection without changing the current name or ticket files. Dismissing only the completed workflow indicator keeps the ticket linked.

Normal Hub forks retain the ticket. Native Pi forks clear it in the child. See [Fork and compact](#fork-and-compact) for the verified reset and failure behavior.

## Groups and session actions

Groups are labels, not project records. `g` moves a session to a label, creating it if needed; `Ctrl+N` / `Ctrl+P` cycles known groups in the dialog. `G` renames the group for every session using it.

Within Status sections, errors and unread waits come first across all groups; every other session follows by last interaction, newest-first, whatever its runtime status. Your own open, pin focus, answer, or send counts as interaction. `K` / `J` breaks exact priority/activity ties only, and is unavailable while filtering or in Repo/board views. Archived always uses archive time.

Backlog and Archive do not stop tmux or Pi. Archiving closes the session's pin; Backlog does not. Children follow their parent's lifecycle and cannot move independently.

Archived shows five recent parent trees by default. Select the older-items row and press `Enter` to show more. After seven days, dashboard cleanup can forget an archived tree only when every parent/child tmux session is confirmed gone. It removes Hub records and owned symlink workspaces, not Pi conversations or worktrees.

Configured [dashboard shortcuts](CONFIG.md#dashboard-shortcuts) send one-line text such as `/session-name-refresh` to a selected live session without opening it. They are Pi commands, not shell macros. Configured commands require an idle session with no queued messages, blocking prompt, or editor draft. They use Pi's input pipeline; `p` opens the card Reply editor instead.

### Session closure

Press `A` on an open parent to choose `d` **Done**, `x` **Abandoned**, or `a` **Archive only**; `Esc` cancels. Every choice archives the session and closes its pin without stopping Pi or running children. It does not complete the workflow, edit the ticket, or delete conversations or worktrees. Archive only records no outcome, and workflow completion never closes a session. On an open archived parent, `A` can still record Done or Abandoned; Archive only changes nothing.

Press `U` on a closed parent to clear its outcome and return it to Active. `A` and `B` are unavailable until you reopen, so changing an outcome means Reopen, then Archive again. Closure survives dashboard restart and refresh. Opening or resuming the conversation keeps it closed; choosing a new conversation in Restart choices clears the old outcome but keeps its bucket. Archive and Reopen are also available in the command palette and selected-session controls.

Archived rows keep their runtime icon on the left. The right-side meaning is separate:

| Right-side marker | Meaning |
| --- | --- |
| `EX ◉` | Open session, currently at Execute |
| `CM ✓` | Open session, Commit complete |
| `✓` | Explicitly closed as Done |
| `⊘` | Explicitly closed as Abandoned |
| None | No explicit closure and no workflow reported |

Step names come from the workflow producer. Closed rows show only the outcome marker; selected-session controls retain the last workflow position, runtime status, and running-child count. A narrow row drops age before the marker and omits a workflow label and marker together if they cannot fit. Existing archives have no guessed outcome.

## Project-scoped Skills and MCP

Skills and MCP selections belong to the primary repo:

```text
<project>/.pi/sessions/skills.json
<project>/.pi/sessions/mcp.json
```

Press `s` for the configured skill pools or `m` for the MCP catalog. `←` / `→` switches between Enabled and Available, `↑` / `↓` moves within the selected list, and `Space` toggles an item. `Tab` also switches lists. At 40–60 columns, only the selected list is shown; wider layouts show both columns. In the skills picker, `Alt+E` edits the pool path.

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
| `w` finish | Merge into recorded base branches, verify worktree cleanup, then retain a stopped Archived parent |
| `d`, then `D` discard | Remove clean worktrees without merging, then retain a stopped Archived parent |

Finish/discard checks Git cleanliness before stopping parent and child sessions. Both require clean worktrees; finish also requires clean base repos. Multi-repo operations process additional repos before the primary repo. Successful closeout removes obsolete child rows, workspaces, and heartbeats, but keeps the parent ID, title, conversation metadata, workflow, source roots, and per-repo merged/discarded evidence. A retained branch is reported separately from directory cleanup. Normal delete remains separate and never removes Pi conversation files or source repos.

## Non-goals

Hub stays local and Pi-native. It has no cloud service, custom agent runtime, repo filesystem scanning, or general Git manager. It displays extension-provided workflow data without becoming the workflow engine.
