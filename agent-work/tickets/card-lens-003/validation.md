# card-lens-003 validation

End-to-end check, 2026-11-12. `pi-hub add <tmp app repo>` from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR`. Its tmux pane was respawned with one Pi process that loads only this worktree's extensions:
`pi --no-extensions --session-id <hub id> -e pi-agent-hub/dist/src/extension/index.js -e rules/extensions/workflow-runtime/index.ts`, same Hub env. `pi-hub tui` ran from this worktree's `dist`.

Script (agent prompted to make the calls): `set_workflow_ticket demo-003`, `set_workflow_step review`, `reviewing-implementation` twice, `fixing-review-findings` with five items; then `review-complete` with the final items; then `set_workflow_step reflect`, `updating-guidance` with four items.

## Review, fixing pass 2, 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▱▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ demo-003  default                                                                           1m
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    DOING  Parser stall on long backtick runs
  Alt+W finds the next request while inside Pi.              │    WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
 ── NEW 1 ───────────────────────────────────────────────────│
▌    ◐ demo-003   default                             RV   1m│    FOUND  2 fixed · 2 open · 1 deferred
▌    DOING  Parser stall on long backtick runs               │           ✓ Retry after unknown delivery showed twice
                                                             │           ✓ Lost history cursor on empty session
                                                             │           ◉ Parser stall on long backtick runs
                                                             │           · Failed read dropped loaded history
                                                             │           – Login in a link: deferred
                                                             │
                                                             │    LOG    1m  set_wo… fixing-review-findings
                                                             │           1m  set_wo… reviewing-implementation
                                                             │           1m  set_wo… reviewing-implementation
                                                             │
                                                             │    ── SAID ──────────────────────────────────────────────────────────────────────────────────────
                                                             │    STOP1
                                                             │
```

## Review, fixing pass 2, 100 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▱▱ week▰▰▱▱▱                          ◉  1 session
  NEW DAILY LOOP · Enter Dismiss      │  ◐ demo-003  default                                      1m
  Tab opens an answer; p writes a     │    app
  reply; Enter opens Pi.              │    DOING  Parser stall on long backtick runs
  Esc leaves answer focus without     │    WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
  declining the question.             │
  Alt+W finds the next request while  │    FOUND  2 fixed · 2 open · 1 deferred
  inside Pi.                          │           ✓ Retry after unknown delivery showed twice
 ── NEW 1 ────────────────────────────│           ✓ Lost history cursor on empty session
▌    ◐ demo-003   default      RV   1m│           ◉ Parser stall on long backtick runs
▌    DOING  Parser stall on long back…│           · Failed read dropped loaded history
                                      │           – Login in a link: deferred
                                      │
                                      │    LOG    1m  set_wo… fixing-review-findings
                                      │           1m  set_wo… reviewing-implementation
                                      │           1m  set_wo… reviewing-implementation
                                      │
                                      │    ── SAID ─────────────────────────────────────────────────
                                      │    STOP1
                                      │
```

## Review after `review-complete`, 100 columns (final list kept under the terminal label)

Re-run during review after the producer started publishing the terminal activity label as `doing`; shorter two-item script.

```text
pi hub  FLEET                                                                           ◉  1 session
  NEW DAILY LOOP · Enter Dismiss      │  ◐ demo-003  default                                     now
  Tab opens an answer; p writes a     │    app
  reply; Enter opens Pi.              │    DOING  Review complete
  Esc leaves answer focus without     │    WHERE  PL✓ EX✓ RV✓ RF· CM· │ review✓ fix✓ done✓
  declining the question.             │
  Alt+W finds the next request while  │    FOUND  1 fixed · 1 deferred
  inside Pi.                          │           ✓ Parser stall on long backtick runs
 ── NEW 1 ────────────────────────────│           – Login in a link: deferred
▌    ◐ demo-003   default     RV✓  now│
▌    DOING  Review complete           │    LOG    47s set_wo… review-complete
                                      │           48s set_wo… fixing-review-findings
                                      │           50s set_wo… review
                                      │
```

## Reflect, updating guidance, 160 columns (Review list reset on step change)

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▱▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ demo-003  default                                                                          now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    DOING  STRUCTURE.md: Markdown safety rule
  Alt+W finds the next request while inside Pi.              │    WHERE  PL✓ EX✓ RV✓ RF◉ CM· │ review✓ update◉ done·
 ── NEW 1 ───────────────────────────────────────────────────│
▌    ◐ demo-003   default                             RF  now│    CANDS  1 applied · 1 now · 1 needs you · 1 no action
▌    DOING  STRUCTURE.md: Markdown safety rule               │           ✓ STRUCTURE.md: transcript source
                                                             │           ◉ STRUCTURE.md: Markdown safety rule
                                                             │           ! New ticket: keyboard dock check
                                                             │           – Retry wording: no change
                                                             │
                                                             │    LOG    33s set_wo… updating-guidance
                                                             │           35s set_wo… reflect
                                                             │           1m  set_wo… review-complete
                                                             │
```

## Reflect, updating guidance, 100 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▱▱ week▰▰▱▱▱                          ◉  1 session
  NEW DAILY LOOP · Enter Dismiss      │  ◐ demo-003  default                                     now
  Tab opens an answer; p writes a     │    app
  reply; Enter opens Pi.              │    DOING  STRUCTURE.md: Markdown safety rule
  Esc leaves answer focus without     │    WHERE  PL✓ EX✓ RV✓ RF◉ CM· │ review✓ update◉ done·
  declining the question.             │
  Alt+W finds the next request while  │    CANDS  1 applied · 1 now · 1 needs you · 1 no action
  inside Pi.                          │           ✓ STRUCTURE.md: transcript source
 ── NEW 1 ────────────────────────────│           ◉ STRUCTURE.md: Markdown safety rule
▌    ◐ demo-003   default      RF  now│           ! New ticket: keyboard dock check
▌    DOING  STRUCTURE.md: Markdown sa…│           – Retry wording: no change
                                      │
                                      │    LOG    30s set_wo… updating-guidance
                                      │           32s set_wo… reflect
                                      │           1m  set_wo… review-complete
                                      │
```
