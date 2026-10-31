# inbox-005 — Answer from card

**Outcome:** Implemented, reviewed and reflected on branch `inbox-005`.
**Integration target:** `inbox-integration`; parent owns integration and worktree closeout.
**Design:** `agent-work/decks/inbox-design-lab.html`, frozen D1/D3/D4/D6/D8/D9/D10.

## Delivered

- `Tab Answer` opens the selected live parent's supported questionnaire through the shared card panel in fleet, both board hosts, pin and follow views. Fleet Enter remains Open in Pi. Unsupported prompts retain the producer reason and Open in Pi.
- Reused `QuestionDialog` for ordered numbered options, cursor pointer, multi-select checks, numbered Type something row, literal custom input and question tabs. Every option description appears at 100+ columns; below 100 only the cursor description appears. Full question and preview text wrap and scroll. Staged choices survive navigation and Escape for the exact interaction target/tool call; sending requires every question's confirmed answer. Changed single-select choices require confirmation again. Escape never declines, and Accepted never advances selection.
- The extension reads previews only from the exact pending `ask_user_question` tool call on the live branch. Text uses Conversation's sanitizer, an 8 KiB encoded per-option cap, and the remaining complete-response byte budget. Missing branch calls retain preview-in-Pi markers. Preview text stays transient, outside heartbeat, registry and UI persistence.
- Answers use inbox-001's official rpiv 2.15+ events and inbox-003's shared receipt/bookkeeping path. Submitting, Accepted, Rejected and Delivery unknown stay local; bookkeeping/acknowledgement errors cannot turn delivery into rejection. Native-first races close stale forms. Uncertain answers cannot retry after leaving and reopening focus.
- Removed Conversation's answer renderer, question focus and question mouse routing. Conversation remains read-only typed history; entering answer focus closes it. The versioned dismissable inbox cue teaches Tab, Reply, Open in Pi, safe Escape and in-Pi next-request navigation through existing onboarding state.
- The shared shell word-wraps prose, reserves identity/local keys and at least one body row, drops status before hiding that last body row, and falls back to Open in Pi when too short. Shared exact-target workspace retention keeps narrow-board receipts visible without answer-specific view branches. Escape releases navigation for both editors.

## Integration, review and reflection

- Authorized integration merges reached `c2dca56` before execute and `2f2cb05` before reflection. Reconciled `layout.ts` and `sessions-view.ts` with inbox-004's cursor-aware body rows, newline-reserved key rows, and reply draft invalidation. Slot and receipt methods remain unchanged; answer string-only return typing remains precise. Temporary exact-ID preservation stash was restored and removed without touching other stashes.
- Owning review fixed narrow-board receipt retention, staged-form availability recovery after disconnect, and immediate Escape navigation. Integration added the matching reply Escape regression/fix. No unrelated scope or follow-up tickets were added.
- Code-critic `090f21cc-378c-4f02-95e2-bfc0a08445a1`: three passes, all **LGTM**, no findings accepted/rejected. Final pass checked review fixes and ran 52 focused tests. Result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/090f21cc-378c-4f02-95e2-bfc0a08445a1/turns/003-result.md`.
- Corrected existing AGENTS.md/STRUCTURE.md guidance for read-only Conversation, shared-panel answering, official events, Escape, preview boundaries and the short-height fallback. Every replacement is shorter: 715→692, 363→316, 179→175 and 49→37 characters. User-doc narrative remains with existing inbox-007.
- Docs-critic `7b55a9b7-8515-4b8c-92a5-5da1766dceeb`: **LGTM**, no findings. Result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/7b55a9b7-8515-4b8c-92a5-5da1766dceeb/turns/001-result.md`. Both specialists were stopped after completion.

## Verification

- Baseline: typecheck and 1,365 tests passed. Execute: 1,388 passed. Review: 1,391 passed. After inbox-004 reconciliation: `npm run typecheck` passed; `npm test` **1,439 passed, 0 failed**. `git diff --check` passed.
- Installed stock `@juicesharp/rpiv-ask-user-question@2.15.0` and temporary `tsx` only in a `mktemp` directory. Its unmodified answer channel, Pi's actual event bus, Hub's socket and real SessionsView card path accepted single/multi/custom answers, retained real selected previews, and rejected native-first stale and RPC-only cases. User Pi configuration was untouched.
- Real renderer captures at 120/80/60/30 columns matched the approved answer anatomy and stayed width/height-safe. Tests cover all five hosts, long content, full-frame preview bounds, exact-target invalidation, receipts, uncertainty and bookkeeping failures.
- Before commit, `HEAD` and local `inbox-integration` both remained at `2f2cb0560d83fbe7b5d7a14ed6b1c8c371513e2a`; no further merge was needed. Temporary scripts, packages, captures and logs were removed. Only permanent tests and this summary retain evidence.

No push, PR or worktree cleanup is part of this ticket-branch handoff.
