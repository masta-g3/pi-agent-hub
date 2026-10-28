# inbox-001 — Official answer protocol

Completed 2026-10-27 on branch `inbox-001`; integration target: `inbox-integration`.

## Outcome

- Replaced the forked questionnaire discovery/submit client with stock `@juicesharp/rpiv-ask-user-question` 2.15+ events. The Pi extension tracks validated `rpiv:ask-user:prompt` / `rpiv:ask-user:blocked` events and submits `rpiv:ask-user:answer` attempts with a fresh `requestId`, matched to `rpiv:ask-user:answer-result` verdicts.
- Reused the existing interaction socket, deduplicated receipts, exact-session and branch guards, answer model, and Conversation answer UI. Native closure, stale races, concurrent questionnaires, dashboard reconnection, branch changes, rejected answers, unsupported hosts, and unconfirmed delivery have coverage. Unconfirmed delivery never retries automatically.
- Added specific update/Pi-only reasons with **Open in Pi**. Preview-bearing options remain answerable and show **preview in Pi**; the retired inline-preview renderer and fork-only tests were removed.
- Updated CONFIG/FEATURES installation and usage guidance. Reflection clarified the official event contract in AGENTS/STRUCTURE with minimal wording; wider inbox documentation remains owned by inbox-007.

## Decisions and scope

- Answering remains in Conversation for this ticket; inbox-005 owns card answering. Only explicit producer events supply questions; no pane or conversation scraping.
- Parent approved preserving historical `agent-work/history/`, `agent-work/tickets/`, and `agent-work/install/` evidence. Retired-protocol removal checks cover `src/`, `test/`, `README.md`, `docs/`, `AGENTS.md`, and `CONTEXT.md`. The old installation patch is historical evidence, not current installation guidance.
- Merged local `inbox-integration` at `5061c80` (including inbox-006) before commit. Fast-forward merge required no code conflicts; inbox-001 ticket metadata was reapplied through the ticket helper while retaining inbox-006 completion.
- No follow-up tickets or unresolved reflection candidates. Parent owns integration and worktree closeout; no push, PR, or worktree cleanup authorized.

## Verification

- Execute: `npm run typecheck` and full `npm test`: 1,318 passed.
- Real-package check: installed stock rpiv 2.15.0 and temporary `tsx` in a `mktemp` directory. Its unmodified `registerAnswerChannel`, Pi's actual `createEventBus`, and Hub's Unix socket accepted a Hub answer, rejected a native-settlement stale race, and reported an unsupported RPC host. Producer-owned selected preview content remained intact. Temporary files removed; user Pi configuration untouched.
- Review: typecheck and six relevant suites passed, 126 tests. Code critic returned LGTM; no findings or fixes. Job `d27deb70-ca76-4209-a3cc-9300ff5458cc`; result `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/d27deb70-ca76-4209-a3cc-9300ff5458cc/turns/001-result.md`.
- Reflection: docs critic returned LGTM; no findings or fixes. Job `02414899-7c1a-4a51-b114-0a1775aea5a0`; result `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/02414899-7c1a-4a51-b114-0a1775aea5a0/turns/001-result.md`.
- After the integration merge: `npm run typecheck`, `npm run build`, and seven relevant suites passed, 154 tests: session-interaction, interaction-response, conversation-ui, conversation-panel, dashboard-commands, color-roles, and extension (including inbox-006).
- Diff whitespace, documentation pointer, and scoped retired-protocol checks passed. No scratch/test artifacts retained; ignored build output and dependencies remain for parent-owned closeout.
