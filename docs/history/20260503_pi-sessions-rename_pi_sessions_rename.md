# Rename to pi-sessions

## Summary

Renamed the unpublished package from its former working names to `pi-sessions` consistently across package metadata, CLI, runtime paths, tmux names, user-facing copy, exported type names, tests, and docs.

No backward compatibility or migration was added because the package had not been published or adopted yet.

## Implemented

- Renamed npm package metadata and binary to `pi-sessions`.
- Replaced user-facing command/help/docs copy with `pi-sessions` and `pi sessions`.
- Changed runtime state from old package paths to session-oriented paths:
  - `PI_SESSIONS_DIR`,
  - `<PI_CODING_AGENT_DIR>/pi-sessions` for package-global registry/MCP/heartbeat state,
  - `<project>/.pi/sessions/*` for project-local skills/MCP state.
- Changed managed tmux session prefix to `pi-sessions-`.
- Changed extension env/heartbeat naming to session-oriented names, including `PI_SESSIONS_SESSION_ID` and `managedSessionId`.
- Renamed public/internal domain types from `Center*` names to session-oriented names such as `ManagedSession`, `SessionsRegistry`, `SessionsController`, and `SessionsView`.
- Renamed UI/theme/render exports to sessions-oriented names.
- Updated MCP and skills global/project paths and MCP client naming.
- Updated tests and smoke script expectations to match the new package name, paths, env vars, and tmux prefixes.
- Renamed active TUI source/test files to `sessions-view`.
- Cleaned `dist` before build so renamed files cannot leave stale compiled artifacts.
- Narrowed npm package files to `dist/src`, `dist/cli.js`, and `README.md` so compiled tests are not published.

## Verification

- [x] Baseline `npm test` passed before rename work.
- [x] `npm test` passes after rename.
- [x] `scripts/smoke.sh` passes with ephemeral state.
- [x] `node dist/cli.js --help` prints only `pi-sessions` commands.
- [x] `npm pack --dry-run` reports package `pi-sessions` and excludes `dist/test`.
- [x] Active source/tests/docs grep clean for stale former-name strings and stale former domain symbols.
- [x] Old names remain only in archived `docs/history/*` files as intentional historical references.
