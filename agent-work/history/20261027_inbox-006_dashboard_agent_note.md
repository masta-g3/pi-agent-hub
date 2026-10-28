# inbox-006 — Dashboard agent note

## Outcome

Managed parent agents receive the approved dashboard supervision note on every turn through the existing `before_agent_start` hook in `src/extension/index.ts`.

- The note tells agents to use `ask_user_question` and `hand_off` if available, with self-contained context, a recommendation, and evidence for handoffs. Routine progress does not use these tools; a dashboard reply approves only its explicit content.
- Enabled only when `PI_AGENT_HUB_SESSION_ID` is nonempty, `PI_TMUX_SUBAGENTS_JOB_ID` is absent or empty, and `PI_AGENT_HUB_KIND` is not `subagent`.
- Prompt order is base, exact approved `DASHBOARD_NOTE`, then valid worktree guidance, separated by blank lines. Guidance remains trimmed and bounded; unmanaged Pi gets no note, and subagents get neither addition.
- Reused the existing hook, extension registration guard, and environment constants. No new config, state, dependencies, or tool detection.

## Verification

- Test-first: the new managed-parent prompt assertion failed before implementation.
- `npm run typecheck` passed.
- All 28 extension tests and all 1,307 suite tests passed. Tests cover exact text, repeated turns, note/guidance ordering, guidance bounds, unmanaged sessions, and both subagent guards; changed environment variables are restored.
- Review reran typecheck, the 28 extension tests, and `git diff --check`; all passed.
- Compiled into temporary directories under `agent-work/` to avoid replacing live `dist/`. Full-suite staging supplied its cwd-relative launcher and source path. All temporary outputs were removed.

## Review and reflection

- Code critic `3994076d-011f-46c3-80f1-b3173359e22f`: LGTM, no actionable findings; assessment accepted. No fixes or rejected findings.
- Critic result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/3994076d-011f-46c3-80f1-b3173359e22f/turns/001-result.md`.
- User-facing documentation stays with existing inbox-007; no follow-up ticket mutations. Adding implementation details to `AGENTS.md` would duplicate code and tests. Existing development guidance already covers isolated test execution.
- No durable docs changed; docs critic skipped. No scope changes or discovered work.

## Integration boundary

- Ticket branch: `inbox-006`; target: `inbox-integration`.
- Merged the local integration tip before execution and again before commit; both were already up to date.
- Parent owns integration and worktree closeout. No push, PR, or worktree cleanup authorized.
