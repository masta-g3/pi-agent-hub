# Dashboard Theme Sync

## Summary

Implemented live Pi theme sync for the `pi-sessions` standalone dashboard TUI. The dashboard still reads the active theme through `loadSessionsTheme({ cwd })`, using project `.pi/settings.json` before global Pi settings, but now periodically reloads that same source of truth while open and updates rendered ANSI colors when theme tokens change.

## Decisions

- Use a small polling loop in `src/app/run-tui.ts` instead of importing `@sherif-fanous/pi-theme-sync`, reimplementing terminal appearance detection, or relying on filesystem watchers.
- Keep `src/tui/theme.ts` as the only dashboard theme loader.
- Keep tmux status/footer chrome separate and fixed; no tmux chrome theming was added.
- Preserve pure, width-safe TUI rendering by mutating only the `SessionsView` theme reference and continuing to pass theme tokens into existing render helpers.

## Changes

- Added `SessionsView.setTheme(theme)` for live theme replacement without changing constructor usage or renderer globals.
- Added `startThemeRefreshLoop()` in `src/app/run-tui.ts`:
  - reloads `loadSessionsTheme({ cwd })` on an interval;
  - compares serialized theme tokens before applying;
  - skips overlapping loads;
  - catches transient load errors while settings/theme files may be mid-write;
  - stops cleanly and avoids applying in-flight themes after shutdown.
- Wired the refresh loop into `runTui()` and requested a render after theme changes.
- Added a compact `lightTheme` fallback so Pi's built-in `light` theme no longer maps to dark tokens; missing or invalid custom themes still fall back to `darkTheme`.
- Updated README and structure docs to describe live theme reload behavior and the separation between Pi theme state and tmux chrome.

## Verification

- `npm test -- --runInBand` passed with 167 tests.
- Added tests for:
  - theme refresh applying changed tokens after a transient load error;
  - unchanged tokens being ignored;
  - in-flight loads not applying after stop;
  - `SessionsView.setTheme()` changing ANSI output without changing visible width;
  - Pi built-in `light` settings resolving to `lightTheme`.
- Performed an ephemeral smoke check with temporary `PI_CODING_AGENT_DIR` and custom theme files, changing settings from one theme to another and confirming the refresh loop applied the new tokens.
