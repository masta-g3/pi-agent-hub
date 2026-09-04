# Dashboard visibility controls

**Feature:** `dashboard-visibility-001`
**Branch:** `dashboard-visibility-001`
**Target:** `main`

## Outcome

The project cockpit now supports persistent presentation controls without changing session lifecycle, tmux, Pi runtime, or registry state:

- Lifecycle filters support canonical `lifecycle:active,backlog,archived` clauses with OR semantics and bounded text narrowing.
- Lowercase `b` toggles Backlog visibility; uppercase `B` remains the lifecycle move action.
- HEALTH, ACTIVE, QUIET, and ARCHIVED collapse independently. NEEDS YOU is always expanded.
- Filter state and tier-collapse preferences persist as JSON-safe `ui-state.json` data. Subagent disclosure and filtered reveals remain ephemeral.
- Projection, keyboard navigation, mouse targets, selection repair, palette actions, and persistence share the same visibility precedence.
- Selected parent trees disclose correctly; Shift-arrow controls apply to all applicable trees.
- Mark read removes active attention placement when acknowledgement/status boundaries allow it, including valid idle attention requests.
- QUIET rows have a structural textual cue with existing theme and width-safe layout helpers.

## Durable guidance

Updated `AGENTS.md`, `docs/CONFIG.md`, `docs/FEATURES.md`, and `docs/STRUCTURE.md` with the filter grammar, `b`/`B` distinction, persisted state boundaries, cockpit collapse rules, projection ordering, and acknowledgement behavior.

## Verification

- `npm run typecheck`
- Focused dashboard/filter/render/session tests: 394 passed
- Full test suite: 899 passed
- `npm run package:check`
- `git diff --check`
