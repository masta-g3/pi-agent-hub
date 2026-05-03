# pi-sessions Structure

`pi-sessions` is a minimal TypeScript package for managing Pi sessions in tmux. It is Pi-only: Pi remains the agent runtime, tmux remains the process substrate, and this package supplies the dashboard/registry glue.

## Layout

```text
src/
  cli.ts                 command entrypoint (`pi-sessions`)
  index.ts               public exports
  app/                   controller, refresh loop, and shared session actions for the standalone TUI
  core/                  registry, paths, tmux, Pi process args, status reducer
  extension/             tiny Pi extension for session heartbeats
  mcp/                   MCP catalog/project config, direct clients, pool, tool adapter
  skills/                project skill attach/detach and pool discovery
  tui/                   pure render model, terminal layout, picker, and theme helpers
test/                    Node test-runner tests compiled by TypeScript
docs/STRUCTURE.md        this onboarding guide
```

## Runtime state

- Global sessions state lives under `PI_SESSIONS_DIR` or `<PI_CODING_AGENT_DIR>/pi-sessions`.
- The session registry is `registry.json`.
- Managed Pi sessions write heartbeat files under `heartbeats/<session-id>.json` through the extension.
- Project skill state lives in `<project>/.pi/sessions/skills.json`.
- Project MCP enablement lives in `<project>/.pi/sessions/mcp.json`.
- Pooled MCP uses a Unix socket at `<agent-dir>/pi-sessions/pool/pool.sock`.
- Inside-tmux switch return state lives under `return-key/` while a temporary `Ctrl+Q` binding is active.

## Build and test

```bash
npm install
npm test
npm run build
node dist/cli.js --help
```

## Design rules

- Keep status logic centralized in `src/core/status.ts`.
- Keep tmux shelling centralized in `src/core/tmux.ts`. Inside-tmux attach uses native `switch-client` plus a temporary guarded `Ctrl+Q` return binding; outside-tmux attach remains normal `tmux attach-session`.
- Delete sessions through `src/app/delete-session.ts`: stop tmux, remove the registry row, remove the heartbeat, and keep Pi conversation/session files. The TUI pauses the refresh loop before deletion so stale snapshots cannot rewrite deleted rows.
- Keep rendering pure and testable in `src/tui/*`; ANSI styling must stay width-safe via theme helpers.
- Use single bulk writes for multi-item project state changes; avoid parallel read-modify-write loops against JSON files.
- Keep clipboard integration best-effort. The UI must always show the actionable tmux command even when clipboard tooling is missing.
- Prefer small functions and explicit data shapes over framework abstractions.
