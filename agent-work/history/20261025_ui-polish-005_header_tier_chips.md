# Header tier chips

- **Feature:** ui-polish-005
- **Branch:** `ui-polish-005` → `ui-polish-integration`
- **Dependencies:** ui-polish-004, ui-polish-002
- **Epic:** ui-polish-000

## Delivered

- Removed the separate tier navigator, width allocation, row targets, and mouse path. Fleet rows begin at the shell inset and reclaim its columns; workspace widths remain 34 cells at 120–159 columns and 44 at 160+.
- Status headers show nonzero NEEDS YOU, HEALTH, ACTIVE, QUIET, ARCHIVED owner counts in tier order, then session totals. Chips reuse `cockpitNavigation`, tier tones, footer-style column ranges, and `jumpToCockpitTier`; single presses select/reveal without opening or acknowledging.
- Width fitting drops QUIET, ARCHIVED, then ACTIVE before HEALTH/NEEDS YOU. Phone targets follow the frameless shell; hidden-pin/constrained signals remain available. Repo, board, pinned, and full-screen workspace summaries have no chip targets.
- Tier headings place counts beside labels and retain right-aligned workflow columns. No new keys, sorting, classification, or persisted state.
- Updated AGENTS.md, docs/STRUCTURE.md, and docs/FEATURES.md. Updated existing hit-map/windowing tests and 60/100/160-column fixtures; added focused chip coverage.

## Review and reflection

- Fixed a review regression where full heading-width reservation suppressed workflow columns for long Repo names. Restored the existing Repo truncation budget and added a regression test.
- `code-critic` job `94e88449-c3c8-4d27-9946-37990760b578` approved the original scope and corrected implementation. `docs-critic` job `7012f527-29d0-4684-a29c-5f3cc20fe0d8` approved the FEATURES usage paragraph. No unresolved findings.
- Reflection candidate resolved by the FEATURES paragraph. No new rules or follow-up tickets; lowering the workspace threshold remains outside scope.

## Integration and verification

- Merged integration tip `c987c58` before execution and `9d00b8e` before commit (merge `91472d7`). Preserved ui-polish-007 board grid/count headings and ui-polish-008 grouped Help/label-first workspace actions when resolving overlapping code, docs, tests, and fixtures.
- Baseline passed 1,187 tests. Review passed 1,195 tests. Final integrated `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test` passed all 1,222 tests; `git diff --check` passed.
- Coverage includes tier ordering/counts/colors/fitting, zero tiers, all five tier clicks, collapsed/filter-local reveals, orphan owners, phone offsets/resizing, inert separators and non-Status summaries, workspace geometry, and long Repo workflow grids.

## Handoff

Commit stays on the ticket branch for parent integration. No push, PR, integration merge, or worktree cleanup is performed by this ticket runner.
