# Follow view

**Feature:** split-view-012 → Follow view
**Worktree:** `/Users/manager/.local/share/agent-worktrees/split-view-012-5e3a0493e983/pi-agent-hub`, branch `split-view-012`
**Start branch:** `main` (`07023c6`) · **PR target:** `main`
**Completed:** 2026-10-27

## Outcome

Opt-in, Codex-style follow view: `o` opens one live pane beside the sidebar that shows the selected session and follows the selection.

- The pane retargets about 200 ms after the exact live selection settles; held `j`/`k` causes one retarget, in the same pane, via `switch-client -c <pane tty>`.
- Non-live or synthetic selections keep the last live session; the pane title adds `· selected <title> is <status>`.
- Automatic retargets never reveal, acknowledge, or touch interaction, and never change order, tier, lifecycle, or workflow.
- `Enter`/double-click on a live row run one serialized `focusFollow` (retarget if needed, reveal, acknowledge, focus); `Ctrl+Q` returns. Stopped/error rows still restart. Workspace and palette `Open` still go full screen, bypassing pinned-question focus.
- Follow view and pins never coexist: `o` needs no pins, a live selection, and 100+ columns; pin assign/close/resize and Conversation are refused while following. Real pins are never retargeted.
- Below 100 columns it hides behind the existing Hub zoom; widening rebuilds the pane, still following, and retargets once to the current selection.
- `o` again closes only the pane; Pi keeps running and dashboard chrome/footers return.
- `o` is now a reserved dashboard key; configured `o` shortcuts must move (CHANGELOG and `docs/CONFIG.md` updated).

## Design

- The follow pane is an ordinary slot-1 pin plus the transient dashboard-window option `@pi_hub_follow`. Window options survive pane rebuilds and rollback, so hidden-zoom restore needs no extra state. `following` = flag set and exactly one pin; presence clears an orphaned flag and the first real pin clears a stale one. Nothing is persisted.
- `retargetFollowPane()` (`src/app/side-pane.ts`) hides the target footer, pre-sizes the target to the exact pane, switches, always restores `window-size latest`, then restores the previous footer (tolerating a vanished session). A failed switch restores the target footer and keeps the old attachment. Pi receives no resize, so it does not redraw.
- The lifecycle `retarget` runs on the serialized queue, re-checks that the target is still the selected live session, skips while hidden, and records each retargeted identity so the next presence pass does not treat it as a focus.
- Catalog: `view:follow` (`o`); `focus-follow` takes `Enter` ahead of `open` only while following a live row. Rendering: `FOLLOWING` header, `follow view hidden` signal, `LIVE · <title>` pane titles, follow footer. Pin-summary labels now come from one `pinSummaryLabel()` helper.

## Verification

- Full suite 1,294 tests; typecheck, package check, and `git diff --check` pass. New lifecycle tests cover open/refuse/close, retarget ordering and sizing, stale queued retargets, failed and vanished-session switches, mid-switch focus, hidden restore, and stale flags; view tests cover debounce, toggling, Enter/Open routing, refusals, and header/footer/Help.
- Live check on an isolated `TMUX_TMPDIR` tmux server passed every acceptance criterion.
- Post-install user report of flicker: measured two SIGWINCH redraws per retarget (footer hidden after the switch). Fixed as above; re-measured zero. Opening follow view still uses the shared pin rebuild (one resize).
- code-critic: two acknowledgement leaks fixed (mid-switch focus; vanished previous session); second pass clean.

## Reflection outcomes

- `docs/DEVELOPMENT.md` now documents the isolated `TMUX_TMPDIR` recipe for live pin/follow checks.
- Flaky `extension.test.ts` "compaction watchdog restores the prior state when completion is missing" (1 failure, then 15/15 and 4/4 passes): no ticket; user will fix it directly after this commit.
