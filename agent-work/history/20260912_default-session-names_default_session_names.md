# Default session names

New sessions and fresh-conversation restarts use `New · <primary repository folder>`. Both Hub fork actions use `Fork · <source session name>`. Allocate numeric suffixes inside the registry lock when a default name is occupied. Worktree names use the source repository folder.

Use Pi's native `--name` during creation/fork, never when resuming a saved conversation. Compact startup preserves that name instead of resetting it to the repository basename. Later manual/agent names replace defaults; linked ticket names remain producer-owned.

## Verification

- Initial shared-checkout suite: 908 tests passed.
- Final closeout transplanted naming-only changes onto published HEAD to exclude unrelated historical checkout reversions. Full isolated suite: 951 tests passed. Fork-preparation retry preserves the current name; token-based readiness, workflow operations, and overflow behavior remain intact.
- Review rerun: 69 targeted tests passed; code and docs critics approved.
- Independent real Pi RPC and private tmux checks passed: initial names, concurrent collisions, fork/source isolation, later rename/resume, fresh restart, and compact-start name preservation.
- No model calls were made. Successful compaction used the extension callback test; the credential-free real process retained its name through compaction failure.

Documentation covers initial naming, ticket precedence, compact marker timing, and isolated testing without replacing live `dist`. No live session rename, extension reload, or global config change was part of this task.
