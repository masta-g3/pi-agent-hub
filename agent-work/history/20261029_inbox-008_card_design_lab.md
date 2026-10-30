# inbox-008 · Card design lab v2

## Outcome

Completed the maintainer-approved visual reference at `agent-work/decks/inbox-card-lab.html`. The self-contained offline deck contains 34 terminal specimens, six real-renderer captures, seven variant comparisons, the E8 notes contract, field provenance and nine populated Frozen decisions rows.

All implementation phases and acceptance criteria passed. Review returned LGTM. No production code, dependencies, tests or durable guidance changed. The deck describes approved future behavior, not shipped UI.

## Frozen maintainer choices

- **E1 · A, selected-card frame.** Enclose identity, request and local actions in one selected request card. Keep unselected neighbors quiet and one shared card shell.
- **E2 · A, ask first.** Lead with the final asking sentence, preserve all numbered conditions as rows, fold background under `C Context`, and keep exact text on `O Original`. Keep the conservative as-written fallback. All seven conditions remain visible; the expanded specimen also shows the safety-relevant dry-run promise folded into Context.
- **E3 · A, option tiles.** Full-width cursor highlight, literal key-cap numbers and an explicit-marker-only Recommended badge. Cursor is not consent or a checked state. Keep all descriptions at 100+ columns and cursor-only descriptions below 100; hanging indents remain readable without color.
- **E4 · A, conservative visual co-location.** Only the deck's exact catch-all allowlist may share a line with Type something. Preserve producer order, original indices, N+1/t custom typing, both cursor stops and separate option/custom payload kinds. Do not perform semantic answer merging; distinct descriptions, previews, multi-select and ambiguous cases retain separate rows.
- **E5 · A, border placement.** Identity/grid labels occupy the top zone; complete local controls occupy the bottom edge or adjacent fitted lines. Preserve producer vocabulary, title/worktree priority and one group label. These are named D2 selected-card metadata refinements.
- **E6 · A, quiet feedback.** One acceptance emphasis settle with identical `✓ Sent · Accepted` wording, followed by a quiet receipt. Preserve D6 timeout, clear, rejection and uncertainty rules; no resend, auto-jump or timed receipt dismissal. Quiet-card spacing compacts without losing information.
- **E7 · A at 60, B at 30.** Frame the selected card at 60; use open edges at 30. Keep identity and complete keys fixed while the full body scrolls. The hard screenshot question is shown in interactive 60×24 and 30×24 viewports. Keep the Open in Pi fallback when height cannot support an action.
- **Agent note, unchanged.** “Lead with the question in one sentence; put the context needed to choose in option descriptions or previews.” Retain the existing self-contained decision and trade-off guidance.
- **E8 · Added by the maintainer.** In answer focus, `n` attaches a note to the current question. Show it under the chosen option and send it in that question's official answer payload `notes` field. A note supplements the choice; it is not a custom answer. Bind it to the question and exact pending tool call. Outside answer focus n remains New; inside input it is literal text. No E8 specimen was required or added.

The maintainer approved E1–E7 and the agent sentence unchanged. E8 is an explicit additive payload requirement: current Hub `AnswerInput` and the official-event adapter omit notes, so downstream implementation must carry that field. No runtime support was added here. Other v1 decisions remain frozen except the named presentation refinements recorded in the deck.

## Verification and review

- Baseline: `npm run typecheck` and 46 existing fleet-card/answer tests passed using temporary compiled output, without touching installed `dist`.
- Six captures came from `SessionsView` at `9410d88`, focused through Tab, fixed clock `1800000000000`, 40 rows, Catppuccin Mocha tokens, widths 120/80/60 and long/median fixtures. Embedded captures match the original renderer lines.
- Final geometry: all 34 specimens / 674 terminal rows are width-exact under Pi TUI `visibleWidth`, with field annotations. All seven asking-sentence conditions survive display-only formatting.
- Offline Chrome checks passed at 1440/390/320 pixels: no page overflow, HTTP(S) requests or page errors. Tested delivery frame controls, keyboard Original disclosure, E8 navigation, nine populated approval rows, narrow Page Down scrolling with fixed identity/keys, NO_COLOR marker contrast and workflow-grid alignment.
- One frontend-designer critique corrected context provenance, complete keys, unused C/O disclosure bindings, group duplication, narrow indentation, receipt truthfulness and long narrow fixtures. Both catch-all cursor stops and the folded dry-run promise are explicit. The bracket-style suggestion was rejected as a nit.
- Code-critic job `3f4e8d2c-74ce-442f-802f-e20083066018` returned LGTM with no findings. No review corrections were required. Whitespace checks passed.
- Temporary scripts, compiled output, browser snapshots and screenshots were removed. Only the approved deck and this archived plan remain as useful workflow artifacts.

## Reflection and integration

No durable reflection updates were warranted for a deck-only ticket. Docs-critic was skipped because no guidance changed; no follow-up ticket was created or updated. The epic pointer remains parent-owned.

Work stayed on `inbox-008`, targeting local `inbox-integration`. Before committing, ran `git merge --no-edit inbox-integration`; it reported already up to date at `9410d884d5ebe756ba5a078443063ca0985f3e7f`. Only local commit and integration handoff are authorized. Do not push, create a PR, merge the ticket into integration or clean up the worktree without parent authorization.
