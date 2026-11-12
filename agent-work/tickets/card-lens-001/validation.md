# card-lens-001 validation

End-to-end check, 2026-11-11. One real Pi session in tmux loads only this worktree's extensions:
`pi --no-extensions -e pi-agent-hub/dist/src/extension/index.js -e rules/extensions/workflow-runtime/index.ts`.
`pi-hub tui` runs from this worktree's `dist` with a temporary `PI_AGENT_HUB_DIR`. The test ticket `card-001` has a 5-phase plan, 8/16 tasks done.

## Execute (`/skill:execute card-001`), 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ Phone chat view  lens                                                                      now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    proj
  Esc leaves answer focus without declining the question.    │    Live Markdown chat on the phone inbox
  Alt+W finds the next request while inside Pi.              │    DOING  Add at in src/core/conversation.ts
 ── NEW 1 ───────────────────────────────────────────────────│    WHERE  PL✓ EX◉ RV· RF· CM· │ 1✓ 2✓ 3◉ 4· 5·  ▰▰▰▰▱▱▱▱ 8/16
▌    ◐ Phone chat view   lens · Live Markdown chat o… EX  now│
▌    DOING  Add at in src/core/conversation.ts  ▰▰▰▰▱▱▱▱ 8/16│    PLAN   Conversation transport and merge
                                                             │           ✓ conversation test: item carries at
                                                             │           ◉ Add at in src/core/conversation.ts
                                                             │           · web-server test: detail returns page
                                                             │           · Merge pages in the client
                                                             │           · Dedupe sent replies
                                                             │     Enter Open in Pi    p Reply    A Archive…    i Details    : All actions
  ] Next request    p Reply    : All actions    ? Help    n New    / Filter    b Backlog    v Group    S Board
```

The heartbeat `workflow.plan` has no `current`; `workflow.lens` carries doing, stages 1–5, progress 8/16 tasks, and the PLAN list.

## Review: reviewing-implementation ×2, then fixing-review-findings, 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ Phone chat view  lens                                                                      now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    proj
  Esc leaves answer focus without declining the question.    │    Live Markdown chat on the phone inbox
  Alt+W finds the next request while inside Pi.              │    DOING  Fixing findings
 ── NEW 1 ───────────────────────────────────────────────────│    WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
▌    ◐ Phone chat view   lens · Live Markdown chat o… RV  now│
▌    DOING  Fixing findings                                  │    LOG    9s  set_wo… fixing-review-findings
                                                             │           10s set_wo… reviewing-implementation
                                                             │           11s set_wo… reviewing-implementation
                                                             │    ── SAID ──────────────────────────────────────────────────────────────────────────────────────
                                                             │    done
                                                             │     Enter Open in Pi    p Reply    A Archive…    i Details    : All actions
  ] Next request    p Reply    : All actions    ? Help    n New    / Filter    b Backlog    v Group    S Board
```

## Review, 80 columns (docked card)

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss
  Tab opens an answer; p writes a reply; Enter opens Pi.
  Esc leaves answer focus without declining the question.
  Alt+W finds the next request while inside Pi.
 ── NEW 1 ──────────────────────────────────────────────────────────────────────
▌   ◐ Phone chat view   lens                                             RV  now
▌   DOING  Fixing findings
────────────────────────────────────────────────────────────────────────────────
▌ ◐ Phone chat view  lens                                                    now
▌   proj
▌   Live Markdown chat on the phone inbox
▌   DOING  Fixing findings
▌   WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
▌   LOG    12s set_wo… fixing-review-findings
▌   SAID   done
▌    Enter Open in Pi    p Reply    A Archive…    i Details    : All actions
  ] Next request    p Reply    : All actions    ? Help
```

## Pi stopped (tmux killed): the registry keeps the lens; the card keeps DOING and WHERE

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ×  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  × Phone chat view new  lens                                                                  now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    proj
  Esc leaves answer focus without declining the question.    │    Live Markdown chat on the phone inbox
  Alt+W finds the next request while inside Pi.              │    ERR    tmux session is missing
 ── HEALTH 1 ────────────────────────────────────────────────│
▌    × Phone chat view new   lens · Live Markdown ch… RV  now│    DOING  Fixing findings
▌    ERR    tmux session is missing                          │    WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  pass 2
                                                             │    Check Details before restarting.
                                                             │     i Details    Enter Restart    A Archive…    : All actions
```
