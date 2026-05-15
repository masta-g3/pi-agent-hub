**Feature:** session-prelude-001 → Persist and apply a reusable per-session launch prelude before managed Pi sessions start.

## Summary

Implemented a global `session.prelude` config field and minimal CLI controls so users can run a machine-local shell snippet before every managed Pi session starts. This solves setup/auth cases such as macOS keychain unlocks without hardcoding macOS behavior or changing dashboard/direct TUI launch.

## Implemented

- Added `session.prelude` to `config.json` schema in `src/core/config.ts`.
- Added config helpers:
  - `effectiveSessionPrelude()`
  - `setSessionPrelude()`
  - `unsetSessionPrelude()`
- Added CLI commands:
  - `pi-hub config get`
  - `pi-hub config set session-prelude <shell snippet>`
  - `pi-hub config unset session-prelude`
- Updated `pi-hub doctor` to report `session prelude: configured|none` without printing the snippet.
- Updated managed session launch in `src/app/session-commands.ts` so configured preludes run before `exec pi` for new, restarted, and forked managed sessions.
- Kept prelude scope narrow:
  - applies only to managed Pi tmux sessions;
  - does not apply to dashboard launch, direct `pi-hub tui`, MCP pool, or return-key dashboard recreation;
  - no macOS-specific behavior is hardcoded.
- Added tests for config defaults/validation/persistence, command quoting, failure gating, and CLI config smoke behavior.
- Updated durable docs in `README.md`, `docs/STRUCTURE.md`, and `AGENTS.md`.

## Launch Semantics

Without a prelude, managed sessions keep the existing command shape:

```bash
pi '--extension' '/path/to/extension.js'
```

With a prelude, the command is wrapped through the user's shell:

```bash
$SHELL -lc '<session.prelude>
__pi_agent_hub_prelude_status=$?
if [ $__pi_agent_hub_prelude_status -ne 0 ]; then exit $__pi_agent_hub_prelude_status; fi
exec pi ...'
```

The final prelude exit status is checked before `exec pi`. If setup fails, Pi does not start and the tmux pane shows the shell failure.

## User Example

```bash
pi-hub config set session-prelude 'security show-keychain-info ~/Library/Keychains/login.keychain-db >/dev/null 2>&1 || security unlock-keychain ~/Library/Keychains/login.keychain-db'
pi-hub config unset session-prelude
```

## Verification

- Baseline before implementation: `npm test` passed, 242/242.
- Final verification:
  - `npm test` passed, 251/251.
  - `npm run package:check` passed.
  - `git diff --check` passed.
  - Temp-state CLI smoke for `config set/get/unset` and `doctor` passed.
- Review:
  - `code-critic` returned LGTM.
