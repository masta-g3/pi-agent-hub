# Combined local installation — 2026-09-14

## Approved scope

The user requested committing all pending project changes, including the fork/workflow simplifications, leading group badges, bracketed paste, and filter-local collapse controls. Commit `c2f8df9` records that checkout. Existing unfinished plans retain their current status; this was not completion of those plans. Local `.pi/`, `.playwright-cli/`, and the unrelated `agent-work/compact.md` transcript remain untracked and were not installed.

The user separately approved preserving the already-installed Conversation workspace from upstream `cb0a937`. No branch switch, merge, rebase, or push was performed. The installed package therefore combines that feature with `c2f8df9`; it is not the output of building the root checkout alone.

## Reproduction

`conversation-integration.patch` applies to an archive of `c2f8df9`. It retains upstream Conversation source, tests, and documentation without restoring the removed fork-preparation implementation. Conflict resolution preserves guarded interaction commands and interaction lifecycle cleanup, uses the checkout's existing fork-compaction operation to block shortcuts during preparation, and combines leading group badges with the upstream Open in Pi label.

```sh
STAGE=$(mktemp -d)
git archive c2f8df9 | tar -x -C "$STAGE"
(cd "$STAGE" && git apply /absolute/path/to/agent-work/install/conversation-integration.patch)
(cd "$STAGE" && npm ci --ignore-scripts && npm test && npm run package:check && npm pack --ignore-scripts)
```

Do not build/install the root checkout alone when preserving Conversation workspace. Keep this patch until the two source lines are integrated in Git. The reconstruction was checked against the tested staging source and tests byte-for-byte.

## Validation and installation

- Root checkout: 926 tests passed; package check and pre-commit typecheck passed.
- Combined staging with its own lockfile and dependencies: 984 tests passed; package check passed.
- Installed `pi-agent-hub@1.2.0` globally from the tested tarball through `npm install -g`.
- Tarball SHA-256: `499cb6ca1be4894e3f27d9a98201bc6523988595f963af773161d10b58acb154`.
- Installed `dist/src` and `dist/cli.js` match tested staging byte-for-byte, including the Conversation modules and filter fix.
- Isolated `pi-hub list` and `pi-hub doctor` passed. Real-state doctor confirmed tmux, writable state, global CLI and extension paths. The separate Pi-managed npm copy is absent; the existing global CLI installation route is unchanged.
- No live dashboard or managed Pi session was restarted. Quit the dashboard with `q`, then run `pi-hub` to load the installed dashboard code.

Temporary staging, logs, and tarball were removed after verification. This patch and note retain the exact source reconstruction and install evidence.
