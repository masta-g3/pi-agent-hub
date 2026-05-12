# Ctrl+Q dashboard adoption — deferred

## Status

Abandoned/deferred on 2026-05-09. No implementation was committed for this plan.

## Original goal

Make `Ctrl+Q` inside a Pi coding-agent session a universal shortcut for opening the `pi-sessions` dashboard. For Pi sessions not launched by `pi-sessions`, the shortcut would first adopt the current tmux/Pi session into the dashboard registry, then switch to the dashboard.

## Intended behavior

- Managed sessions would continue to return to the dashboard with `Ctrl+Q`.
- Unmanaged Pi sessions running inside tmux would be registered on demand with:
  - current tmux session name,
  - current cwd,
  - group derived from cwd basename,
  - existing Pi session metadata where available.
- Outside tmux, Pi would show a concise notification instead of trying to attach or switch.

## Why deferred

The current managed-session return path is already working, and adopting arbitrary/unmanaged Pi tmux sessions increases registry and shortcut complexity. The idea can be revisited later if unmanaged-session adoption becomes important.

## Notes if revived

- Avoid duplicate registry rows by matching managed id, tmux session, Pi session file, and Pi session id.
- Preserve existing title/group/order when updating adopted rows.
- Keep shell-only tmux sessions out of scope.
- Update README, `docs/STRUCTURE.md`, and agent guidance only after behavior is implemented and verified.
