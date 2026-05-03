# pi-sessions Agent Notes

- Keep this package Pi-native and small; do not import Agent Deck architecture unless explicitly requested.
- TUI rendering must remain pure and testable. Any ANSI styling must be width-safe through the theme/layout helpers.
- For Skills/MCP project state, write the final selection once. Do not launch parallel per-item JSON read-modify-write updates.
- Clipboard support is optional best-effort; attach/switch flows must still display the exact tmux command.
- Keep inside-tmux attach tmux-native: switch with `src/core/tmux.ts` helpers and do not stop/restart the TUI or add PTY attach unless outside-tmux return semantics are explicitly requested.
- Keep package-global state under `<PI_CODING_AGENT_DIR>/pi-sessions`; do not use `<PI_CODING_AGENT_DIR>/sessions`, which is Pi's own conversation session directory.
- For session deletion, use `src/app/delete-session.ts`, pause any active refresh loop first, and never delete Pi conversation/session files.
