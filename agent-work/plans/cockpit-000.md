# Attention-first cockpit epic

Goal: Make Hub an attention-first cockpit that routes the maintainer to explicit requests and direct session actions.
Design reference: `agent-work/decks/herdr-inspired-hub-redesign.html`.
Scope: Attention projection and delivery, status explanation, intent search, action-focused details, direct pinning, one adaptive view, and onboarding.
Boundaries: Keep Pi as runtime, tmux as process substrate, groups as labels, and workflow metadata producer-owned and read-only.
Implementation rule: Prefer lean, fundamental changes that delete or replace obsolete paths; avoid parallel systems, compatibility layers, speculative abstractions, and new framework patterns.
Excludes: Agent orchestration, new runtime ownership, broad Git management, cloud/team features, and inferred attention.

- `cockpit-001` — Works when the live default project view and executable fixtures present explicit attention, health, activity, and quiet without changing row state.
- `cockpit-002` — Superseded; its attention-projection scope is merged into `cockpit-001` for one coherent visible slice.
- `cockpit-003` — Works when every derived status has a readable evidence trace.
- `cockpit-004` — Works when only explicit requests trigger configured attention notifications.
- `cockpit-005` — Works when one intent surface searches sessions, actions, context, and scoped filters.
- `cockpit-006` — Works when selected-session details lead with the decision, summary, and next action.
- `cockpit-007` — Works when users pin, focus, split, resize, and close live sessions without numbered-slot grammar.
- `cockpit-008` — Works when one adaptive cockpit replaces density and workflow-board view modes.
- `cockpit-009` — Works when onboarding and in-product guidance teach the new daily workflow.
