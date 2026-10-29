# inbox-004 — Reply from card

**Outcome:** Implemented, reviewed and reflected on branch `inbox-004`.
**Integration target:** `inbox-integration`; parent owns integration and worktree closeout.
**Design:** `agent-work/decks/inbox-design-lab.html`, frozen D5/D6/D8/D9/D10.

## Delivered

- Catalog action `send` is labelled Reply. `p` opens the selected live parent's inline editor through the existing availability guard; unavailable targets show the reason and Open in Pi. The footer puts `p Reply` after Next request. Configured shortcuts are unchanged.
- Drafts live only in dashboard memory, bound to exact managed/Pi/interaction-instance identity. Escape keeps a draft, Ctrl+U clears it, and replacement/restart invalidates it. A new ready-handoff draft prefills `Go ahead: <recommendation>`; existing empty drafts stay empty. Nothing is sent before Enter; Accepted clears the draft.
- Idle Send expands templates; busy Steer/Queue remain literal through the guarded interaction socket. Submission rechecks availability/identity. An observed or transport-detected idle-to-busy race rejects without sending or losing text, then exposes explicit busy delivery. Shared receipts retain Submitting, Accepted, Rejected or Delivery unknown without silent retry. Pi's native editor is untouched.
- Reused inbox-003's `setCardPanel` / `clearCardPanel`, `renderFocusedPanel` and `writeInteraction`, plus `text-input.ts`. `RenderCardPanel.body` accepts string rows and `{ value, cursor }` input rows; input scrolls horizontally at the real host width. The existing string `keyLine` supports explicit newlines reserved outside the scrollable body. Slot methods and receipt API are unchanged. String-only clients remain supported; no view-specific editor renderer was added.
- Below 60 columns the header omits the repeated session title. At 60+ it retains the title. Busy phone keys use D8's four complete rows: Tab Delivery, left/right Steer/Queue, Enter delivery, Esc Keep draft. One shell serves fleet, both board hosts, pin and follow.
- Removed the send form purpose, open/submit handlers, delivery picker/render branch and form-only context wrapper. Adapted behavior tests to the replacement. Corrected three existing sentences in AGENTS.md / docs/STRUCTURE.md; each replacement is shorter. User-doc narrative remains with inbox-007.

## Review and reflection

- Parent review required compact headers and reserved busy key rows; regression tests cover the 30/59/60/80 boundaries and scrolling.
- Code-critic `e7b5e9d2-3619-4250-a137-2e4e6388025a`: accepted one duplicate-receipt finding, removed the reply-owned copy, then rerun **LGTM** with 71 focused tests passing. Confirmed mixed string/cursor rows across all five hosts. The wide board retains one receipt per distinct surface (card and side panel), not duplicate rows within either.
- Docs-critic `bd158ca3-d2f1-47a9-b21f-b1657229ac38`: **LGTM**, no findings. Replacement lengths decreased 110→103, 100→96 and 98→89 characters. Both reviewers completed; no rejected findings or open blockers.
- No follow-up tickets created or updated. Stale user-doc Reply descriptions remain assigned to inbox-007; questionnaire guidance belongs to inbox-005.

## Verification

- Baseline typecheck passed; new behavior tests failed against the retired dialog before implementation.
- Before commit, the authorized merge of local `inbox-integration` at `c2dca56` reported already up to date. No conflicts occurred.
- Post-merge `npm run typecheck`: passed. `npm test`: **1,412 passed, 0 failed**. Real-socket tests cover template-expanding idle dispatch, literal busy delivery and an unobserved busy race.
- Six production-renderer captures covered idle/busy replies at 80/60/30 columns. All fit width/height; 30-column headers and busy key rows match D8, while 60/80 retain the title as requested. Mixed-row, receipt-count and exact-target regressions cover every host.
- Retirement grep found no `openSendForm`, `submitSendForm` or `purpose: "send"` in source/tests. `git diff --check` and guidance-length checks passed. Temporary scripts, captures and logs were removed.

No push, PR or worktree cleanup is part of this ticket-branch handoff.
