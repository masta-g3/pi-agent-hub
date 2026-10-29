# inbox-007 — Inbox-first docs

**Outcome:** Implemented, reviewed and reflected on branch `inbox-007`.
**Integration target:** `inbox-integration`; parent owns integration and worktree closeout.

## Delivered

- CONTEXT, README and FEATURES teach `]` Next request → `Tab` Answer or `p` Reply → `]`. Enter opens Pi, i toggles Details, and Alt+W opens the next request inside Pi. Pins and follow view stay opt-in.
- Preserved Hub's small/Pi-native identity, calm, visible, keyboard-fast, recoverable daily workflow and separate speed/reliability success criterion. Purpose remains two short paragraphs. Added Request and Reply terminology.
- Replaced stale fleet side/full-width workspace, Send dialog and Conversation-answer guidance with in-place cards, shared Answer/Reply panels, retained exact-target drafts and delivery feedback. Documented official stock rpiv 2.15+ answers, live selected-option previews, safe Escape, uncertainty without automatic retry, narrow controls and the width ladder. Conversation stays read-only.
- Documented the always-on managed-parent dashboard note and corrected contradictory Unreleased entries. Kept inbox-003–005's existing AGENTS/STRUCTURE corrections and catalog/onboarding text. The only code change renames Help's stale Action workspace heading to Selected card and Details.
- Updated existing guidance in place. AGENTS remains 70 lines and shrank from 2,669 words / 19,247 bytes to 2,666 words / 19,244 bytes. No new behavior, dependencies, tests that mirror strings, or duplicate command paths.

## Review and reflection

- Parent review restored the CONTEXT identity and separate fastest/most-reliable criterion without dropping inbox supervision. Purpose assertions confirm two paragraphs of 45/57 words and all requested terms.
- Docs-critic `b11f4727-fd7b-4731-b6bc-b614e9df4103`: LGTM, no findings accepted/rejected. Result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/b11f4727-fd7b-4731-b6bc-b614e9df4103/turns/001-result.md`.
- Code-critic `d10afe9a-fa83-4b92-a00a-4c9b4df60e3f`: LGTM, no findings accepted/rejected. Result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/d10afe9a-fa83-4b92-a00a-4c9b4df60e3f/turns/001-result.md`. Both agents stopped automatically.
- Reflection found no remaining missing or contradictory guidance. Existing docs already preserve selected task/request text and delivery feedback; none describe selected text as truncated or delivery results as hideable. No durable reflection edits, new rules or follow-up tickets. Reflection docs-critic skipped because no guidance changed.

## Verification and integration

- Started at the supplied integration tip `d0e90f3`, including inbox-001–006. Verified claims against shipped code and archived ticket outcomes, not open designs.
- Execute: typecheck and all 1,439 tests passed. Production SessionsView captures at 160/120/80/60/30 columns checked task/request anatomy, Answer, Reply, Details, preview, Escape and footer controls within width/height bounds. Production Help terminology and 36 local Markdown links/anchors passed.
- Review: typecheck, 21 focused Help/action tests, CONTEXT assertions and whitespace checks passed.
- Before commit, performed the parent's authorized fast-forward merge of local `inbox-integration` at `bf62f8a`, which retains full selected-card text and receipts in every view. No conflicts or stash were needed; reviewed docs remained intact. Post-merge `npm run typecheck` passed; `npm test`: **1,442 passed, 0 failed**. Retirement greps and `git diff --check` passed.
- Temporary validation logs/scripts were removed. No ticket scratch artifacts remain. Ignored node_modules and test-generated dist stay for parent-owned closeout. The active plan is archived here and the ticket is marked done.

No push, PR or worktree removal is authorized. Parent owns final integration and cleanup.
