# TUI dialog redesign and cursor-aware inputs

Completed: 2026-05-03

## Summary

Unified editable TUI dialogs around a shared form/input model and added cursor-aware single-line editing across the dashboard.

## Implemented

- Added `src/tui/form.ts` as the reusable form primitive for editable dialogs.
- Added `src/tui/text-input.ts` as the shared cursor-aware single-line text editing primitive.
- Kept `src/tui/new-form.ts` focused on new-session defaults, cwd suggestions, title coupling, and validation while reusing generic form helpers.
- Converted `Fork`, `Move to group`, `Rename session`, and `Rename group` from ad-hoc dialog text state to `renderForm()`-based editable forms.
- Split `Fork` into explicit `group` and `title` fields with Tab/arrow focus cycling instead of the old `group|title` input convention.
- Preserved rename behavior with `r` as the primary rename key and `e` as a hidden alias; moved restart to uppercase `R` with updated confirmation copy.
- Added visible input cursor rendering at the actual cursor position, not only at the end of fields.
- Added cursor movement/editing support in:
  - editable form dialogs,
  - New session,
  - slash filter,
  - Skills/MCP picker search.
- Supported common terminal key sequences where available: left/right, Home/End, Ctrl-A/E, Ctrl/Alt-left/right, Ctrl-W, Ctrl/Alt-Backspace, Delete, Ctrl/Alt-Delete, and Alt-D.
- Added `▶` primary-action cues to restart/delete confirmations, empty state, and no-match state.
- Updated footer/help copy to reflect `r` rename, `R` restart, and cursor-editable text inputs.

## Documentation updated

- `README.md` documents the revised TUI behavior, keybindings, form-style dialogs, and text-input shortcuts.
- `docs/STRUCTURE.md` documents the shared TUI text/form primitives and rendering guidance.
- `AGENTS.md` records durable agent guidance for TUI forms, text inputs, keybindings, and related project-state pitfalls.

## Validation

- `npm test` passed: 146/146 tests.
- `git diff --check` passed.
