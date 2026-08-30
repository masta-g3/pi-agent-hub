# Attention delivery

**Feature:** cockpit-004 → Attention delivery
**Session:** 01a035c3-86d4-7e3b-af2c-8533e911aec8
**Worktree:** none
**PR target:** none

## Outcome

Hub now delivers each fresh, explicitly identified producer request once for six seconds while keeping the durable `NEEDS YOU` row as the source of truth. Delivery is a transient pointer, not notification history or a second attention model.

## Product contract

- Producers may add an optional, normalized `attention.requestId` of at most 64 characters.
- Attention without a request ID still renders but does not announce.
- Identity is the exact `(managed session ID, producer request ID)` pair. Hub never infers identity from text, timestamps, tickets, status, workflow, or liveness.
- Requests present when the dashboard starts seed silently. Seen identities and active announcements stay bounded and process-local.
- Each fresh identity remains active for six seconds. Withdrawal, replacement, ineligible runtime state, exact acknowledgement, expiry, or session removal prunes active delivery.
- Repeated refreshes and non-request metadata changes remain silent.
- No request history, delivery result, client location, conversation content, or pane output is persisted.

## Implementation

### Pure transition ownership

`src/app/attention-delivery.ts` owns cold-start seeding, deduplication, active expiry, multi-request ordering, acknowledgement pruning, and per-client routing. It retains bounded presentation fields only. Fresh and active batches use the same deterministic newest-first order.

### Refresh and acknowledgement

`src/app/refresh-loop.ts` invokes one post-refresh observer after successful refreshes. `src/app/run-tui.ts` routes periodic, explicit, registry-mutation, and dashboard-action refreshes through that observer.

Acknowledgement accepts an optional exact request ID. The controller revalidates the current waiting/idle request before advancing `acknowledgedAt`. Normal `a`, full-screen handoff, and exact pin focus can silence an active idle request; ordinary idle rows remain non-acknowledgeable. `Enter` and `a` keep their selected-row targets.

### Tmux delivery

`src/core/tmux.ts` provides one typed client projection and exact literal-safe `display-message -d 6000 -c <client>` delivery. External effects run only when the TUI owns the managed dashboard tmux session.

For each client and request, Hub suppresses text when the client already shows:

- the exact cockpit pane;
- the exact managed tmux session; or
- the exact requesting pin.

Other eligible clients still receive one aggregate message. BEL defaults Off and is emitted at most once only after a successful external send when no attached client was focus-suppressed. Client inspection, message, and BEL failures are best-effort and never retry or damage refresh health.

### Cockpit presentation

The transient band appears below the mode header with `? QUESTION`, `! BLOCKED`, `✓ READY`, or `<glyph> N NEW`. It shows child → top-level owner identity, uses the newest request as its exact locate target, and sanitizes producer controls through `src/core/terminal-text.ts`.

- 40–99 columns retain rail, kind, readable identity, and `: locate`.
- 100–159 add bounded request text and `+N more`.
- 160+ preserve the complete bounded request, aggregate count, locate action, and `6s` marker.
- Pin mode omits request copy and the rule.
- Short layouts, full-screen narrow workspaces, and dialogs suppress the band without queuing it.

Clicking the band or choosing **Locate newest request** from `:` reveals the exact row without opening or acknowledging it. Locate and the global bell toggle remain available even when no real session row is selected.

### Configuration

`dashboard.attentionBell` is persisted in the shared validated config store and defaults to `false`. All config mutations now use locked `updateStore()` read-modify-write updates so concurrent sibling changes survive. The unbound **Attention bell: On/Off** palette action changes the preference.

## Durable documentation

Updated:

- `README.md`
- `docs/FEATURES.md`
- `docs/CONFIG.md`
- `docs/STRUCTURE.md`
- `AGENTS.md`

## Verification

- `npm run typecheck` passed.
- `npm test` passed: **847/847**.
- Focused reducer, command, layout, run-tui, and SessionsView suites passed.
- Boundary widths 40/60/99/100/119/120/159/160, short heights, pin/workflow modes, light/dark themes, hit maps, and control stripping were inspected.
- Isolated real-tmux client delivery smoke test passed.
- Final code critic: **LGTM**.
- Final docs critic: **LGTM**.
- `git diff --check` passed.

## Retained follow-up evidence

`agent-work/tickets/cockpit-004/papercuts.md` records the missing non-disruptive focused-test command. No product follow-up was discovered. Producer extensions that want delivery must publish `attention.requestId`; existing attention display remains valid without it.
