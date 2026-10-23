# mobile-001 · Phone dashboard

## Outcome

The dashboard adapts to phone-size tmux windows without stopping Pi or losing pinned identities.

- Below 100 window columns, Hub zooms the dashboard and hides existing pins. Desktop return restores the wide pin geometry. Only Hub-owned zooms are undone.
- Hidden-pin opening uses full-screen handoff. Fresh width checks run inside the side-pane queue, including before the presence loop has zoomed.
- At ≤60 columns the dashboard is frameless. Workflow columns tighten; below 40 columns a current-step label replaces the grid. Minimum dashboard width is 30.
- Below 100 columns and 20 rows, fleet titles retain workflow position on one line; the selected parent retains metadata.
- Footers drop whole items and accept taps through the existing key handling. Managed-session return hints accept status clicks on tmux 3.4+ with user-enabled mouse handling.

## Verification

- Reviewed by code-critic; queued focus race fixed and second pass approved.
- Full combined checkout test run: 1140 passed at review closeout.
- Isolated tmux 3.5a with pty client: 165x48 → 46x30 with two pins; full-screen slot open and tap return; restored 42/61/60 desktop panes.
- Feature-only installation tested separately: 1113 tests passed. That installed artifact predates the review race fix.

## Reflection

- Mouse prerequisite documented; Hub does not change managed Pi mouse behavior.
- Short-height documentation corrected to match fleet-only, below-100-column behavior.
- Narrow palette footer clipping remains a cosmetic nit; no follow-up ticket.

Installation patch and validation notes remain under `agent-work/tickets/mobile-001/` as evidence of the deployed pre-review build, not a patch for future reinstalls.
