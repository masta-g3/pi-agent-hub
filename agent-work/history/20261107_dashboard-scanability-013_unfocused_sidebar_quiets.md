# dashboard-scanability-013 — Unfocused sidebar quiets

Keys typed into the dashboard sidebar by mistake (while thinking a Pi pane had focus) ran shortcuts and could delete sessions. Three safeguards now address this, plus a visual focus cue.

## Implemented

- **Delete/Finish confirm safeguard** (`src/tui/confirm-dialogs.ts`): any key other than an offered choice, Esc, or PgUp/PgDn cancels the dialog; a choice pressed within `CONFIRM_ARM_MS` (500 ms) of opening also cancels. A fast `dd` never deletes.
- **Focus fact** (`src/app/side-pane.ts`, `side-pane-lifecycle.ts`, `run-tui.ts`): the existing 500 ms presence poll publishes `dashboardFocus` from the sidebar's `#{pane_active}`, only while the window holds another pane. Absent when the dashboard is alone or outside tmux. No tmux server options.
- **Quiet render** (`src/tui/theme.ts` `quietTheme()`, `sessions-view.ts`, `render-model.ts`): while unfocused, accent/success/text/border become `muted`, row and footer tints drop, bold is stripped, the selected-row spinner stops; warning and error stay. Foreground only — background tints were rejected in dashboard-scanability-006.
- **Input grace**: any key or click counts as focus for 1 s ahead of the poll. An observed focus loss voids earlier input (Alt+1–4 intents reach the dashboard as they move focus away), and grace expiry schedules a redraw. This fixed a user-reported fade lag after install.
- **Typing guard** (`sessions-view.ts` `guardTyping`): in a shared window, a printable key within 150 ms of a command-surface key drops itself, dismisses what the first key opened (restart chooser directly; dialogs, card panels and async loads via their Esc path), flashes `Typing in the dashboard — keys ignored`, and drops all keys until a 600 ms pause. Held `j k J K + -` are exempt; already-open text inputs never count; mouse/footer replays use `dispatchInput()` and bypass the guard. Skills/MCP picker loads gained Esc cancellation (`pickerLoadRequest`) so late results cannot reopen after a burst.

## Decisions

- Guard triggers on the 2nd fast key with no added shortcut delay; only the 1st key can act.
- Fade keeps alert colors so requests and failures stay visible from the Pi pane.
- Focus comes from the existing poll, not tmux `focus-events`.

## Verification

- `npm test` 1577 pass; typecheck clean; code-critic LGTM.
- Live check on an isolated tmux server with the user's Catppuccin theme: unfocused capture kept only muted/warning/error colors; refocus restored the rest; `?` then `h` 40 ms apart closed Help with the warning.
- Installed feature-only (baseline `0ae7a39` + this patch, excluding concurrent undo work): staged suite 1563 pass, `package:check` passed, installed `dist/src` matched staging.

## Follow-up

- dashboard-scanability-014: a single stray `q` still quits the dashboard.

## Durable docs

- `docs/FEATURES.md` "Which pane has the keyboard" and the delete row; `docs/STRUCTURE.md` sidebar workspace paragraph.
