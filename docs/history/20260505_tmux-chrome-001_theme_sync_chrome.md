# tmux-chrome-001 — Theme-sync tmux chrome

## Summary

`pi-sessions` tmux status bars now stay app-owned while deriving their colors from the active Pi dashboard theme. This removes inherited noisy global tmux chrome, avoids fixed black footers under light themes, and keeps dashboard and managed-session footers visually consistent.

## Implemented

- Added `src/core/chrome.ts` as the tmux chrome derivation layer.
  - Accepts structural theme tokens: `text`, `accent`, `statusLineBg`, `border`, `muted`, and `dim`.
  - Converts valid hex colors and `0..255` numeric tokens into tmux-safe colors.
  - Falls back to the existing dark chrome for missing or invalid values.
- Updated `configureDashboardStatusBar()` and `configureManagedSessionStatusBar()` in `src/core/tmux.ts` to accept optional theme tokens.
  - Both dashboard and managed sessions explicitly override `status-style`, `status-left`, `status-right`, `window-status-style`, `window-status-current-style`, `window-status-format`, and `window-status-current-format`.
  - This prevents inherited global tmux formats such as noisy powerline/window-list content from leaking back in.
- Extended `src/tui/theme.ts` with optional `statusLineBg` support from Pi theme files.
  - Tmux background preference is `statusLineBg` first, then `border`, then dark fallback.
  - This was adjusted after visual testing showed Catppuccin `border = lavender` made the full footer blue and hard to read.
- Updated app wiring so theme-derived tmux chrome is applied:
  - when the dashboard TUI starts;
  - when the dashboard observes a theme refresh;
  - when managed sessions are started, reused, forked, re-entered, or synced from the dashboard.
- Fixed the dashboard idle crash path by catching preview refresh failures without swallowing broader refresh failures.

## Final color mapping

| Tmux chrome field | Theme source |
| --- | --- |
| Status/window foreground | `text` if non-empty, else `accent`, else dark fallback |
| Status/window background | `statusLineBg` if non-empty, else `border`, else dark fallback |
| Hint text foreground | `muted` if non-empty, else `dim`, else dark fallback |

## Verification

- `npm test -- --runInBand` passed.
- Runtime tmux smoke confirmed active dashboard and managed sessions using light Catppuccin status chrome:
  - `bg=#dce0e8,fg=#8839ef`
- `status-left` stayed empty and the inherited `⚡ ...` global tmux footer did not return.

## Notes for future work

- Active managed sessions are synced when the dashboard loads or observes a theme change. Sessions cannot be live-updated while the dashboard is not running.
- Keep tmux chrome option writes outside pure TUI rendering. The app layer should load `SessionsTheme` and pass structural tokens into `src/core/tmux.ts`.
