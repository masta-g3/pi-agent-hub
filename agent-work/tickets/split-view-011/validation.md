# Sidebar validation

## Automated verification

- Test-first temporary cases covered 40/50/60 columns, heights 8/12/24/40, live resize through 60/61, fleet and decision-strip hit maps, command and Help scrolling, stacked forms, single-list Skills/MCP, long names/errors/paths, cursor preservation, stale targets, and hidden-action blocking. Temporary test sources were removed.
- Final stable-source isolated `npm test`: **1,018 passed, 0 failed, 0 skipped**.
- Fresh `npm run typecheck`: passed.
- `git diff --check`: passed.
- Review critics returned LGTM for dialog craft and the current title/metadata windowing, bounded height, exact hit targets, and bottom decision-strip integration.

## Review corrections

- Confirmation rendering is pure. Input transitions record exposed warning rows, reset reading after reflow, and revalidate exact targets before side effects.
- Confirmation errors retain visible retry/cancel controls; busy and tiny projections cannot authorize hidden actions.
- Favorites rendering and paging share one viewport calculation and use the actual viewport height.
- Stale command selections show an unavailable notice rather than another target's identity.
- Prompt fitting measures terminal cells for wide-character session names.
- Picker detail paging requires actual width; the missing-width unbounded fallback was removed.

## Real-terminal smoke

A temporary harness used actual `SessionsView`, `SessionsController`, and pi-tui `ProcessTerminal`/`TUI`, driven through an isolated tmux socket with in-memory session, Skills, and pin fixtures. It did not touch the default tmux server, real pins, registry, or conversations.

Passed:

- Fleet at 40/50/60 columns with normal and short heights.
- Full-sidebar command search, target details, detail paging, and Escape restoration.
- Help paging through its final section.
- Rename with typed state retained across live resize from 40 to 61 columns.
- Skills Enabled/Available switching with pool/search/control rows retained.
- Delete/worktree confirmation warning paging and explicit resize/cancel-only behavior.
- Cancel paths left rename/delete/applySkills/attach/restart spies at zero.

## Installation note

During user testing, an earlier reviewed combined snapshot was packed from temporary staging and installed globally without rebuilding the live checkout. It passed 1,014 tests. The later compact-fleet review fixes in commit `e8edf57` were not reinstalled by this ticket. The temporary source, tarball, logs, and reproduction patch were removed at commit closeout.

## Boundaries

No new dependency, persisted setting, tmux geometry/lifecycle behavior, pin mutation, or live checkout build was introduced. Unrelated local scratch files remained untouched.
