# Inside-tmux switch and return

Implemented inside-tmux attach so pressing `Enter` in `pi-center` now actually switches the current tmux client into the selected managed Pi session instead of only showing the command.

## What changed

- Added tmux helpers in `src/core/tmux.ts`:
  - capture current tmux session and client with `display-message`
  - save the existing root-table `C-q` binding
  - install a temporary guarded `Ctrl+Q` return binding for `pi-center-*` sessions
  - switch the visible client with `tmux switch-client -c <client> -t <target>`
  - restore the previous binding on return, switch failure, stale state cleanup, or best-effort TUI stop
- Wired `CenterView` and `runTui()` so inside-tmux Enter invokes `switchClientWithReturn()` while preserving the visible/copyable command text `tmux switch-client -t <session>`.
- Kept outside-tmux attach unchanged: it still uses normal `tmux attach-session`; outside-tmux Ctrl+Q return remains a deferred PTY/attach problem.
- Fixed a manual-test blocker where `refreshPreview()` could crash on sessions already marked `error` because the tmux pane was missing.
- Documented the inside-tmux Enter/`Ctrl+Q` behavior in `README.md`, `docs/STRUCTURE.md`, and project agent guidance.

## Important design decisions

- Use native tmux switching inside tmux; do not stop/restart the TUI and do not add a PTY bridge for this flow.
- Keep the user-visible command stable and actionable even though the internal command targets the current client explicitly with `-c <client>`.
- Treat `C-q` as one global tmux binding per server. The helper refuses to replace a live foreign owner and restores stale state before rebinding.
- Guard the return binding so it only acts from managed `pi-center-*` sessions.

## Verification

- `npm test` passed with 103 tests.
- `npm run build` passed.
- `git diff --check` passed.
- Real tmux smoke confirmed:
  - Enter switched to an ephemeral `pi-center-smoke-*` session.
  - `Ctrl+Q` returned to the control-center session.
  - Previous `C-q` binding was restored.
  - No smoke sessions were left behind.
