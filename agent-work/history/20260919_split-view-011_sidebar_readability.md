**Feature:** split-view-011 → Sidebar readability
**Session:** 01a0b8af-2b2d-7260-9cd1-c3fbc453c46d
**Worktree:** none

# Sidebar readability

## Outcome

Made the 40–60-column dashboard beside pinned sessions a usable compact control panel. The change reflows the existing fleet, action workspace, command palette, Help, forms, pickers, prompts, and confirmations without changing tmux geometry, pin lifecycle, shortcuts, persisted display state, or wider-layout behavior.

## Implemented contracts

- Narrow layout uses actual pane width and height. Widths below 40 keep the existing resize notice; 40–60 use the compact layout; wider views retain the established layout.
- The pinned decision strip appears below the windowed fleet and above the footer. Fleet, workspace, and mouse target offsets follow the rendered order.
- The existing action-workspace renderer supplies selected-session identity and actions. No second detail system was added.
- At narrow widths, `:` replaces the fleet with a full-sidebar command page. It keeps cursor-visible search, exact target identity, disabled reasons, visible-only targets, and PageUp/PageDown detail scrolling.
- Help uses catalog-owned content in a bounded, scrollable body.
- Forms stack labels over values, retain cursor state through resize, and reserve a bounded wrapped help/error area with fixed controls.
- Skills/MCP show one full-width Enabled or Available list at narrow widths; Left/Right/Tab switch lists. Wider views retain two columns.
- Repo, theme, favorites, group, and prompt dialogs use actual viewport geometry and bounded details while preserving existing state and submission semantics.
- Confirmations render as pure projections. Input transitions track which warning rows were shown, require complete warning exposure, revalidate exact targets and operation eligibility, and prevent hidden or stale destructive actions.
- Confirmation errors retain retry and cancellation controls. Tiny panes show a resize/cancel notice and cannot authorize actions.
- Unicode prompt fitting uses terminal-cell width. Stale palette selections never display another session's identity.

The separately approved compact-fleet work was committed as `e8edf57`. Its paired title/metadata windowing integrates with the bottom decision strip: visible Active titles retain their metadata when capacity allows, list height remains bounded, and hit targets stay aligned.

## Scope and design decisions

Reused the existing command catalog, dialog states, action workspace, form infrastructure, theme tokens, and exact-target guards. No dependencies, settings, screens, tmux lifecycle changes, or live checkout build were added. Conversation remained outside scope.

## Review corrections

Review fixed:

- render-time mutation in confirmation state;
- hidden retry controls after destructive-action errors;
- stale warning exposure after width reflow;
- duplicated Favorites viewport calculations and wrong height source;
- stale palette detail identity;
- Unicode-cell prompt clipping;
- an unbounded missing-width picker-scroll fallback.

Final dialog craft review and current-file fleet/windowing integration review returned LGTM. A low-impact unreachable width branch in the wide palette overlay was left unchanged under the no-nits review policy.

## Verification

- Test-first temporary cases covered widths 40/50/60, short and normal heights, resize across 60/61, cursor preservation, scrolling, long errors/paths, stale targets, and hidden-action blocking. Temporary tests were removed.
- Isolated real-terminal smoke used pi-tui `ProcessTerminal`/`TUI`, `SessionsView`, an isolated tmux socket, in-memory fixtures, and zero-side-effect spies.
- Final stable-source isolated suite: **1,018 passed, 0 failed, 0 skipped**.
- Fresh typecheck and `git diff --check` passed.
- No live `dist` rebuild occurred during implementation or review.

Detailed evidence remains in `agent-work/tickets/split-view-011/validation.md`; reusable harness friction remains in `papercuts.md`.

## Durable guidance

Reflection updated:

- `AGENTS.md` for actual narrow `i` versus Enter/double-click behavior and fixed help/error areas;
- `docs/STRUCTURE.md` for bottom decision-strip placement, title/metadata retention, and wrapped narrow form details;
- `docs/FEATURES.md` for narrow one-list Skills/MCP behavior and fixed footer/help-area behavior.
