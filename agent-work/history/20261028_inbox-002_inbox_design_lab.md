# inbox-002 · Inbox design lab

## Outcome

Completed the maintainer-approved visual reference for inbox-003, inbox-004 and inbox-005. The deliverable is `agent-work/decks/inbox-design-lab.html`, a self-contained offline deck with principles, captured current behavior, terminal-cell alternatives, field provenance and ten populated Frozen decisions rows. It describes approved future behavior, not shipped UI code.

All implementation phases and acceptance criteria passed. Review found no actionable issues. Reflection required no durable documentation changes.

## Frozen decisions

- **D1 · A, in-place expansion.** One shared selected-card shell contains request, actions and details. Fleet `Tab` opens supported answering; fleet `Enter` and double-click always open Pi. `?` is a request glyph, not an answer key. Pins and follow view remain opt-in.
- **D2 · A, width-only refinement.** Keep the complete task subtitle, or description only without a subtitle. Add an explicit request below it, never replace it. Put repo and branch beside `[group]` while they fit. Keep the producer workflow grid at 80+ columns, plain step name below 80, and task counts/age only at 160+. Only the selected card shows keys. Collapsed supported questions retain the full producer header and fit the question with an ellipsis. Expanded content scrolls without truncation. Do not drop task/request by runtime state or height.
- **D3 · A, independent requests.** Show producer question `?`, ready `✓` with recommendation/evidence, and blocked `!` separately from runtime. HEALTH shows runtime error and reason. NEW and ordinary waiting/idle rows imply no question. Plain waiting/idle can offer Reply; a handoff offers Reply / Open in Pi / Copy path, never invented options. Child requests do not promote the owner. Reading or acknowledging never approves a handoff.
- **D4 · A, rpiv look with Hub keys.** Use numbered options, a `Type something.` row and question tabs without importing rpiv's private view. Preserve producer order and original indices; no inferred recommendation flag. Show all descriptions at 100+, selected-only below. `Tab` opens; focused `Esc` leaves without declining; focused left/right switches questions; numbers select/toggle; `t` edits custom text; focused `Enter` advances or sends without another review modal. Unsupported prompts and subagents offer Open in Pi.
- **D5 · A, explicit reply editor.** `p` replaces the Send text dialog with the card editor. Idle Enter sends; busy Tab then left/right chooses Steer now or Queue for later. Esc retains an in-memory draft for the exact managed/Pi/interaction identity; restart drops it. Idle turning busy rejects and requires an explicit delivery choice. A new ready-handoff draft prefills `Go ahead: <recommendation>`; edits survive reopening, Ctrl+U clears, and only Enter sends.
- **D6 · A, target-bound receipt.** One in-memory receipt per exact live target. Submitting disables resubmit until response or the five-second timeout. Accepted clears on resumed running or the next write; an already-running snapshot is not a new transition. Rejected and Delivery unknown remain until explicit dismissal or target invalidation. No Retry, automatic resend or auto-jump. `]` moves on. Accepted means dispatch/resolution, not task completion or handoff approval.
- **D7 · A, current working cards.** No activity-led one-line rows in this epic. Activity remains producer-owned and stale activity is suppressed independently of runtime/workflow position.
- **D8 · A, shared narrow shell.** Keep the same inline shell at 60 columns. At 30 the selected answering/replying card fills the viewport; full text scrolls while identity and actions remain available. If height cannot fit identity plus action, show Open in Pi. Replace the current 40-column answering minimum; preserve disclosure/state slots and the worktree marker.
- **D9 · A, owning-ticket replacement.** Parent-owned sequencing inside one epic PR: 003 disables follow by default, 004 removes Send text, 005 removes Conversation answering and leaves `c` read-only. Keep `o` opt-in. Rename footer Workspace to Details on `i`, and Open to Open in Pi. All routes remain catalog-driven and exact-target guarded.
- **D10 · A, stable discovery loop.** Footer: `] Next request · p Reply · : All actions · ? Help`; at 30 columns: `] Next · p Reply · : Actions`. Focused editing shows local controls. One dismissable cue uses existing onboarding to explain Tab/p/Enter and Alt+W. Help and palette remain catalog-owned; session search only selects/reveals.

## Preview-source contract

The maintainer replaced the initial preview-marker proposal with real selected-option preview text. Read it from the exact current pending `ask_user_question` tool call in the supplied live branch, using Conversation's typed source. Guard conversation, interaction instance, branch and toolCallId; sanitize text and keep it out of heartbeat, registry and UI persistence. Official pending events need not carry preview bodies. Do not search conversation text, read session files or capture pane tails.

## Length evidence

The maintainer reviewed 1,388 question calls from May–October 2026: question median/p90 82/199 characters; header p90 14; description median/p90 92/154. Single-question questionnaires were 90%; option 1 contained Recommended in 86%; previews occurred in 12%. One-line questions fit 70% at 120 columns, 46% at 80 and 27% at 60. Authored fixtures match the 82/199 and 92/154 lengths without quoting private conversations.

## Verification and review

- Real baseline captured through `buildRenderModel` → `renderSessions` at `a7eca85`, using fleet-card fixtures at 120×26 and 60×26. The captures remained unchanged through maintainer revisions.
- Initial typecheck and all 16 fleet-card tests passed using temporary compiled output, not installed `dist`.
- Final deck has 43 specimens and 383 lines checked with Pi TUI `visibleWidth`. Offline Chrome opened the actual file with zero HTTP(S) requests or page errors. Checked frozen rows, A/B alternatives, field mappings, responsive thresholds, local keyboard precedence, NO_COLOR marker reversal and no page overflow at 1440/390/320 pixels.
- Two frontend-designer passes corrected specimen geometry, selection, provenance, tier placement and workflow-label consistency. The subsequent code-critic review returned LGTM with no actionable findings. `git diff --check` passed.
- Temporary scripts, screenshots and browser artifacts were removed. The deck is retained as the downstream design reference. No production code, dependencies or tests were added by this ticket.

## Integration and ownership

Work stayed on ticket branch `inbox-002`, targeting `inbox-integration`. Before closeout, merged local integration tip `60e5d1a`, including inbox-001 and inbox-006, without conflicts; ticket-local metadata edits were preserved.

The parent owns the epic pointer and preview-source propagation on the integration branch. Durable FEATURES/AGENTS changes already belong to inbox-007; no follow-up ticket was created or changed. The host-specific Playwright wrapper mismatch required no project guidance or tooling change. No durable guidance changed, so docs-critic was not needed.

Only local ticket-branch commit and handoff were authorized. Do not infer permission to push, create a PR, merge the ticket into integration or clean up its worktree.
