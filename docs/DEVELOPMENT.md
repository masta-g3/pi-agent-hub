# pi-agent-hub Development

This page covers local setup, test commands, package checks, and smoke testing.

Requirements: Node.js 22.19+, Pi 0.85.1+, and tmux 3.1+.

## Local setup

```bash
git clone https://github.com/masta-g3/pi-agent-hub.git
cd pi-agent-hub
npm install
npm run build
npm link
pi install "$PWD"
pi-hub doctor
pi-hub
```

- `npm link` provides the `pi-hub` and `pi-agent-hub` shell commands for local development only; release users normally install the CLI from npm, with Pi-package PATH/shim diagnostics documented in `README.md`.
- `pi install "$PWD"` lets Pi discover the package extension through `package.json#pi.extensions`.
- Re-run `npm run build` after pulling updates.

## Uninstall local setup

```bash
pi remove /path/to/pi-agent-hub
npm unlink -g pi-agent-hub
```

## Tests

```bash
npm test
npm run package:check
```

Do not run these concurrently: both rebuild `dist`. If the linked Hub is in use, run `npm run typecheck` without rebuilding it. For tests, compile with `tsc -p tsconfig.json --outDir <temporary-directory>`, link that directory's `node_modules` to the checkout, add a `package.json` containing `{"type":"module"}`, and run its emitted `test/*.test.js` files. Remove the temporary directory afterward. Direct Node TypeScript execution does not resolve this repo's `.js` source imports.

## Feature-only installation

Before installing from a dirty checkout, confirm which changes the user approved. The working-tree diff can include unrelated work or reversions of shipped behavior; a passing build alone does not make that whole diff safe to install.

For a feature-only install, use temporary staging from an agreed committed baseline plus the reviewed patch. From inside that directory, run `npm ci --ignore-scripts` with its own lockfile, then test and pack it. Do not mix dependencies from the installed package and another checkout. Install the tested tarball rather than linking the dirty checkout. Keep the exact patch and validation evidence under the ticket's `agent-work/` directory until closeout; remove temporary staging afterward.

Installation does not reload an already running dashboard. Quit that dashboard with `q`, then run `pi-hub` to load the installed code; managed Pi sessions remain running.

## Git hooks

This repo includes lightweight local hooks in `.githooks/`:

- `pre-commit` runs `npm run typecheck` so commits fail on TypeScript errors without rebuilding `dist`.
- `pre-push` runs `npm test`, which rebuilds and runs the full Node test suite.

Enable them once per clone:

```bash
npm run hooks:install
```

Use Git's normal `--no-verify` escape hatch for intentional bypasses.

## Pi package declaration

The package declares its extension in `package.json`:

```json
{
  "pi": {
    "extensions": ["dist/src/extension/index.js"]
  }
}
```

## Release/versioning

Use lightweight manual SemVer for npm and GitHub releases:

- `patch` for fixes and polish, for example `1.0.4` → `1.0.5`
- `minor` for new user-facing features, for example `1.0.4` → `1.1.0`
- `major` for breaking behavior or config changes, for example `1.0.4` → `2.0.0`

Before publishing, move `CHANGELOG.md#Unreleased` entries into a dated version section. Then release with:

```bash
npm version patch   # or minor/major
npm publish
git push --follow-tags
```

Create the matching GitHub Release from the generated `vX.Y.Z` tag and copy the changelog entry into the release notes.

## Package smoke before publishing

```bash
npm run package:check
npm publish --dry-run
```

## Smoke test with temp state

```bash
TMP=$(mktemp -d)
PI_CODING_AGENT_DIR="$TMP/agent" PI_AGENT_HUB_DIR="$TMP/sessions" node dist/cli.js doctor
PI_CODING_AGENT_DIR="$TMP/agent" PI_AGENT_HUB_DIR="$TMP/sessions" node dist/cli.js list
```

For interactive tests on an isolated tmux server, create a bootstrap session, set the server-global state paths, then launch Hub on that same socket before it creates managed sessions:

```bash
tmux -L pi-hub-smoke new-session -d -s bootstrap
tmux -L pi-hub-smoke set-environment -g PI_CODING_AGENT_DIR "$TMP/agent"
tmux -L pi-hub-smoke set-environment -g PI_AGENT_HUB_DIR "$TMP/sessions"
tmux -L pi-hub-smoke new-session -d -s pi-agent-hub -c "$PWD" "node dist/src/cli.js tui"
tmux -L pi-hub-smoke kill-session -t bootstrap
tmux -L pi-hub-smoke attach-session -t pi-agent-hub
```

A per-command environment override changes the dashboard process but not the isolated server's inherited environment for later managed sessions. Sidebar pins also cannot be tested end to end on `tmux -L`: their nested attach intentionally clears `TMUX` and reconnects through the default socket. Use the side-pane integration tests for exact-pin behavior, or use the default tmux server only when that test is explicitly safe.
