# pi-command-center Structure

`pi-command-center` is a minimal TypeScript package for managing Pi sessions in tmux. It is Pi-only: Pi remains the agent runtime, tmux remains the process substrate, and this package supplies the dashboard/registry glue.

## Layout

```text
src/
  cli.ts                 command entrypoint (`pi-center`)
  index.ts               public exports
  app/                   controller and refresh loop for the standalone TUI
  core/                  registry, paths, tmux, Pi process args, status reducer
  extension/             tiny Pi extension for session heartbeats
  mcp/                   MCP catalog/project config, direct clients, pool, tool adapter
  skills/                project skill attach/detach and pool discovery
  tui/                   pure render model, terminal layout, picker, and theme helpers
test/                    Node test-runner tests compiled by TypeScript
docs/STRUCTURE.md        this onboarding guide
```

## Runtime state

- Global command-center state lives under `PI_CENTER_DIR` or `<PI_CODING_AGENT_DIR>/command-center`.
- The session registry is `registry.json`.
- Managed Pi sessions write heartbeat files under `heartbeats/<session-id>.json` through the extension.
- Project skill state lives in `<project>/.pi/command-center/skills.json`.
- Project MCP enablement lives in `<project>/.pi/command-center/mcp.json`.
- Pooled MCP uses a Unix socket at `<agent-dir>/command-center/pool/pool.sock`.
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
- Keep rendering pure and testable in `src/tui/*`; ANSI styling must stay width-safe via theme helpers.
- Use single bulk writes for multi-item project state changes; avoid parallel read-modify-write loops against JSON files.
- Keep clipboard integration best-effort. The UI must always show the actionable tmux command even when clipboard tooling is missing.
- Prefer small functions and explicit data shapes over framework abstractions.
