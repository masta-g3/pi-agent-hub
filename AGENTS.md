# pi-command-center Agent Notes

- Keep this package Pi-native and small; do not import Agent Deck architecture unless explicitly requested.
- TUI rendering must remain pure and testable. Any ANSI styling must be width-safe through the theme/layout helpers.
- For Skills/MCP project state, write the final selection once. Do not launch parallel per-item JSON read-modify-write updates.
- Clipboard support is optional best-effort; attach/switch flows must still display the exact tmux command.
- Keep inside-tmux attach tmux-native: switch with `src/core/tmux.ts` helpers and do not stop/restart the TUI or add PTY attach unless outside-tmux return semantics are explicitly requested.
