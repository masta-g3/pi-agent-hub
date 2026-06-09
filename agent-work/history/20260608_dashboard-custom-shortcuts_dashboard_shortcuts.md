# Dashboard custom shortcuts

Implemented config-driven normal-mode dashboard shortcuts for sending one-line Pi text commands to the selected live managed session.

## User-facing behavior

Users can add `dashboard.shortcuts` to the global Hub config:

```json
{
  "version": 1,
  "dashboard": {
    "shortcuts": [
      {
        "key": "C-n",
        "label": "summarize name",
        "send": "/session-summary name",
        "syncPiNameAfterMs": 1500
      }
    ]
  }
}
```

Pressing the configured key in normal dashboard mode sends `send` through the same tmux paste-and-Enter path as the `p` footer send action. Shortcuts only target selected live normal sessions; stopped, error, and subagent rows are blocked with footer messages. Shortcuts do not run in filters, forms, pickers, help, or other edit modes.

`syncPiNameAfterMs` is a narrow Hub-specific post-action for `/session-summary name`: after sending, Hub waits the configured delay and then runs the existing Pi-name sync used by `N` so the dashboard title can update from Pi `session_info.name`.

## Scope decisions

- Kept shortcuts Pi-native: they send text/slash commands into selected sessions, not shell commands.
- Kept the action shape narrow: `key`, optional `label`, `send`, optional `syncPiNameAfterMs`.
- Did not add a shortcut editor UI, command palette, macro system, generic event system, or per-project shortcut config.
- Reserved built-in dashboard keys and tmux return keys so custom shortcuts cannot shadow core navigation or return behavior.

## Implementation summary

- Added `src/core/dashboard-shortcuts.ts` for shortcut types, key normalization, validation, reserved-key checks, one-line send enforcement, and delay bounds.
- Added `src/tui/dashboard-shortcuts.ts` for matching normalized shortcut specs against raw TUI input.
- Extended `src/core/config.ts` with `dashboard.shortcuts` and `effectiveDashboardShortcuts()`.
- Updated `src/tui/sessions-view.ts` to run matching shortcuts in normal mode before built-in key handling, using existing guarded action/flash patterns.
- Updated `src/app/run-tui.ts` to load shortcuts, call `sendTextToSession()`, schedule optional delayed `syncPiName()`, and clear shortcut timers on stop.
- Added tests in `test/config.test.ts` and `test/sessions-view.test.ts` for defaults, normalization, conflicts, invalid sends, Ctrl+N `/session-summary name`, blocked targets, edit-mode isolation, and missing transport.
- Updated durable docs in `docs/CONFIG.md`, `docs/FEATURES.md`, and `AGENTS.md`.

## Validation

- `npx tsc -p tsconfig.json --noEmit`
- `npm test` — 357 passing
- Review fixed two validator edge cases: newline checks now run before trimming, and terminal-equivalent reserved keys such as `C-m` are rejected.
