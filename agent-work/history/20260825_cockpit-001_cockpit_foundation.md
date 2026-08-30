# Cockpit foundation

**Feature:** cockpit-001 → Cockpit foundation
**Session:** 01a035c3-86d4-7e3b-af2c-8533e911aec8
**Worktree:** none

## Outcome

The default project view is now an attention-first cockpit with nonempty `NEEDS YOU`, `HEALTH`, `ACTIVE`, `QUIET`, and chronological `ARCHIVED` sections. It remains a read-only presentation over independent runtime status, workflow position, lifecycle, explicit attention, and descendant activity.

## Implemented

- Added one owner-level cockpit classifier in `src/tui/render-model.ts`, computed from the full unfiltered fleet before visibility filtering.
- Applied strict precedence: Archived lifecycle; explicit waiting/idle owner attention; owner error; starting/running owner or descendant; then Quiet.
- Kept descendants with their presentation owner. Running descendants can activate an owner tree; child attention/error cannot promote it.
- Preserved missing-parent and cyclic subagents through terminal fallback while keeping ownerless rows out of workflow-board lanes.
- Replaced project lifecycle/group headings with tier sections. Groups and Backlog are width-adaptive row metadata; only Archived remains a selectable, collapsible section.
- Preserved lifecycle-owned glyph styling, card richness, actions, details, side panes, tree disclosure, themes, `v` density, and the `S` workflow board.
- Aligned keyboard and mouse targets with render order: non-archived tier rows, Archived header, Archived rows, then archive disclosure.
- Removed the obsolete group-only render projection and retained one section-based renderer for cockpit and board views.
- Reserved row prefix and badge width before optional metadata so narrow rows keep a readable authoritative title.
- Updated built-in help plus `README.md`, `docs/FEATURES.md`, `docs/STRUCTURE.md`, and project `AGENTS.md`.

## Executable Contract

`test/cockpit.test.ts` and `test/fixtures/cockpit*.ts` cover tier precedence, independent state axes, full-fleet filter behavior, Backlog and Archived behavior, orphan/cycle fallback, target order, theme parity, width safety, and exact 60×24, 100×24, and 160×24 frames. The frames include a deterministic side-pane marker and use reviewable multiline template literals.

## Verification

- `npm run typecheck`
- Full temporary-build suite: 737 tests passed
- `git diff --check`
- Independent functional TUI pass at 60, 100, and 160 columns
- Dashboard rebuilt and restarted against the reviewed implementation

## Follow-up

- `cockpit-002` is superseded; its attention projection shipped here.
- Persisted Backlog-collapse state is intentionally inert until cockpit-008 removes obsolete view state.
- Inline question cards, notifications, status evidence, intent palette, action-workspace changes, direct pinning, and final old-mode removal remain in later cockpit tickets.
