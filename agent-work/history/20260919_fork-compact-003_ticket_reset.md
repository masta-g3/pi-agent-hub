# Ticket reset

**Feature:** fork-compact-003 → Ticket reset
**Status:** Complete
**Session:** 01a0b8ad-0286-73c7-a78f-bd1456d05718
**Repositories:** pi-agent-hub and rules, existing main checkouts; no worktrees

## Delivered

- Rules `/wf-ticket clear` unlinks the ticket, removes its plan display, ends Focus, and releases name protection. It preserves workflow position, activity, passes, and positional completion.
- `/wf-clear` clears both workflow and ticket. Both commands invalidate pending old-task work and attention without aborting the current response or changing the session name, authored files, or backlog status.
- Commands, native Pi forks, and compact-fork startup share Rules cleanup. Cleared context and workflow entries survive reload/resume. Completed-rail shortcut dismissal still keeps the ticket linked.
- Hub generates one attempt token for Fork and compact. Rules writes its matching reset receipt after both cleared projections. Hub verifies the receipt and current cleared state before compaction and again before success.
- Hub defers reset waiting and interaction/MCP initialization so later Rules startup handlers can run. Shutdown and session replacement invalidate pending work and dispose late-returned cleanup handles.
- The launcher accepts only the exact child's matching operation result. Missing reset confirmation fails before compaction, including when Rules is absent. Errors leave the child inspectable; the source session stays unchanged.
- Removed metadata hiding that could make a still-linked child appear reset. Ordinary Hub forks retain their ticket link; ordinary compaction preserves task state.

## Review and reflection

Review reproduced and fixed a completion race: relinking during awaited compaction-state restoration could still publish success. The final reset check now runs after restoration. A failing-first regression covers this case. Both code-critic passes returned LGTM.

Approved documentation corrections cover Rules commands, Hub reset requirements and naming, and isolated full-suite setup. Removed references to nonexistent preparation recovery controls. Docs critic returned LGTM.

## Verification

- Rules full suite: 60 pytest cases passed. Its runtime wrapper passed again after the additional pending-plan-read regression and during Review.
- Hub Review: TypeScript compilation, 61 focused tests, and all 1,002 tests passed in a feature-only temporary source snapshot.
- Nine cross-repository scenarios passed using the real Pi SDK, actual extension factories, and disk-backed SessionManager. Both load orders verified cleared entries before receipt before compaction. Native, agent, and Hub rename paths worked after reset and reopen/resume. Source-session and authored-file bytes stayed unchanged.
- Compaction integration used deterministic summary output through the real callback path, not a hosted model.
- Startup tests passed with inherited subagent markers after their fixture was isolated. Rules tests require removing the managed primary-cwd variable unless explicitly testing it.
- Both repository diffs passed whitespace checks. Temporary validation scripts, snapshots, and outputs were removed.

## Boundaries

No installation, push, dashboard restart, or live-session mutation was authorized. Paired deployment and real installed-dashboard/model smoke require separate approval. Unrelated sidebar changes and their tracking were excluded from these commits.

The existing 15-second lifecycle timeout and broader preparation UX remain separate under `fork-compact-002`. No new agent tool, registry state, dependency, automatic rename, or MCP partial-initialization repair was added.
