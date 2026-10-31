# inbox-009 — Framed request cards

**Outcome:** Implemented, reviewed and reflected on branch `inbox-009`.
**Integration target:** `inbox-integration`; parent owns integration and worktree cleanup.
**Design:** `agent-work/decks/inbox-card-lab.html`, approved E1–E8.

## Delivered

- Reused the shared panel renderer for selected no-pin request/editor/retained-receipt frames. Other cards and board/pin/follow hosts stay unframed. Top identity carries the worktree marker, one group badge and the card's producer labels above markers at 80+; group moves to metadata if needed. Complete local keys stay at the bottom. At 60 the request frame remains inside a frameless dashboard; at 30 its sides open and identity/keys stay fixed around a scrolling body. Normal fleet windowing still retains neighboring sessions and headings.
- Added display-only question formatting: final asking sentence first, numbered conditions as hanging rows, `C` Context, `O` Original. Ambiguous code, quotes, abbreviations or parenthetical boundaries keep the original text. Fixed the shared hanging-indent wrapper to wrap once at its actual text width.
- Cursor option tiles span wrapped descriptions and use `[1]` key caps independently of multi-select checks. Only standalone explicit `(Recommended)`/`[Recommended]` markers produce a badge. Descriptions remain all-at-100+, cursor-only below.
- Catch-all co-location preserves the original option index and N+1/`t` custom route. It requires one final single-select allowlisted catch-all with no recommendation or preview. Parent clarification: `hasPreview: false` and absent/empty preview mean no preview; true flags or preview text exclude it. Stock-shaped screenshot regressions cover both payload routes.
- `n` opens a per-question note editor. Enter saves; Esc returns without discarding or confirming an answer. Notes survive pages and Escape for the exact interaction target/tool call, are capped at 8,192 UTF-16 units, and map from `AnswerInput.notes` into official rpiv `answers[].notes`. No questionnaire-level note or new empty-selection policy was added. Opening an editor reveals it below long questions.
- State explicitly advertises `answerChannel: "rpiv-events"`. Tab on unavailable questions explains why while retaining Open in Pi; old bridges request `/reload`. No-question Conversation Tab keeps its focus cycle. The dashboard agent note now asks agents to lead with one question sentence and put choice context in descriptions/previews.
- Accepted receipts show `✓ Sent · Accepted` with one 600 ms emphasis settle, without movement or timed dismissal. Existing rejection, uncertainty and receipt invalidation rules remain. `NO_COLOR` and `PI_AGENT_HUB_REDUCED_MOTION=1` use the static final receipt; dashboard recreation preserves the switch. Ready handoffs gain one blank after the task only when room allows.

## Review and reflection

- Code-critic `ebbcac91-a5b2-40cb-9c34-9223280e6fb3`: accepted both first-pass findings (Conversation Tab interception and unsafe abbreviation/parenthetical splitting). Added failing regressions, fixed them, then extended the unchanged-text fallback for periods inside quoted/code labels. Final two passes reported no actionable findings. Results: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/ebbcac91-a5b2-40cb-9c34-9223280e6fb3/turns/001-result.md` through `003-result.md`.
- Corrected AGENTS.md, STRUCTURE.md and FEATURES.md in place for frame/group/grid ownership, outer-shell and gutter exceptions, display-only C/O, tiles/badges, notes and reload guidance. All 21 replacement regions are no longer than their originals; all three files shrank overall. CONFIG.md documents reduced motion beside the existing environment switches.
- Docs-critic `cf04bc47-01f5-4efe-8231-aaa40223f4fd`: no actionable findings or edits. Result: `/Users/manager/.pi/agent/pi-tmux-subagents/jobs/cf04bc47-01f5-4efe-8231-aaa40223f4fd/turns/001-result.md`.
- All reflection candidates resolved. No follow-up tickets, dependency changes, or unrelated implementation scope. Specialists completed and stopped automatically.

## Verification and integration

- Baseline: 1,447 tests passed. Final review and pre-commit: `npm run typecheck` passed; `npm test` passed **1,468 tests, 0 failures**. `git diff --check` passed.
- Stock `@juicesharp/rpiv-ask-user-question@2.15.0` and temporary `tsx` ran only in a `mktemp` directory. Its unmodified answer channel, Pi's actual event bus, Hub's socket and real SessionsView accepted notes with single-select, multi-select and custom answers. Checked settled notes, original indices/text, Accepted and absence of `globalNote`. No `~/.pi` changes.
- Eight real SessionsView captures covered the screenshot question and ready handoff at 120/80/60/30 columns and 40 rows. All lines were width-exact. The question led with its ask, kept all seven conditions and both catch-all routes reachable, and folded the dry-run promise into Context without changing original text. Frame/grid/key fitting, option fills and handoff spacing matched the approved anatomy. Permanent tests cover NO_COLOR/ASCII and the static settle.
- Before commit, merged the local `inbox-integration` tip: already up to date at `27843687cb8b1f9a567a5e9bd3242154fc644dea`. Reran typecheck and all tests afterward. Worktree record inspection reported valid. Temporary scripts, packages, captures and logs were removed; ignored build/dependency directories remain.

No push, PR, integration merge into the target branch, or worktree cleanup is part of this handoff.
