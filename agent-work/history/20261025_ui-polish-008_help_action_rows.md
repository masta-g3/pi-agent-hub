# Grouped Help and label-first action rows

**Feature:** ui-polish-008 — Help and actions
**Status:** Complete
**Branch:** `ui-polish-008`
**Integration target:** `ui-polish-integration` (parent-owned integration and closeout)
**Dependencies:** ui-polish-002, ui-polish-004

## Delivered

- Help reads stable catalog base labels and primary keys, including session/pin commands and configured shortcuts without a selected session. Sections are Session actions, Pins, Views, and Filters. No per-selection availability or compatibility aliases appear.
- Labels precede complete, right-aligned keys. Hints appear only with room at 120+ columns; paired sections shorten the page at 160+. Palette-only filters share one `via : palette` note.
- Workspace and pinned decision-strip actions reuse the existing renderer and exact command targets. Rows are label-first with accent keys on the right. The primary action has an accent `▌` and bold label; the palette row reads `All actions`.
- Updated `AGENTS.md`, `docs/STRUCTURE.md`, and `docs/FEATURES.md` to match the presentation contracts.

## Review and reflection

- Code critic found that phone-width prose wrapping removed fitted catalog spacing and key styling. Fixed the owning Help path so only legacy prose wraps. Added failing-then-passing 30/40/60-column alignment/styling tests and 80/160-column scroll-to-end/return tests. Second critic pass approved the result.
- Docs critic approved the Help/workspace guidance. No unresolved guidance candidates, new fallback paths, or follow-up tickets.
- The parent owns follow-up tracking for the unrelated fork-compact-startup heartbeat-file race observed during execution. No unrelated code changed.

## Integration and validation

- Merged integration tip `c987c580` before implementation (`ca02d5c`). Before final commit, merged integration tip `63447793`, including ui-polish-007 board grids/headings and `S Fleet` (`56c1623`).
- Resolved only overlapping Help/action-workspace documentation in `AGENTS.md` and `docs/STRUCTURE.md`; retained the integration board contracts. Production and interaction-test changes merged automatically.
- Full post-merge verification: `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test` — **1,214 passed, 0 failed**. Typecheck passed during review. Final whitespace/conflict checks passed.
- Regression coverage includes static Help at 30/80/120/160 columns, narrow key styling/alignment, two-column shortening, scrolling, workspace/pinned rows at 40/100/120/160 columns, and existing exact-target mouse/keyboard guards.
- No global install, push, PR, or worktree cleanup. Local ignored `dist/` and `node_modules/` remain for parent-owned closeout.
