# Cockpit onboarding

**Feature:** cockpit-009 — Cockpit onboarding  
**Branch:** `cockpit-009`  
**Start/PR target:** `main`

## Outcome

Hub now teaches a new user one real attention round trip through the existing project cockpit. Coaching retires only after Hub successfully routes an explicit producer request to its real Pi questionnaire and the user successfully returns with `Alt+Q`. Existing users receive one low-priority, dismissible release cue instead of full coaching.

## Product contract

### New-user coaching

- Hub creates a new-user cohort only when `ui-state.json` is missing and the initial registry is empty.
- The cohort is persisted immediately and survives session creation, removal, archive, and dashboard restart.
- Coaching extends the real `NEEDS YOU`, `HEALTH`, `ACTIVE`, and `QUIET` tiers. It adds no tour, modal, wizard, fake session, new shortcut, or `START HERE` section.
- Empty coaching points to `n`, `Enter`, `Alt+Q`, `?`, and `:`. Short layouts retain `NEEDS YOU`, useful tier headings, and the required create/return actions before lesson text or separators.
- Board, pin, filter, dialog, palette, and full-screen workspace modes suppress guidance.
- Retirement requires, in order:
  1. waiting/idle explicit question attention with a bounded producer `requestId`;
  2. exact acknowledgement plus successful existing-pin focus or full-screen handoff;
  3. a successful canonical `Alt+Q` return.
- Locate, `a`, `Ctrl+Q`, failed or unavailable routing, outside-tmux attach, ordinary waiting, and attention without a request ID do not complete coaching.

### Existing-user release cue

- Existing users see `NEW DAILY LOOP — NEEDS YOU is explicit · Enter reaches · Alt+Q returns` after real `NEEDS YOU` attention.
- The cue is a synthetic project-list target. It never enters fleet counts, filtering, attention delivery, workspace commands, lifecycle actions, or session selection state.
- Arrow keys, `j`/`k`, click, `Enter`, and double-click use the existing target-safe interaction paths.
- Dismissal persists only `cockpit-daily-loop-v1`. Package version changes do not revive it; a future workflow change must intentionally use a new cue ID.
- Coaching and the release cue cannot render together.

## Implementation

- Added pure onboarding normalization and transitions in `src/tui/cockpit-onboarding.ts`.
- Extended `SessionsViewState` with the bounded onboarding phase and one dismissed cue ID.
- Serialized complete UI-state snapshots. Failed writes no longer block later snapshots, and shutdown drains active side-pane/dashboard-action producers before draining UI state.
- Extended exact Answer/Open routing without adding another acknowledgement path. Full-screen handoff now reports explicit success; fulfilled-but-unavailable handoffs do not start retirement.
- Added guarded `M-q` beside `C-q`. `M-q` writes `{ "action": "return", "key": "alt-q" }` only after `tmux switch-client` succeeds; saved bindings are restored together.
- Applied successful return receipts before refresh so a refresh failure cannot lose completion. Rename actions retain refresh-first behavior.
- Added real-tier lessons, catalog-owned coaching footer order, responsive guidance priority, and the synthetic release-cue target using existing render, theme, windowing, navigation, and mouse paths.
- Fixed the empty narrow-dashboard workspace predicate so two absent session IDs cannot suppress coaching.

## Documentation

Updated:

- `README.md` — daily loop, cue, and `Alt+Q`/`Ctrl+Q` behavior.
- `docs/FEATURES.md` — onboarding and release-cue product contract.
- `docs/STRUCTURE.md` — state, transitions, handoff receipt, shutdown ordering, and ownership.
- `docs/DEVELOPMENT.md` — isolated tmux bootstrap/environment setup and exact-pin test limitation.

## Verification

- `npm run typecheck` — passed.
- `npm test` — 882 passed, 0 failed.
- Final code-critic pass — `LGTM`.
- Final docs-critic findings — resolved.
- Real isolated-tmux smoke:
  - new empty dashboard coaching;
  - real Pi questionnaire with producer request ID;
  - full-screen Answer, option selection, and `Alt+Q` return;
  - durable completion;
  - existing-user cue display and dismissal.
- Exact-pin behavior remains covered by focused `SessionsView` and side-pane lifecycle tests because production nested pin attach intentionally clears `TMUX` and reconnects through the default socket, which cannot be exercised unchanged on an isolated `tmux -L` server.

## Scope notes

- Deterministic onboarding moment fixtures replace 18 duplicated full-frame literals while still exercising empty, first-session, request, completed-return, cue, and dismissed states at 60/100/160 columns.
- No questionnaire options or answers are persisted or mirrored by Hub.
- No notification history, package-version nag, per-tip history, inferred request identity, raw pane capture, or workflow coupling was added.
