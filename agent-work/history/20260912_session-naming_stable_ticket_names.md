# Stable ticket session names

## Outcome

Linked sessions keep their ticket title through workflow stages, refresh, and manual or agent rename attempts. The workflow runtime owns native-name enforcement and restores the canonical title on resume. Title-less tickets use their ticket ID while initial name generation is pending, then retain the generated name while linked.

Hub disables Rename for validated ticket context and rejects pending manual requests without replaying them after unlinking. Existing draft-safe name commands remain the transport; no duplicate ticket title is persisted in Hub.

Native Pi forks and compact forks release the child name when they clear the ticket; the original session stays unchanged. Hub and Rules capture the compact-fork attempt token during registration and consume it at startup. The published token/receipt preparation contract remains intact; Rules also accepts the boolean marker used by the earlier development snapshot.

The user's existing Ctrl+N shortcut now sends `/session-name refresh`; other shortcut settings remain unchanged.

## Scope

- Hub: draft-safe name-command transport, rename catalog, caller, extension guards, and their tests/docs. Closeout preserves the published fork-preparation and workflow-operation behavior rather than committing stale checkout reversions.
- Rules: `extensions/workflow-runtime/index.ts`, `tests/workflow_runtime_extension.test.mjs`, `README.md`, and `docs/STRUCTURE.md`.
- Concurrent New/Fork default-name work is separate. Ticket ownership takes precedence over those provisional names.

## Verification

- Review: 306 targeted Hub tests and 85 Rules tests passed; isolated TypeScript compilation passed.
- Final Hub closeout validates naming-only changes against published HEAD: all 951 tests passed. Unapproved historical fork/workflow reversions stay outside the commit.
- Independent Pi SDK checks covered native naming, workflow stages, fork, resume, both extension startup orders, exact conversation identity, and heartbeat confirmation. Model compaction was stubbed; no live session or model call was used.
- Review closed the pending-generation rename bypass and corrected a test to assert a real workflow transition. Second code review and documentation review passed.
- Documentation explains ticket ownership, fork behavior, startup-marker coordination, and test-environment isolation.

No live Hub build or installed-extension reload was performed.
