# Skill Pool TUI Edit

## Summary

Implemented editable Skill pool configuration directly in the dashboard Skills picker. Users can press `s` to open the Skills picker, see the active pool path, press `Alt+E` to edit it, and save to reload the available Skills without manually editing `config.json`.

## Implemented

- Added `setSkillPoolDirs()` / `setSkillPoolDir()` in `src/core/config.ts` to persist `skills.poolDirs` while preserving unrelated config.
- Wired `src/app/run-tui.ts` to keep Skill pool dirs/catalog mutable, save the edited pool dir, reload `listSkillPool()`, and rebuild picker items for the selected session's primary project cwd.
- Extended `src/tui/sessions-view.ts` and `src/tui/two-column-picker.ts` with Skills-picker-only pool path display/editing, validation, async save guarding, success/error messages, and empty-pool support.
- Kept printable keys, including `e`, as picker search input; pool editing uses `Alt+E`.
- Kept MCP picker behavior unchanged.
- Updated `src/skills/attach.ts` so same-named Skills from a newly selected pool replace the previous managed materialization safely, while same-source attachments are reused and unmanaged paths are not overwritten.
- Updated durable docs in `docs/CONFIG.md`, `docs/FEATURES.md`, and `AGENTS.md`.

## Validation

- Baseline: `npx tsc -p tsconfig.json --noEmit`
- Focused: `npm run build && node --test dist/test/config.test.js dist/test/skills.test.js dist/test/two-column-picker.test.js dist/test/sessions-view.test.js`
- Full: `npm test`
- Functional smoke: delegate subagent validated Skills pool editing, empty pools, plain `e` search behavior, and MCP picker isolation.

## Notes

- The TUI edits a single pool directory. Saving from the picker replaces `skills.poolDirs` with one path; JSON still supports multiple dirs for power users.
- Missing or empty pool directories are allowed and render an editable empty picker.
- Attached Skills still apply to the selected session's primary cwd; multi-repo extra repos and runtime workspaces are not used as the project state target.
