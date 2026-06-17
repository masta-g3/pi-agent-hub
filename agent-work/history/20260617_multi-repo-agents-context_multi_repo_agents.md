# multi-repo-agents-context

Implemented Hub-side context loading for multi-repo workspace sessions.

## Summary

Multi-repo sessions start Pi from a generated symlink workspace, so Pi's normal ancestor-based context discovery cannot see `AGENTS.md`/`CLAUDE.md` files at the symlinked repo roots. Hub now generates a real workspace-root `AGENTS.md` during multi-repo workspace creation when any selected repo root has a context file.

## Implemented behavior

- `ensureMultiRepoWorkspace()` still keeps `ManagedSession.cwd` as the primary repo and starts Pi from `<PI_AGENT_HUB_DIR>/workspaces/<session-id>`.
- After creating repo symlinks and the primary `.pi` symlink, Hub checks each selected repo root in Pi-compatible priority order:
  1. `AGENTS.md`
  2. `AGENTS.MD`
  3. `CLAUDE.md`
  4. `CLAUDE.MD`
- If one or more context files exist, Hub writes `workspace/AGENTS.md` with labeled sections containing:
  - repository workspace link name;
  - source repo path;
  - source context file path;
  - original context file content.
- If no selected repo has a context file, Hub does not create a workspace `AGENTS.md`.
- Source repositories are not modified.
- Registry/schema state is unchanged.
- Read errors other than missing files are surfaced instead of silently skipped.

## Files changed

- `src/core/multi-repo.ts`
  - Added private helpers for context-file discovery, rendering, and workspace file writing.
  - Invoked generation from `ensureMultiRepoWorkspace()` after workspace symlink creation.
- `test/multi-repo.test.ts`
  - Added tests for generated workspace context, candidate priority, and no-context behavior.
- `docs/STRUCTURE.md`
  - Documented generated workspace `AGENTS.md` in runtime state architecture.
- `docs/FEATURES.md`
  - Documented multi-repo context loading in the user-facing multi-repo model.

## Validation

- `npm test -- --test-name-pattern=multi-repo`
- `npx tsc -p tsconfig.json --noEmit`
- `npm test`

## Notes

This intentionally avoids changing Pi's context loader, source repositories, registry schema, or Markdown include semantics. Restarting a session recreates the workspace and refreshes the generated context file.
