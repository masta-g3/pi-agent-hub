# cockpit-013 — Conversation workspace

## Scope and repositories

- Hub: `cockpit-013`, based on `main` at `91e9ffc`; PR target `masta-g3/pi-agent-hub:main`.
- Question package: `cockpit-013`, based on upstream `main` at `7392135d`; maintained fork and PR target `masta-g3/rpiv-mono:main`.
- Work ran in the two approved ticket worktrees. The original checkouts and unrelated edits were preserved. Publishing to npm and merging PRs were not authorized.

## Implemented

- Optional `c` Conversation panel below the fleet; the ordinary overview remains the default. Preserve selection, grouping, and native attach behavior. Conversation and pinned panes are separate modes.
- Read completed user/assistant text and validated question/answer exchanges from the selected live Pi branch. A muted fixed title, indented text, and distinct `YOU`/`PI` turn rules separate chrome and speakers. Clipped messages retain speaker identity.
- Pending questionnaires appear inline. Focused number keys select/toggle, `t` edits custom text, and Enter advances or sends the last answer set without a review screen. Preserve previews, multiselect, previous answers, and local Escape/hide without cancelling Pi.
- History and question paging use their actual viewports so short panels do not skip text. Retain visible Send controls, exact mouse targets, bounded cached history, stable paging, and later-message cues.
- Reuse the dashboard catalog for Answer, Open in Pi, and configured commands. Dispatch configured text through Pi only when idle, with no queued messages, blocking prompt, or editor draft. Keep the existing `p` behavior.

## Ownership and safety

- A bounded local Unix-socket bridge binds managed session, Pi conversation, and process nonce. Branch changes and reload invalidate stale requests. Do not replay uncertain writes automatically.
- The question package owns one native/external completion resolver; the first valid submission wins. Validate exact request and answer identities. Refresh cannot replace an in-flight form or submit to a newly selected session.
- Heartbeats advertise only transient capability. No pane capture, conversation-file reader, thinking/raw-tool display, conversation search, persisted duplicate transcript, general composer, or inferred workflow advancement.
- Remote question answering is TUI-only. The existing questionnaire remains intact; native and RPC answer mapping share the small extracted helper.

## Distribution and documentation

- Maintained patch: `@juicesharp/rpiv-ask-user-question@2.10.0-hub.1`. The tested archive remains under `agent-work/tickets/cockpit-013/` for transfer to the work machine.
- Install the archive with npm into a versioned prefix, then register its package directory in Pi. Replace the original source entry; do not register both tools. Instructions live in the question package's `docs/hosts.md`.
- The user approved installation on this Mac only. The global Hub and one patched questionnaire source were installed; settings outside that source entry and running sessions were preserved. Private rollback copies remain available.
- Updated Hub AGENTS/STRUCTURE contracts. Focused, approved reflection added Conversation controls and corrected outdated restrictions in `docs/FEATURES.md`; docs-critic feedback was resolved.

## Verification and review

- Hub: **1,025 tests passed**, then `npm run package:check` passed. Clean feature-only staging and installed-module comparisons passed.
- Question package: **689 tests in 37 files passed**, plus scoped formatting/type checks, repository TypeScript, and lockfile dry-run.
- Disposable real Pi 0.85.1/tmux tests verified canonical native completion, concurrent dashboard submissions, session isolation, reload identity, command/draft/question guards, skill expansion, successive inline questions, mouse/keyboard answers, and narrow layouts. The deterministic provider used no network credentials or model requests.
- Final code-critic recheck: **LGTM**. Removed superseded side-panel/modal/review paths, duplicate identity logic, and test-only production exposure. Fixed sticky confirmation and viewport paging regressions.
- `agent-work/tickets/cockpit-013/validation.md` retains bounded evidence and package identity. Before/after images use synthetic render fixtures, not user sessions. Temporary scripts, compiler output, servers, and captures were removed.

## Remaining boundaries

Stopped-session history, streaming text, notes/external editing in Hub, simultaneous pins with Conversation, and RPC-host remote answers remain outside scope. PR merge and worktree cleanup require separate confirmation.
