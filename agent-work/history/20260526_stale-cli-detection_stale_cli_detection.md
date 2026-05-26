# Stale CLI Detection

## Summary

Implemented diagnostics for split installs where Pi's package copy of `pi-agent-hub` differs from the `pi-hub` executable resolved on `PATH`. The CLI now reports install status in `pi-hub doctor`, warns only before interactive `dashboard`/`tui` launches when the Pi package version differs from the running CLI, and keeps script-oriented commands quiet.

## Changes

- Added `src/core/install-diagnostics.ts` to inspect the Pi package root, running package root, PATH-resolved command, versions, POSIX/Windows bin candidates, and suggested fixes.
- Added `src/core/cli-command.ts` so dashboard tmux creation runs `tui` through the current Node executable and current CLI file instead of bare `pi-hub tui` from PATH.
- Wired diagnostics into `src/cli.ts` for interactive warnings and `doctor` output.
- Added install/PATH tests covering matching installs, version drift, global-first PATH drift, POSIX symlinked shims, Windows `Path`/`PATHEXT`, missing Pi package, and dashboard command quoting.
- Updated `README.md`, `docs/DEVELOPMENT.md`, and `docs/STRUCTURE.md` with npm-first install guidance, Pi-package drift fixes, and contributor rules for non-mutating diagnostics.

## Verification

- `npx tsc -p tsconfig.json --noEmit`
- `npm test` — 345 passing
- Manual `node dist/cli.js doctor` smoke tests for missing Pi package and fake newer Pi package drift
