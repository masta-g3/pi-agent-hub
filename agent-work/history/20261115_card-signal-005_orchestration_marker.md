# Orchestration Marker

**Feature:** card-signal-005 → Orchestration Marker
**Worktree:** none · **Branch:** main (pi-agent-hub only)

## Outcome

A session that publishes a Rules orchestration run shows a muted `⊛` after its title (after any worktree marker) on fleet rows, the selected card and board rows, including while it plans its next ticket. Each ticket runner it launched shows `⊛ <ticket-id>` in place of `ticket-runner`. ASCII glyphs use `%`.

```
  ▾ ● Run sfcity epic ⎇ ⊛ ↳2   team                    3m
  ├─ ● ⊛ sfcity-012  EX Write tests
  └─ ● ⊛ sfcity-013  RV Fix finding 2
```

## Design

- Signal: Rules already writes `orchestration.tickets[].id` in every `workflow-runtime` entry while a run is published, positioned or not. `parseEntryOrchestration` reads only the ids beside the unchanged `parseWorkflowEntry`; the heartbeat carries `orchestration: { ticketIds }`. 1–24 unique ids like `web-002`, ≤80 chars, lowercased; any bad id drops the whole field without touching workflow or lens.
- Retention: `applyComputedStatus` keeps it in `registry.json` like the lens; a fresh heartbeat without it clears it. Stopped orchestrators and runners keep the marker.
- Runner: a direct subagent child whose workflow `ticketId` is in its parent's list. Nested helpers and children of other sessions stay plain.
- Layout: `titleMarkers()` (worktree, then orchestration) is shared by roster, one-line, board rows and the selected card, so title fitting reserves the marker and `new` drops first. Runner rows show the whole id before the task text; ordinary agent names keep the 20-cell cap.
- Sidebar pin metadata, the web UI, Rules and pi-tmux-subagents are unchanged.

## Decisions

- Read Rules' existing field instead of adding a producer flag (Hub-only change).
- Persist like the lens, not live-only like the model tag.
- Glyph on parent plus ticket id on child.

## Review

- Fixed: runner rows reserved task room (8 cells plus separator) before the ticket id, so long ids lost their suffix at 100 columns. Regression covers 80/100/120.

## Verification

- `npm test` 1786/1786; `npm run package:check` passes. Manual render at 80/120/160 in fleet and board matches the mockup.
- One unrelated fork-compact tmux test (`session-commands`) flaked once under full-suite load; passed 3/3 alone and on rerun.

## Docs

`docs/CONFIG.md` (producer field), `docs/FEATURES.md` (orchestrator paragraph), `docs/STRUCTURE.md` (title marker order, runner rows), `CHANGELOG.md`.
