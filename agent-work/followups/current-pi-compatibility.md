# Current Pi compatibility (Pi 0.99.2)

User-approved fix in the retained session-closure-001 worktree. This is not a new ticket. Completed tickets and history are unchanged.

## Problem

With installed Pi 0.99.2, peers `*` resolved `@earendil-works/pi-tui` 0.99.2. The dashboard and every CLI command failed at import time:

```
SyntaxError: The requested module '@earendil-works/pi-tui' does not provide an export named 'TUI'
```

Baseline reproduced in the worktree after moving dev dependencies to 0.99.2: `node --test dist/test/run-tui.test.js` and `node dist/cli.js list` both failed with this error, exit 1.

## API findings (pi-tui 0.99.2)

- `TUI` is now an interface (type-only export). The concrete renderers are `TuiMainScreen` (main buffer, differential rendering) and `TuiAltScreen` (alternate buffer with an application-owned viewport, mouse capture, and scrolling).
- `TuiMainScreen` is the direct successor of the old class. It has the same `(terminal, showHardwareCursor)` constructor. It does not capture mouse input, and it passes raw input, including SGR mouse sequences, to the focused component. Hub's own mouse parsing therefore keeps working. `TuiAltScreen` would take over mouse and scrolling, so Hub does not use it.
- `Component` now declares an optional `handleMouse(TuiMouseEvent)`. The private `SessionsView.handleMouse(MouseEvent)` had the same name and failed typecheck.
- The coding-agent APIs that Hub uses (`ExtensionAPI` event overloads, `Theme`, `SettingsManager`, `DefaultResourceLoader`) typecheck against 0.99.2 with no changes.

## Changes

- `src/app/run-tui.ts`: `new TUI(terminal, false)` → `new TuiMainScreen(terminal, false)`.
- `src/tui/sessions-view.ts`: rename private `handleMouse` → `handleFleetMouse`, next to `handleConversationMouse` and `handlePaletteMouse`.
- `package.json` / lock: devDependencies `@earendil-works/pi-coding-agent` `^0.99.2` and `@earendil-works/pi-tui` `^0.99.2` (tests now run on the shipped API). Peers are now `^0.99.2` instead of `*`: require the current API and constrain automatic resolution to the tested 0.99.x series.
- README, DEVELOPMENT, CHANGELOG Unreleased: Pi requirement is now 0.99.2+.

## Verification (worktree only)

- `npm run typecheck`: pass. Before the fix it failed with the two errors above.
- `npm test`: 1054 pass, 0 fail.
- `npm run package:check`: pass (285 files).
- `node dist/cli.js list` / `doctor` with temp `PI_CODING_AGENT_DIR`/`PI_AGENT_HUB_DIR`: exit 0.
- Isolated tmux server (`tmux -L pi-hub-compat`, temp state): the dashboard drew full-screen. `?` opened Help. Two SGR wheel events scrolled Help by 6 lines. `n` opened the New session dialog, and `Esc` closed it. `q` exited with code 0 and empty stderr. Then the server was killed.
- Installed Pi 0.99.2 with `-e dist/src/extension/index.js` on the same isolated server: the extension appeared under `[Extensions]` with no load error. `Ctrl+D` exited with code 0 and empty stderr.

Not done here: global install (the parent owns it), and sidebar pins end to end (`tmux -L` cannot exercise nested attach; see DEVELOPMENT).
