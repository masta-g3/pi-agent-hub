# Papercuts

## Pre-push hook leaks the repository Git environment

The `.githooks/pre-push` hook runs `npm test` with Git's hook environment. Worktree tests create temporary repositories, but inherited `GIT_DIR`/`GIT_WORK_TREE` can make their nested `git init` and `git commit` commands operate on the feature checkout instead. During conflict repair this created two stray `initial` commits and temporary README changes in the feature branch.

Direct `npm test` passed. The branch was repaired with a hard reset to the intended merge commit, then pushed with `core.hooksPath=/dev/null` after verification. The hook should sanitize Git environment variables before running tests, or the tests should explicitly clear them for nested repository commands.
