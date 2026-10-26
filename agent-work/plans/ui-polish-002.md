# Key notation and copy consistency

**Feature:** ui-polish-002 → Key notation consistency
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-002-5dc8420afec2/pi-agent-hub on `ui-polish-002`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique findings 12, 13)
**Depends on:** ui-polish-001 (footer strings)

## Goal

Every surface writes keys the same way and uses one user-facing name per concept.

## Confirmed decisions

- Display notation (display only; config binding syntax `C-x`/`M-x` and matching stay unchanged):
  `Ctrl+O`, `Alt+N`, `Shift+↑`, `Shift+←/→`, `Enter`, `Esc`, `Tab`, `Space`, `PgUp/PgDn`, `Home/End`, single printable keys as-is (`a`, `A`, `:`, `?`, `]`).
  Sentence-case labels after keys in hints (`Enter Create · Esc Cancel`), never lowercase `enter`/`esc`, never `^Y` or `ctrl-o`.
- One small helper `formatKey(binding: string): string` converts binding syntax (`C-m`, `M-1`, `S-up`, raw names) to display notation. Help and any place that prints raw `bindings[].key` use it. Catalog `displayKey` strings are normalized to the same notation.
- Hidden compatibility aliases (`e` for rename, `Alt+N`/`M-n` for sync, `C-m`/`C-j` Enter aliases) are not displayed anywhere. AGENTS.md already calls them hidden.
- Vocabulary:
  - Header summary: "trees" → "sessions" (`9 sessions`, filtered `7/9 sessions`, board `7 active sessions`). Subagents are not counted (unchanged counting).
  - Summary attention/error counts use the tier names: `3 needs you · 1 health` stays only until ui-polish-005 replaces the summary; do not rename tiers here.
  - Phone footer `i Info` → `i Workspace` (same concept as the 61–119 footer from ui-polish-001).
  - Help string `subagent trees` → `subagent rows`.
- Out of scope here: board footer `S projects` (ui-polish-007), help restructure (ui-polish-008), dialog layout (ui-polish-009). This ticket only changes notation and words in those places.

## Context Files

- Core: `src/tui/dashboard-commands.ts` (displayKey values :114,118,138–139,473–477; footers), `src/tui/sessions-view.ts` (`renderHelp` :2255–2322), `src/tui/layout.ts` (`renderTopSummary` :404–429), `src/tui/new-session-dialog.ts:179–189`, `src/tui/new-form.ts:228–234`, `src/tui/repo-picker.ts`, `src/tui/form-dialogs.ts`, `src/tui/question-dialog.ts`, `src/tui/two-column-picker.ts`, `src/tui/command-palette-dialog.ts`, `src/tui/theme-dialog.ts`, `src/tui/picker-dialog.ts`, `src/tui/confirm-dialogs.ts`, `src/tui/session-favorites-dialog.ts`, `src/app/side-pane-lifecycle.ts` (user-visible messages only).
- Tests: `test/fixtures/cockpit-frames.ts:3` (`8 trees`), footer/help/dialog string tests found by grep.
- Reference: `src/tui/dashboard-shortcuts.ts:4–12` (binding syntax parser).

## Reuse

- Put `formatKey` next to the binding parser in `src/tui/dashboard-shortcuts.ts` (it already owns `C-`/`M-` semantics). No new module.

## Implementation Phases

### Phase 1: Inventory and helper
- [ ] Grep user-visible key strings (`ctrl-`, `Ctrl+`, `\^[A-Z]`, `C-`, `M-`, `Alt+`, `Shift+`, `enter `, `esc `) in `src/tui/*.ts` and `src/app/*.ts`; list them in the ticket notes section of this plan (not a separate file).
- [ ] Test `formatKey` for `C-o`→`Ctrl+O`, `M-1`→`Alt+1`, `M-n`→`Alt+N`, `S-up`→`Shift+↑` (or the parser's actual names), `enter`→`Enter`, `escape`→`Esc`, `a`→`a`.
- [ ] Implement `formatKey`.

### Phase 2: Apply notation
- [ ] Help prints keys through `formatKey` and omits hidden aliases (test: help contains `Enter` once for open, does not contain `C-m`, `M-n`, `R/e`).
- [ ] Normalize every hint/footer string in the files above to the notation (tests updated by assertion, not by snapshot rewrite without review).
- [ ] Add a guard test: rendered footers, help, and each dialog's hint lines at 80 and 160 columns contain none of `/\bctrl-|\^[A-Z]\b|\bC-[a-z]\b|\bM-[a-z0-9]\b|\benter |\besc /`.

### Phase 3: Vocabulary
- [ ] Summary says `sessions` (unfiltered, filtered, board); update `cockpit-frames` fixture and tests.
- [ ] Phone footer `i Workspace`; help `subagent rows`.
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] No rendered footer, help, palette, workspace, or dialog hint uses `ctrl-x`, `^X`, `C-x`, `M-x`, or lowercase `enter`/`esc` (guard test).
- [ ] Help shows each command's primary key in display notation and no hidden aliases (test).
- [ ] The header summary counts `sessions`, never `trees` (test + fixture).
- [ ] The `i` key is labeled `Workspace` at every width where the footer shows it (test).
- [ ] Shortcut behavior is unchanged: existing binding tests pass; `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- docs/FEATURES.md and README key notation; AGENTS.md "Names" notes if any key notation is quoted.
