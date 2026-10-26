# Footer and cursor fixes

- **Feature:** ui-polish-001
- **Status:** done
- **Branch:** `ui-polish-001` → parent-owned `ui-polish-integration`
- **Epic:** `agent-work/plans/ui-polish-000.md`

## Implemented

- Footer Enter reads `Open` at every width; widths 61–119 include `i Workspace`.
- Visible requests expose `] Next request`; phones add `] Next` before Help only when both fit. Existing phone tap-target order stays intact.
- Footer Backlog text reuses the catalog's `Show backlog` / `Hide backlog` label for the current filter.
- Width fitting drops Group, Board, New, then lower-priority hints before request navigation. Footer strings remain catalog-owned and the existing layout owns hit targets.
- The first normal render selects the first session in `visibleListTargets()` order. Explicit/restored selection and later navigation remain intact; source ordering, tier classification, and later selection repair are unchanged.
- Removed the unused `openWorkspace()` method.
- Updated `docs/FEATURES.md` to explain the optional phone Next hint.

## Accepted adjustment

The coaching footer bypassed the required Workspace/request hints. The parent accepted extending it through the same primary-controls and fitting path, retaining Ctrl+Q Return and unchanged no-request phone copy.

## Validation and review

- Tests first confirmed failures on the old footer and startup selection.
- Coverage exercises responsive widths 61, 80, 99, 100, 119, 120, and 160; request filtering; Backlog state; actual footer hit targets; Enter switching at width 100; startup selection; and explicit/later selection preservation.
- Execute: typecheck and all 1,150 tests passed. Review: typecheck and 497 focused tests passed.
- Before commit, merged integration tip `b278d66` (including ui-polish-003 readable color roles) via merge commit `e0a61eb`. Ticket changes reapplied without conflicts.
- Post-merge full suite: `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test` passed all 1,168 tests. `git diff --check` passed.
- `code-critic` accepted all eight source/test diffs without findings. Job: `1c16d94b-8652-467b-b542-4c3cba323b78`; result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/1c16d94b-8652-467b-b542-4c3cba323b78/turns/001-result.md`.
- `docs-critic` accepted the phone-footer correction. Job: `32652895-6c0c-4f24-b1b1-5a0dc8416ed0`; result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/32652895-6c0c-4f24-b1b1-5a0dc8416ed0/turns/001-result.md`.

## Reflection and follow-up

- Registered parent-approved pending `test-isolation-001`, discovered from this ticket. Inherited live subagent variables caused two full-suite timeouts; removing the child job marker allowed tests to finish. Test isolation remains unimplemented and is distinct from Git-hook isolation in `worktree-setup-004`.
- Existing Enter, workspace, and Backlog documentation already matched the reviewed behavior; only the phone-footer sentence needed correction.
- Dependency installation reported 13 existing vulnerabilities; dependencies were not changed.
- No temporary test code or retained ticket artifacts. Parent owns integration and worktree closeout; no push, PR, or worktree removal in this phase.
