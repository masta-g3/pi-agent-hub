**Feature:** web-008 → Phone inbox toggle
**Session:** 01a219b0-7ebd-712d-a3b9-7317ae79c630
**Worktree:** none
**Start branch:** n/a
**PR target:** n/a

# Phone inbox toggle

From the dashboard you can see when `pi-hub web` runs, and you can start or stop it. An opt-in setting starts it when the dashboard opens. Tailscale Serve stays a manual setup.

## Decisions

- **Indicator:** a muted ` · web` at the right end of the header, only while a verified server runs. It is fitted last in `headerWithQuota()`, so it never shortens the quota, brand, meter or any signal; on a tight header it drops first. Tier chips shift left by the suffix width while it shows.
- **Click:** a click on `web` shows `phone inbox on 127.0.0.1:<port> · ": Phone inbox" stops it`. It never stops the server.
- **Control:** palette-only entries `Phone inbox: Off` (`view:web-start`) and `Phone inbox: On` (`view:web-stop`), with no key. Separate ids let the palette's stale-id check refuse an entry whose state changed before Enter. The entries are not gated by `interactionBlockedReason`, so they work with a tier header selected or an empty board.
- **Stop scope:** every verified server in the state directory, including one started by hand, with `SIGTERM`.
- **Autostart:** `dashboard.webAutostart`, default `false`, toggled from the palette. It starts the server once at dashboard startup if none runs and tmux is available; a server that exits later is not restarted.
- **Out of scope:** Tailscale control, a port setting, a direct key, running the server inside the dashboard, and a confirm dialog. The few-millisecond gap between verifying a server and signalling it is accepted; a private control channel was judged not worth its cost.

## Implementation

- `src/core/web-status.ts`: one record per process, `<state>/web/<pid>.json` (`pid`, `port`, random `instanceId`, `startedAt`). A record counts only when its pid (1..2^31-1) matches its file name, the port is 1..65535, the pid is alive, and `GET /api/instance` (no redirects, 500 ms) returns the same `instanceId`. A dead pid's record is pruned.
- `src/web/run-web.ts`, `src/web/server.ts`: signal handler installed before `listen()`; the refresh loop starts in the `listen` callback; `serveUntilShutdown()` publishes the record and runs one cleanup however startup ends. `/api/instance` uses the existing Host guard.
- `src/app/web-inbox.ts`: `startWebInbox()` runs `node dist/src/cli.js web` in tmux session `pi-hub-web` (exact `=` match; not the managed `pi-agent-hub-` prefix) from the home directory, with resolved absolute `PI_CODING_AGENT_DIR` and `PI_AGENT_HUB_DIR`, then waits up to 5 s for a verified record. `stopWebInbox()` signals every verified pid, treats `ESRCH` as exited, waits on one shared deadline and reports other failures together.
- `src/app/run-tui.ts`: reads the records on each refresh as a passive read (an error reads as off and shows once), wires `WebInboxActions`, and runs autostart without blocking startup.
- `src/core/config.ts`, `src/tui/dashboard-commands.ts`, `src/tui/sessions-view.ts`, `src/tui/render-model.ts`, `src/tui/layout.ts`, `src/tui/dialog.ts`: setting, commands, dispatch, header signal and click hit.
- Docs: `docs/FEATURES.md`, `docs/CONFIG.md`, `docs/STRUCTURE.md`, `docs/DEVELOPMENT.md`.

## Verification

- Tests: `test/web-status.test.ts`, `test/web-inbox-lifecycle.test.ts`, `test/web-inbox-view.test.ts`, `test/web-header.test.ts`, plus cases in `config`, `dashboard-commands` and `web-server` tests. `npm test`: 1889 pass.
- Manual check with a temporary state dir and the real TUI in tmux: palette start (header `web`, record written, HTTP 200), the server survived the dashboard quitting, a click showed the address, palette stop removed the record, tmux session and listener, and autostart started the server on dashboard open.
- Review: code-critic, 3 passes; 7 findings fixed (record validation, refresh-loop race, `ESRCH` handling, passive status reads, empty-dashboard header, redirect refusal, shared stop deadline).
- The reviewed build was installed globally, and the live inbox was restarted on the installed `pi-hub web`.

## Reflection outcomes

- `docs/DEVELOPMENT.md`: after a global install, restart the server with the installed `pi-hub web`, not `node dist/cli.js web`.
- No `AGENTS.md` rule for the tmux name: `docs/STRUCTURE.md` and the `WEB_TMUX_SESSION` comment already state it.
- No rule for palette search wording: tests catch it, and the code shows it.
