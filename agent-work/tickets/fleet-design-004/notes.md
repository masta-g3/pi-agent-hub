# fleet-design-004 — Mission control

Baseline: `fleet-design-003` (uncommitted there, snapshotted here as the first commit on this branch).

## Behavior (what changed against 003)

Applies to the no-pin fleet only (`grouping !== "stage"`, no pins). Board and pin views are unchanged.

### Roster (the list)
- Every non-archived parent is a module: a title row plus at most one status line (a request may wrap to a
  second line). The 003 field grid (`STEP PL✓ EX◉ RV·` readout, `SUB`, multi-line `NOW`) no longer appears on
  unselected rows.
- Title row: `disclosure state Title ↳N   group` then, right-aligned, `?N` hidden child requests, the
  workflow step short (`RV`, `EX✓` when the step is complete, or the mode short such as `FOC` in accent), and
  the age padded to three cells. The task subtitle joins the group only at 160+ columns.
- Status line, first match wins: `ASK|RDY|BLK text` (warning label) · `ERR error` · `NOW tool detail` (live
  tool call from the heartbeat, label in the live/success tone) · `NOW activity` while running · `SUB agent task`
  · `DONE progress note` · `NOW activity` (muted, not running) · `SAID` a handoff already read ·
  `TASK` the ticket subtitle (below 160, where the title row lacks it) · else no line. Window priority: request
  and fault 0, live work 1, quiet notes 2. While the session is
  on the Execute step with a plan (running or waiting, not stopped or step-complete), the line's right edge
  carries the task meter `▰▰▰▱▱▱▱▱ 6/15` (count only below 40 cells). Repo grouping names the tier on the
  title row only when the whole label fits.
- The selected row is rendered exactly like an unselected one; it only gains the tone stripe `▌` in column 0
  and the selection plate. Selecting never changes row heights.

### Detail card
- At 100+ columns (`SIDE_PANE_MIN_WIDTH`) the selected session's card is a pane to the right of the roster,
  separated by a dim `│`. The roster takes about 38% (min 38 cells); the pane is capped at 104 cells and the
  roster takes the rest. The pane is not plated and has no stripe. Its key rows sit on the pane's last rows.
  There is no horizontal dock rule in this mode.
- Below 100 columns, and whenever a conversation (`c`) is open, the card docks below the roster under a rule,
  as in 003 (`dockRows`).
- Card content, in order, a label only with a value: title row (state, title, `↳N`, group, age) · optional
  metadata line · task subtitle · `ASK|RDY|BLK` whole with `→ recommendation` and `▤ artifact` · receipt ·
  `ERR` · `DONE` / `NEXT` (side pane; the dock keeps them after `LOG`) · `STEP` readout (LCD strip at 100+: `STEP`, `TASK` meter; `PHASE` only when the producer sends no
  checklist) · `PLAN` (`2/4 Phase title`, then tasks: `✓` done muted, `◉` current bold, `·` pending; windowed
  to 7 around the current one, with `✓ N earlier` / `· N more`) · `NOW` (workflow activity and/or the live
  tool call) · `LOG` (last 3 finished tool calls; age in a fixed 3-cell column before the tool) · `DONE` / `NEXT` (progress
  note; `NEXT` is omitted while a request is shown, since the request is what comes next, and `DONE`
  while a ready handoff is shown, since it already says what was done). LOG never lists `ask_user_question` or
  `hand_off`, and a bash detail drops a leading `cd <dir> &&`. · `SUB` · `SAID` (the agent's latest message, markdown-rendered, folded at 14 text lines; `C` shows it whole and
  folds it back; falls back to a handoff already read) · keys.
- `SAID` is only what the agent said since your last message; a running agent with no tool call shows
  `NOW Thinking…`. An open Answer/Reply caps `SAID` at 4 lines, rules the panel off (`── ASK ───`), wraps
  options at 76 and leaves a blank row before its keys when rows allow.
- Reading aids are color and weight only, no new glyphs: in SAID, markdown bold is bold, headings bold accent
  and inline code accent; in a question, option keys are bold accent in dim brackets, labels bold and
  `[Recommended]` accent. Stripped text is identical, so `NO_COLOR` and ASCII are unchanged.
- In the side pane a blank row separates the groups (request · progress · position/plan · activity · message).
  The request text is bold. Prose (request, error, DONE/NEXT, SAID) wraps at `PROSE_MEASURE` 76. SAID sits under
  a `── SAID ───` rule from the label column and keeps markdown bold; the dock keeps the `SAID` label form.
  The docked card (below 100) is compact: no blank rows, PLAN keeps the phase and the current task, LOG one row.
- With an Answer or Reply panel open, the card keeps the request, DONE/NEXT and SAID above the panel and drops
  STEP, PLAN, NOW, LOG and SUB; context above the panel is cut from its end when rows run out.
- Running sessions now offer `p Reply` among their card actions (`open, send, pin, archive`).

### Colors
- Unchanged roles. The header's account quota bars now use the unmodified theme (success/warning/error),
  not the panel palette that maps success to text.

### Data
- Heartbeat `activity: { current?, recent? }` of `{ tool, detail?, at }`: tool name plus one short argument,
  published ~750 ms after tool start/end. Live-only: never written to the registry.
- `workflow.plan.current = { tasks: [{done,text}], before, after }` and `phases[].title` from Rules;
  `current` is live-only (stripped from the registry copy).
- `context.progress = { done?, next?, updatedAt }` from Rules (one small model call per finished turn).
- Interaction `state` responses carry `lastMessage` (bounded 2,000 chars) for the selected session.

## Rendering the frames
`ROOT=$PWD node agent-work/tickets/fleet-design-004/html.mjs '<json shots>' out.html` after `npm run build`;
`demo.mjs W H id` prints one plain frame.

## Installed state and rollback (2026-11-09)
- Hub: packed from this worktree at the branch tip and installed globally (`/opt/homebrew/lib/node_modules/pi-agent-hub`).
  Roll back by packing and installing the 003 worktree, or `main`.
- Rules extension: four files copied into `~/.pi/agent/extensions/workflow-runtime/` (`core.ts`, `index.ts`,
  `session-context.ts`, `workflow-plan.ts`). The previous deployed copies are in
  `../rules-extension-backup/` beside this worktree; copy them back to roll back. `sync-prompts.sh` from Rules
  `main` will also overwrite them until the Rules branch merges.
- Live smoke test in a throwaway Pi session: heartbeat showed `current` bash, `recent` read, and after the turn
  `context.progress.done`. Running sessions need `/reload` to pick up both extensions.
