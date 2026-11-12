# card-lens-004 validation

End-to-end check, 2026-11-12. `pi-hub add <tmp app repo>` ran from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`. Its tmux pane was respawned with one Pi process that loads only this worktree's extensions:
`pi --no-extensions --session-id <hub id> -e pi-agent-hub/dist/src/extension/index.js -e rules/extensions/workflow-runtime/index.ts`, with the same Hub env. `pi-hub tui` ran from this worktree's `dist` at 160 and 100 columns.

Script (the agent was prompted to make the calls):
1. `set_orchestration` with four tickets: `sfcity-010` committed `a1b2c3d`, `sfcity-011` running EX, `sfcity-012` gated RV, `sfcity-014` parked with note `Which tile CDN?`.
2. `set_orchestration` with one ticket: `web-002` running RV, `gates: 2`.

## Epic, 160 columns: NEEDS YOU tier, BLK request, DOING, WHERE with summary, TIX list

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                                                                                                      ●  1 session
┃  ! BLOCKED  Test Harness                                                                                                                          : locate  6s
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 ── NEEDS YOU 1 ─────────────────────────────────────────────│  ! Test Harness new  default                                                                  now
▌    ! Test Harness new   default                         now│    app
▌    BLK    sfcity-014 parked · Which tile CDN?  ▰▰▱▱▱▱▱▱ 1/4│    BLK    sfcity-014 parked · Which tile CDN?
                                                             │
  NEW DAILY LOOP · Enter Dismiss                             │    DOING  Running 2 tickets; next gate sfcity-013 review
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    WHERE  ▰▰▱▱▱▱▱▱ 1/4 committed · 2 running · 1 parked
  Esc leaves answer focus without declining the question.    │
  Alt+W finds the next request while inside Pi.              │    TIX    ✓ sfcity-010 committed a1b2c3d
                                                             │           ◉ sfcity-011 EX
                                                             │           ◉ sfcity-012 RV
                                                             │           ! sfcity-014 parked
                                                             │
                                                             │    LOG    54s set_or… Running 2 tickets; next gate sfcity-013 review
                                                             │
                                                             │    ── SAID ──────────────────────────────────────────────────────────────────────────────────────
                                                             │    STOP1
```

## Epic, 100 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                                          ●  1 session
 ── NEEDS YOU 1 ──────────────────────│  ! Test Harness new  default                             now
▌    ! Test Harness new   default  now│    app
▌    BLK    sfcity-014 parked ·    1/4│    BLK    sfcity-014 parked · Which tile CDN?
▌           Which tile CDN?           │
                                      │    DOING  Running 2 tickets; next gate sfcity-013 review
  NEW DAILY LOOP · Enter Dismiss      │    WHERE  ▰▰▱▱▱▱▱▱ 1/4 committed · 2 running · 1 parked
  Tab opens an answer; p writes a     │
  reply; Enter opens Pi.              │    TIX    ✓ sfcity-010 committed a1b2c3d
  Esc leaves answer focus without     │           ◉ sfcity-011 EX
  declining the question.             │           ◉ sfcity-012 RV
  Alt+W finds the next request while  │           ! sfcity-014 parked
  inside Pi.                          │
```

Heartbeat: `workflow` absent; top-level `lens` with `progress {1,4,"committed"}` and `summary "2 running · 1 parked"`; context `attention` `{ kind: "blocked", text: "sfcity-014 parked · Which tile CDN?", requestId: <sha256> }`.

## Single ticket, 160 columns: runner rail and gate count; the parked request has cleared

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ Test Harness  default                                                                      now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    DOING  Waiting for the runner to finish review
  Alt+W finds the next request while inside Pi.              │    WHERE  PL✓ EX✓ RV◉ RF· CM· │ 2 gates ✓
 ── NEW 1 ───────────────────────────────────────────────────│
▌    ◐ Test Harness   default                             now│    LOG    45s set_or… Waiting for the runner to finish review
▌    DOING  Waiting for the runner to finish review          │           1m  set_or… Running 2 tickets; next gate sfcity-013 review
```

## Single ticket, 100 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                                          ◉  1 session
  NEW DAILY LOOP · Enter Dismiss      │  ◐ Test Harness  default                                 now
  Tab opens an answer; p writes a     │    app
  reply; Enter opens Pi.              │    DOING  Waiting for the runner to finish review
  Esc leaves answer focus without     │    WHERE  PL✓ EX✓ RV◉ RF· CM· │ 2 gates ✓
```

`registry.json` keeps the session's `workflow` absent and the lens-only snapshot on its top-level `lens`.

Note: the WHERE line renders `1/4 committed · 2 running · 1 parked` because Hub adds the `unit` to the count when no rail is present. The mock's `1 queued` part is absent because this script had no queued ticket.
