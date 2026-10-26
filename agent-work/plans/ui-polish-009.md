# Dialog and conversation polish

**Feature:** ui-polish-009 → Dialog conversation polish
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-009-65a84baec870/pi-agent-hub on `ui-polish-009`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique findings 17, 18)
**Depends on:** ui-polish-002

## Goal

Forms show a clear primary action and one hint line. The conversation reads lighter and the answer card sits right under the latest message.

## Current

New session: `[ Create session ]` renders muted when unfocused (reads as disabled); `Actions` heading is flush left while fields are indented; hint line and footer both mention the directory chooser; footer lists create twice.
Conversation: every message has a full-width colored rule (`YOU ─────…`, `PI ─────…`); with a question, the transcript reserves `height - 12` rows, so a short transcript leaves a large gap above the answer card; the answer card ends with three hint lines.

## Proposed

```
New session
  Favorite        [ Choose… ▾ ]
▌ Primary         [ /Users/me/Code/hub ]
  + Add directory
  ▸ Options       hub · worktree off
  Actions
  Save favorite…
                  [ Create session ]        ← accent when the form can submit
                  Cancel
Project Skills/MCP use this directory
Enter Create · Ctrl+O Choose directory · Esc Cancel
```
```
  YOU
  Add guest checkout for mobile shoppers.

  PI
  Please choose how the mobile checkout should open.
──────────────────────────────────────────────
? ANSWER NEEDED · Question 1 of 1
Should guest checkout use a bottom sheet or a full page?
▌1 Bottom sheet — Keep shoppers on the product page
 2 Full page — Give checkout more space and focus
 t Type something…
Enter Send · 1–2 Choose · t Type · Tab Focus · Esc Fleet
```

## Confirmed decisions

- `FormSpec` has fields only; there is no shared submit action. Add an optional per-field primary marker that `renderForm` styles in `accent` when unfocused and the caller says it can submit. Only the new-session `[ Create session ]` row uses it, with validity from the existing `validateNewForm().ok`. Focused styling unchanged; Cancel stays muted. Other forms have no button rows and stay unchanged.
- The `Actions` section heading is indented to the field-label column.
- New-session repo-field footer: one line `Enter Create · Ctrl+O Choose directory · Esc Cancel` (keep the `Ctrl+Y` binding working; just do not list it twice). The field hint drops its duplicate chooser text: `Project Skills/MCP use this directory`.
- Conversation speaker headers: label only in its color (`YOU` accent, `PI` success, `PI · QUESTION`), no trailing full-width rule; one blank line between messages (existing spacing kept).
- Answer docking: the transcript takes only the rows its content needs, up to the current maximum (`height - 12`); the separator and answer card follow immediately. When the transcript is longer than the space, behavior is unchanged (scrolls; anchor rules intact).
- Question hint lines: merge into one line with the existing footer content, ordered by importance; at narrow widths drop the trailing items. The status line (errors/submitting) remains separate when present.

## Context Files

- Core: `src/tui/layout.ts` (`renderForm` :1640–1707), `src/tui/new-session-dialog.ts:173–189`, `src/tui/new-form.ts:228–234`, `src/tui/conversation.ts` (`ConversationReader.render` :114–125), `src/tui/sessions-view.ts` (conversation layout :626–645), `src/tui/question-dialog.ts:131–136`.
- Tests: `test/conversation-ui.test.ts:28,92–128` (`PI ───` assertion must change), `test/question-dialog-navigation.test.ts`, `test/new-session-dialog.test.ts`, `test/form.test.ts`, `test/theme.test.ts:316–364`, `test/conversation-panel.test.ts`.

## Reuse

- Shared `renderForm`; existing `ConversationReader` anchor/scroll logic; `formatKey` notation from ui-polish-002.

## Implementation Phases

### Phase 1: Forms
- [ ] Tests (theme): `[ Create session ]` is accent when unfocused and `validateNewForm().ok`, muted when invalid; other forms render unchanged; `Actions` heading is indented; new-session footer is exactly one line with Create, Choose directory, Cancel; `Ctrl+Y` still creates.
- [ ] Implement in `renderForm` and new-session strings.

### Phase 2: Conversation
- [ ] Tests: speaker header lines contain no `─`; a 2-message transcript with a question at height 40 puts the answer separator within 2 rows of the last message; a long transcript still scrolls and keeps the clipped-speaker rule (existing test at conversation-ui.test.ts:23 adjusted).
- [ ] Tests: question dialog renders one hint line (plus status line only when status text exists) at 40/80/160; rowTargets still match visible rows.
- [ ] Implement.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] Form submit actions look enabled (accent) when submittable and recede when not (tests).
- [ ] The new-session dialog shows one footer line and no duplicated chooser hint; all create keys still work (tests).
- [ ] Speaker headers have no full-width rules; the answer card docks under a short transcript; long transcripts scroll as before (tests).
- [ ] The answer card has one hint line, plus a status line only when needed (tests); `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- docs/FEATURES.md conversation and new-session sections; AGENTS.md dialog rule ("stable help/error area") — confirm the merged hint line keeps a stable area.
