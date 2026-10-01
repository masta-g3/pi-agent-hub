**Feature:** session-closure-001 → Session closure
**Session:** 01a0f63b-7050-740b-a736-443cb35b448d
**Worktree:** `/Users/manager/.local/share/agent-worktrees/session-closure-001-1063f7d4d745/hub` — `session-closure-001` (Rules-owned)
**Start branch:** hub: `main` at `1d96d3d15f3d21bd8beea87c4b173ccd38d4e615`
**PR target:** hub: `main`
**Worktree record:** `/Users/manager/.local/share/agent-worktrees/session-closure-001-1063f7d4d745/worktree.json`

# Session closure

## Delivered

- Hub-only explicit parent closure: optional `closure: done | abandoned` in the existing registry. No Rules changes, slash commands, new dependency, or separate store.
- `C` opens the target-bound Close chooser: `d` Done, `a` Abandoned, `Esc` cancel. Closing archives and detaches the exact pin without stopping Pi/children or changing workflow, tickets, conversations or worktrees.
- `C` or `U` reopens through the existing Restore path, clearing closure and returning the cascade to Active. `B` is disabled while closed. Archive alone does not imply closure, and Commit completion never closes a session.
- Closure survives reload, heartbeat refresh, and ordinary open/resume. Fresh-conversation restart clears closure but preserves bucket placement. Legacy archives receive no guessed outcomes; forks start open.
- Archived open parents show the producer's base step short and positional marker (`EX ◉`, `CM ✓`). Closed parents show standalone success `✓` or muted `⊘`. No workflow means no marker. Runtime icons stay independent; child rows get no invented closure outcome.
- Archive-tail fitting drops age before meaning and keeps step short/marker atomic. The existing workspace shows explicit closure, last workflow position, runtime, running children, and one Reopen action, while preserving live attention/error priorities.
- Guarded catalog, palette, workspace, keyboard and chooser paths target the exact parent and available Pi identity. Child/synthetic rows cannot close; stale chooser input cannot fall through to Delete or Mark read.

## Implementation and reuse

Extended `src/core/session-bucket.ts`, controller latest-state/cascade mutation, registry persistence, catalog and SessionDialog dispatch, and the shared render model/layout. Close shares serialized Archive pin cleanup through the small testable `closeDashboardSession()` wrapper. Reopen reuses Restore rather than a parallel API. The three-action workspace cap remains: Close takes a visible slot, while Archive stays available in the catalog/palette.

## Verification and review

- Baseline: typecheck and 1035/1035 tests passed in the isolated worktree.
- Implementation: typecheck and 1050/1050 tests passed. Added meaningful regression coverage for persistence, close/reopen/restart, stale targets, controls, workspace priority, archived meaning, custom producers, widths 40–160 and short-height layouts.
- Temporary-state TUI validation drove actual SessionsView input through cancel, Done, Abandoned, reload and reopen; parent/child runtime stayed running, IDs and workflow stayed intact, and closure did not invoke process-stop operations. Temporary scripts/state were removed.
- Code critique removed unnecessary fake-tmux/PATH setup and a tautological assertion from one helper test; exact-target detach and persisted-state assertions remain. Post-fix typecheck/build passed, affected tests passed 27/27, and diff checks passed.
- Plan review used a read-only second opinion after tmux launcher lock timeouts. Code and docs critics ran through tmux. No actionable findings remain.

## Reflection outcomes

Updated `README.md` and `docs/FEATURES.md` with controls, marker meanings and persistence boundaries. Replaced stale archived/workspace contracts in `docs/STRUCTURE.md`; user-approved corrections in `AGENTS.md` point to those boundaries. Docs critique's persistence clarification was applied; links and diff checks passed. No follow-up tickets or global guidance changes.

## Closeout boundaries

Push and PR to main are authorized; merge and worktree removal are not. Keep the worktree and exact record pending PR integration. Source checkout and installed dashboard remain untouched. Local `dist/` and `node_modules/` are disposable verification outputs, not commit content. Future cleanup must retain the canonical ticket and this archived plan in the surviving checkout before removal.
