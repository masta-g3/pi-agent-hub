# fleet-design-004 — Mission control

## Delivered

- Fleet roster with one status line per agent: requests and faults lead, then live work and quiet reports. Selection does not change roster detail allocation.
- Selected-session pane at 100+ columns; fixed bottom dock below. Existing board and pins retained.
- Request, summary, workflow readout, checklist, live call, recent calls, subagents and latest message share one action surface. Answer and Reply remain inline.
- `C` expands/folds the latest message. Open editors cap message context at four lines. Rules, reading measure, bold labels and theme accents improve scanning without new icons.
- Latest message stops at the newest user message. Running parents between tool calls show Thinking rather than an old handoff.
- Sanitized, bounded tool details and checklist projections remain runtime-only. Latest text travels through the selected-session interaction bridge, not heartbeat or registry.
- Rules publishes phase titles, a 12-task checklist window and an optional background progress note after each completed turn. Metadata disable, superseded turns, ticket changes and resume are covered.

## Verification

- Hub: 1,621 tests pass after rebasing onto merged Instrument panel PR #26.
- Rules: all 90 pytest tests pass, including wrappers for the Node runtime and extension suites.
- Prior visual checks covered 30–200 columns, themes, plain terminals, side pane, bottom dock and answer focus. Disposable Pi smoke verified live tool activity and progress publication.
- Rebase retained Instrument panel's selection-independent allocation and wide-pipeline readout fixes. Its copied baseline and Mission control WIP history were removed.

## Boundaries and remaining work

- Worktrees remain at `/Users/manager/.local/share/agent-worktrees/fleet-design-004-b23c998badc9/`; both PRs target `main`. Keep them until merge and separately authorized cleanup.
- Existing Pi sessions require `/reload` for extension changes. The installed preview predates final integration reconciliation.
- Subagent heartbeat activity and Pi open/return latency remain separate work.
- `agent-work/tickets/fleet-design-004/notes.md` retains contracts and smoke evidence. The two frame scripts remain for reproduction; `mission-control.png` is the final synthetic PR visual. Stale generated frames were removed.
