# Readable color roles

- **Feature:** ui-polish-003
- **Branch:** `ui-polish-003` → `ui-polish-integration`
- **Epic:** `agent-work/plans/ui-polish-000.md`
- **Worktree:** `/Users/manager/.local/share/agent-worktrees/ui-polish-003-c79b1af00723/pi-agent-hub`

## Outcome

- Dashboard, workspace, footer, forms, palette, question frames, and Conversation use `muted` or stronger for information. Remaining dim spans in these surfaces contain only decoration: separators, tree branches, badge brackets, and empty workflow-grid placeholders.
- Selected owner trees render dim decoration in `muted`, including when a child is selected. Existing owner-tree selection painting and exact command targets are unchanged.
- Disabled palette commands render key, label, and reason in `muted`, not `error`, while retaining selected-row backgrounds. Enabled hints also use `muted`; catalog ordering is unchanged.
- Reused existing theme/layout helpers and tokens. Built-in values and Pi theme mapping are unchanged. No new state, dependencies, or behavior paths were introduced.
- `docs/STRUCTURE.md` owns the color-role guidance and corrects stale repository-count and selected-badge wording. `AGENTS.md` provides a short rule and pointer.

## Validation

- Baseline: 1,140 tests passed.
- TDD: all 18 new color-role guards failed before implementation, then passed at 80, 120, and 160 columns. Coverage includes fleet tiers, board, workspace, footer, forms, palette disabled/selected rows, questions, Markdown links, and Conversation.
- Updated three legacy assertions from dim to muted for worktree markers and form hints. `test/theme.test.ts` passed unchanged.
- Full suite: `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test` — **1,158 passed**. The inherited child-job variable suppresses parent heartbeat publication, so it is cleared only for the test process.
- Review: `npm run typecheck`, 54 focused compiled tests, and `git diff --check` passed.
- `code-critic` job `553090c3-e1ac-4c4b-8a0c-add200214e75`: LGTM, no actionable findings.
- `docs-critic` job `96e4c716-f36f-454a-84c1-436879e38e80`: LGTM, no findings.
- Integration tip was merged before execution. The required pre-commit merge reported already up to date; no further code changes required a full-suite rerun.

## Reflection outcomes

- Resolved color-role documentation drift in `AGENTS.md` and `docs/STRUCTURE.md`.
- Other informational dim uses in confirmation hints, repo-picker details, theme-picker overflow, and clipped Help notices remain parent-owned discovered work. No fixes or follow-up ticket mutations were made here.
- Dependency installation reported 13 audit findings (4 moderate, 8 high, 1 critical). These remain parent-owned discovered work; dependencies were not changed.
- No durable test-policy update was needed for the child-job environment issue; the working command is recorded above.

## Integration handoff

Plan archived and ticket completed for commit. The parent owns integration and worktree closeout. No push, PR, or worktree cleanup is authorized for this ticket runner.
