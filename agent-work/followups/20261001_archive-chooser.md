# Archive chooser follow-up (session-closure-001)

User-approved fix after PR #16 merged. Not a new ticket or plan; the completed session-closure-001 ticket and history stay unchanged.

## Scope

- `A` opens a target-bound **Archive session** chooser: `d` Done, `x` Abandoned, `a` Archive only (no outcome), `Esc` cancels. No choice stops Pi or children.
- `C` is removed from the built-in catalog. Lowercase `c` Conversation is unchanged.
- `U` is the only Reopen. `A` and `B` are unavailable while closed. Open archived parents can still record Done/Abandoned through `A`; Archive only on an already archived row is a no-op.
- Workspace and palette show `Archive…` wherever `Close session…` appeared; closed rows show `U Reopen`.
- Persistence, row markers, workspace closure line, and runtime behavior are unchanged.

## Material choices

- `CloseDialog` → `ArchiveDialog` (`openArchiveDialog`, `handleArchiveInput`, `renderArchiveDialog`) in `src/tui/confirm-dialogs.ts`. The modal consumes every key, so `d`/`x`/`a` never reach Delete, close-pin, or Mark read.
- One action callback, `archiveSession(id, closure | undefined, expected)`, replaces the separate `closeSession` action. `archiveDashboardSession()` in `src/app/run-tui.ts` replaces `closeDashboardSession()`: it loads the latest saved registry and validates the parent and Pi identity before exact pin detach, then calls `closeSession` (outcome) or `moveSessionToBucket(..., expected)` (archive only).
- `SessionsController.moveSessionToBucket` gains an optional `expected` guard. With it, a missing, subagent, replaced-conversation, or closed latest row rejects. Without it, existing callers keep the silent no-op behavior. A shared `parentTargetFailure()` serves both controller paths.
- The catalog `restore` command keeps id `action:<id>:restore` and relabels to Reopen when closed; the `reopen`/`close` command ids are gone. `bucketAvailability` became `archiveAvailability` + `backlogAvailability` with B's rules unchanged.

## Verification

- Red check: updated tests run against the original `src` failed (14 tests, plus run-tui import failure).
- `npm run typecheck`: pass.
- Targeted `node --test` on sessions-view, dashboard-commands, controller, run-tui, render-model: 459/459 pass.
- Full `npm test`: 1054/1054 pass, including the final rerun after a pin-safety correction.
- Code critique found a stale-controller pre-detach guard. A regression test now covers externally replaced Pi identity for all three choices while the controller still shows the old conversation; latest-registry validation rejects without detaching. The regression failed before the correction and passed afterward. Final critic result: LGTM.
- No commit, push, install, branch change, source-checkout change, or completed-ticket/history rewrite.
