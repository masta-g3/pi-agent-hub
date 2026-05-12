# new-session-ux-001 — Dynamic new-session repo form

## Summary

Updated the `n` → New session TUI so session creation is predictable and compact:

- Restored random two-word title generation without showing explanatory sublabels under the title field.
- Defaulted `group` to the primary cwd basename.
- Kept `group` auto-updating from the primary cwd until edited.
- Replaced fixed `repo 2` / `repo 3` fields with dynamic repo rows:
  - `★ primary` is the required primary cwd and cannot be removed.
  - `+ repo` rows are optional extras.
  - `alt-a` adds an extra repo row.
  - `alt-x` removes the focused extra repo row.
  - Blank extra rows are omitted on submit.
- Made cwd suggestion cycling (`ctrl-n` / `ctrl-p`) work on any focused repo row.
- Added generic `section?: string` form metadata and width-safe section rendering for the `repos` header.
- Removed empty hint-line rendering for fields without hints, keeping extra repo rows compact.

## Files Changed

- `src/tui/new-form.ts` — dynamic repo field model, group basename default, random title generation, validation, submission.
- `src/tui/sessions-view.ts` — new-session key handling and footer copy for add/remove/cycle actions.
- `src/tui/form.ts` — shared form field `section` metadata.
- `src/tui/layout.ts` — section rendering and compact hint rendering.
- `test/new-form.test.ts` — focused state-model tests.
- `test/sessions-view.test.ts` — keyboard-flow and submission coverage.
- `test/run-tui.test.ts` — selected-session context keeps all additional repos.
- `test/theme.test.ts` — width-safe section rendering coverage.
- `README.md` — updated user-facing TUI behavior.

## Validation

- Baseline `npm test` passed before implementation.
- Final `npm test` passed: 208 tests.
- `git diff --check` passed.
- Ephemeral render/input smoke covered `n`, `alt-a`, `ctrl-n`, and submit with `additionalCwds`.

## Notes

- Submission shape stayed compatible with existing session creation: `{ cwd, group, title, additionalCwds? }`.
- TUI path existence validation remains in the app/core creation path, not the form.
- No first-class repo or group records were added.
- Review noted stale README text; reflection updated it.
- A `code-critic` subagent was invoked during review but got stuck and did not write `result.md`; manual review completed successfully.
