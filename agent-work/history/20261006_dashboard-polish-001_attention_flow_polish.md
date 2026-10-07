**Feature:** dashboard-polish-001 → Attention flow polish
**Session:** 91b569fb-ce4b-47f7-a1e3-a33aa4c0d1b1
**Worktree:** /Users/manager/.local/share/agent-worktrees/dashboard-polish-001-79dc8ba42a7f/pi-agent-hub, branch `dashboard-polish-001` (Rules record `…/dashboard-polish-001-79dc8ba42a7f/worktree.json`)
**Start branch:** main
**PR target:** main

## Delivered

- **Session bar count.** Managed status-right shows `⚑ N need you · alt+w next` through a tmux conditional on the per-session user option `@pi_hub_needs`. N counts NEEDS YOU owners other than the current session (`otherRequestCounts()`, a thin derivation of the unfiltered Status projection), only for parents with confirmed tmux presence. The dashboard writes changed counts after each refresh on one serialized chain, re-asserts them every 15 s (restarted tmux sessions lose user options), and clears them on shutdown after the chain drains. Color comes from the theme `warning` token (`TmuxChrome.attentionColor`).
- **`Alt+W`.** A third temporary return binding (saved/restored with `Ctrl+Q`/`Alt+R`) writes a `next-request` dashboard action. The dashboard opens the first NEEDS YOU owner other than the origin through the normal `Enter` path (acknowledge, pin focus for questions), or shows `nothing else needs you`. Only this binding forwards its key outside managed sessions.
- **`]`.** Catalog command `view:next-request` selects the next visible request row, wrapping, without opening, filtering or acknowledging; shown in Help and the palette. `]` and `M-w` are reserved for custom shortcuts.
- **Running rows.** Running/starting rows use Conversation's braille spinner (shared `SPINNER_FRAMES`) when the render has a clock and show their run time (hidden under one minute). The 250 ms action loop redraws only while a running row is on screen and no dialog covers the fleet.
- **Desktop notification.** Opt-in `dashboard.attentionNotify` writes an OSC 9 sequence to each client tty that received a fresh-request message (same routing and suppression as the text message; batched requests share one notification).
- Docs: FEATURES.md keys, status legend and return shortcuts; CONFIG.md `attentionNotify`; STRUCTURE.md status-right conditional, `Alt+W` round trip, and count-sync boundary.

## Scope decisions

- Dropped after inspection: narrow-width header counts and empty-state hints (already existed), theme preview in session bars (not visible during preview).
- Follow-up `ctrl-q-dashboard-002`: existing `Ctrl+Q`/`Alt+R` return bindings still swallow their keys outside managed sessions.
- User switch-over (outside the repo, approved): `dashboard.attentionNotify: true` in the Hub config and `~/.pi/agent/extensions/notify.ts` removed. Notifications resume once this build is installed.

## Review

- Plan critic: reuse projection for NEEDS YOU, pass `nextRequestKey` from the side-pane handoff, forward `Alt+W` outside sessions, sync counts outside the delivery guard with retry, base the render tick on windowed rows.
- Code critic: serialized count writes against shutdown; recipients require tmux presence. Re-review LGTM. Docs critic: notification wording fixed.

## Verification

- `npm run typecheck`; full `npm test` 1086/1086 (baseline 1068).
- tmux 3.5a: `set-option` on a user option redraws the status line without `refresh-client`.
- Real-tmux smoke on a scratch server and Hub dir: spinner animation, counts per session, `Alt+W` switch and acknowledgement, no-target message, passthrough with the binding active, `]` selection, tmux-missing error row skipped, counts cleared on quit.
- Ghostty displayed the OSC 9 notification when not frontmost.
