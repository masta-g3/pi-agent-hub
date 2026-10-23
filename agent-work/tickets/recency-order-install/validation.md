# Recency ordering validation

- Across groups in each section, errors and unacknowledged waiting rows stay on top; every other row sorts by last interaction newest-first regardless of runtime status. Group names break ties. Parent/child nesting and archive chronology stay unchanged.
- User open, numbered pin focus, answer, send, and configured shortcut actions stamp `lastActivityAt` through `SessionsController.touchSession`.
- The installed change touched only `app/controller.js`, `app/run-tui.js`, `core/session-order.js`, and `core/status.js` compared with the previous install.
- Isolated staging passed the full suite: 1140/1140 tests. Installed runtime exactly matched staging.
- No feature ticket, implementation plan, or worktree closeout applies.
