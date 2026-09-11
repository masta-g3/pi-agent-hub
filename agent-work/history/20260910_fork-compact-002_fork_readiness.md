# Fork readiness

Feature: `fork-compact-002`
PR targets: `main` in `pi-agent-hub` and `rules`.

## Outcome

Fork and compact leaves the dashboard usable while preparing a child. Only that child is gated until verified task reset and successful compaction, including Pi-confirmed no-work completion. Failed children support inspection and explicit same-child retry. Ordinary sessions remain openable during compaction.

## Design and boundaries

- Hub registers durable `forkPreparation` intent before launching Pi. Exact-attempt reconciliation accepts terminal results without inferring success from elapsed time. Launch and reset confirmation have separate bounds; model compaction has no success timeout.
- Rules owns the actual ticket, attention, workflow, plan, and focus reset. Both extensions capture the launch token at registration and consume it at startup. Rules publishes a reset receipt only after cleared producer entries. Capability or inherited producer entries require that receipt, regardless of extension order.
- Hub stores preparation checkpoints bound to managed and Pi session identities. Copied checkpoints cannot unlock another fork. Completed reset survives resume without rerunning compaction.
- Generic compaction operation evidence remains independent of workflow, focus, runtime liveness, and durable preparation. Callback finalizers retain persistence ownership and drain before shutdown.
- Catalog and application guards cover pending-child access, CLI routes, and delayed sidebar actions. Retry resumes the same conversation with a new attempt, not another fork. Unknown activity and active compaction block retry.
- Source conversations and shared repository files remain intact. Raw tmux commands are outside Hub's access enforcement. Normal fork and fresh-restart behavior remain unchanged.

## Review corrections

- Preparation-only changes advance row versions without refresh churn.
- Explicit stop prevents deferred compact-fork launch; matching terminal evidence still takes precedence during reconciliation.
- Normal forks remain registered after setup failure. Compact-fork deadlines and cleanup do not change normal fork recovery.
- Operation phases require string literals, without coercion or unsafe casts.

## Verification

- Hub: 937 tests passed. A final narrowed guard passed 37 focused lifecycle, heartbeat, and preparation tests with TypeScript compilation.
- Rules: both workflow-runtime pytest wrappers passed with `PI_AGENT_HUB_PRIMARY_CWD` removed from the test environment.
- Package validation passed sequentially after implementation tests.
- Real Pi 0.85.1 and private-tmux fixtures passed both extension orders, delayed compaction beyond 15 seconds, short-history success, provider failure, cancellation, missing producer, dashboard restart, concurrent other-session use, and same-child retry. Source SHA-256 checks passed.
- Final code critic and docs critic returned LGTM. Both repository diffs passed whitespace checks.
- Detailed integration evidence: [validation](../tickets/fork-compact-002/validation.md).

## Documentation and deployment

Hub README and feature/configuration/development/structure docs describe readiness, recovery, Pi 0.85.1 minimum, and producer ownership. Rules README and structure docs describe explicit CLI-fork reset semantics. No project meaning or additional agent guardrails were needed.

Deployment requires updated Hub and installed Rules workflow extensions together. Rules source edits do not update its deployed copy. No package or extension was installed or deployed as part of this work.

## Closeout scope

The approved branches are `fork-compact-002` in both repositories. The original Hub checkout has unrelated changes and an existing bare-configuration issue; it was not repaired or staged. The canonical tracked ticket and archive travel in the Hub PR. No deferred implementation is required. Deployment and post-merge worktree cleanup remain separate user-invoked actions.
