# pi-sessions Agent Notes

- Keep this package Pi-native and small; do not import Agent Deck architecture unless explicitly requested.
- Groups are implicit session labels, not first-class records or selectable headers: `g` moves the selected session, `G` renames that session's current group label globally, `K`/`J` reorder within the current group, `r` renames the selected session, and `R` restarts it. Keep `e` as a hidden rename alias.
- Session row order is persisted/user-controlled via `src/core/session-order.ts`; do not reintroduce status/title sorting or a separate stopped-session section.
- TUI rendering must remain pure and testable. Any ANSI styling must be width-safe through the theme/layout helpers. Use `src/tui/text-input.ts` for single-line text editing and `src/tui/form.ts`/`renderForm()` for editable dialogs instead of one-off dialog state.
- For Skills/MCP project state, write the final selection once. Do not launch parallel per-item JSON read-modify-write updates. The TUI pickers target the selected session's primary `cwd`; if no session is selected, they fall back to the dashboard cwd. In multi-repo sessions, Skills/MCP attach to the primary repo only, not additional repos or the synthetic workspace.
- Clipboard support is optional best-effort; attach/switch flows must still display the exact tmux command.
- Keep inside-tmux attach tmux-native: switch with `src/core/tmux.ts` helpers and do not stop/restart the TUI or add PTY attach unless outside-tmux return semantics are explicitly requested. If a tmux return path can recreate the dashboard, preserve `dashboardEnv()` so custom `PI_*` state dirs are not lost.
- Tmux chrome must override both `*-style` and `*-format` options when avoiding inherited global colors; themes can embed ANSI/style directives in formats, not just styles.
- The extension can load via both `pi install` and managed-session `--extension`; keep registration idempotent and clear active guards on `session_shutdown`.
- Keep package-global state under `PI_SESSIONS_DIR` or `<PI_CODING_AGENT_DIR>/pi-sessions`; do not use `<PI_CODING_AGENT_DIR>/sessions`, which is Pi's own conversation session directory. Multi-repo session workspaces live under `<PI_SESSIONS_DIR>/workspaces/<session-id>` and contain symlinks only; do not add worktree management unless explicitly requested.
- For session deletion, use `src/app/delete-session.ts`, pause any active refresh loop first, and never delete Pi conversation/session files.
