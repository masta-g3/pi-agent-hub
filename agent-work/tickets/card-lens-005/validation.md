# card-lens-005 validation

End-to-end check, 2026-11-12. A parent Pi session in tmux loads only this worktree's Hub and pi-tmux-subagents extensions plus the installed Rules `workflow-runtime`, as a managed session in a temporary `PI_AGENT_HUB_DIR`. It launches one `lens-runner` subagent (anthropic/claude-haiku-5-5) that links ticket `demo-001` (2 phases, 1/4 tasks done), sets step `execute`, and runs `sleep 240`. `pi-hub tui` runs from this worktree's `dist`.

The child's Hub heartbeat carried `workflow` with keys `activeIndex, lens, steps, ticketId, updatedAt` only (no Rules-private state) and `activity` with the running `bash` call and two finished workflow calls.

## Selected subagent, 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                                                                                                      ◐  1 session
  NEW DAILY LOOP · Enter Dismiss                             │   └─ ⠋ lens-runner  EX Add at to conversation items
  Tab opens an answer; p writes a reply; Enter opens Pi.     │   DOING  Add at to conversation items
  Esc leaves answer focus without declining the question.    │   WHERE  PL✓ EX◉ RV· RF· CM· │ 1◉ 2·  ▰▰▱▱▱▱▱▱ 1/4
  Alt+W finds the next request while inside Pi.              │
 ── ACTIVE 1 ────────────────────────────────────────────────│   PLAN   Transport
   ▾ ◐ Workflow Launch ↳1   e2e                            1m│          ✓ Wire the reader
     DONE   Launched the lens-runner subagent with the reque…│          ◉ Add at to conversation items
▌  └─ ⠋ lens-runner  EX Add at to conversation items         │          · Detail returns page
                                                             │   NOW    1m  bash    sleep 240
                                                             │   LOG    1m  set_wo… execute
                                                             │          1m  set_wo… demo-001
                                                             │    Enter Open in Pi    i Details    : All actions
  ] Next request    p Reply    ? Help    n New    / Filter    b Backlog    v Group    S Board
```

## Selected subagent, 80 columns (docked card, no plate)

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 ⚠                      ◐  1 session
  NEW DAILY LOOP · Enter Dismiss
  Tab opens an answer; p writes a reply; Enter opens Pi.
  Esc leaves answer focus without declining the question.
  Alt+W finds the next request while inside Pi.
 ── ACTIVE 1 ───────────────────────────────────────────────────────────────────
  ▾ ◐ Workflow Launch ↳1   e2e                                                1m
    DONE   Launched the lens-runner subagent with the requested task and settin…
▌ └─ ⠧ lens-runner  EX Add at to conversation items
────────────────────────────────────────────────────────────────────────────────
▌ └─ ⠧ lens-runner  EX Add at to conversation items
  DOING  Add at to conversation items
  WHERE  PL✓ EX◉ RV· RF· CM· │ 1◉ 2·  ▰▰▱▱▱▱▱▱ 1/4
  PLAN   Transport
         ◉ Add at to conversation items
  NOW    1m  bash    sleep 240
  LOG    1m  set_wo… execute
   Enter Open in Pi    i Details    : All actions
  ] Next request    p Reply    ? Help
```
