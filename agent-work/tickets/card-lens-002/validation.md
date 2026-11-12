# card-lens-002 validation

End-to-end check, 2026-11-12. `pi-hub add <app> --add-cwd <lib>` from this worktree's `dist` under a temporary `PI_AGENT_HUB_DIR` made a two-repo workspace (symlinks `app`, `lib`; both temp git repos). Its tmux session was then replaced with one Pi process that loads only this worktree's extensions:
`pi --no-extensions -e pi-agent-hub/dist/src/extension/index.js -e rules/extensions/workflow-runtime/index.ts -e rpiv-ask-user-question`, same session id and Hub env. No worktree record was bound, so the Commit step found repos through the workspace symlinks. `pi-hub tui` ran from this worktree's `dist`.

Script: `set_workflow_ticket demo-001`, `set_workflow_step plan-md`, `set_workflow_activity reviewing-plan`, one `ask_user_question`; answer it; then `set_workflow_step commit`, `archive_plan.sh`, `features_yaml.sh complete`, `committing-changes`, one bash call committing in `app` and `lib`, `complete_workflow`.

Note: `reviewing-plan` was published before the question, so `ask_user_question` moved the activity back to `clarifying-requirements` (existing behavior); the critic pass item therefore reads done.

## Plan, question open, 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ●  1 session
 ── NEEDS YOU 1 ─────────────────────────────────────────────│  ? Demo Lenses ⧉2 new  e2e                                                                    now
▌    ? Demo Lenses ⧉2 new   e2e · Exercise Plan and … PL  now│    app
▌    ASK    Keep the Use as reply button?                    │    Exercise Plan and Commit lenses
                                                             │    ASK    Button · Keep the Use as reply button?
  NEW DAILY LOOP · Enter Dismiss                             │
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    DOING  Clarifying scope
  Esc leaves answer focus without declining the question.    │    WHERE  PL◉ EX· RV· RF· CM· │ inspect✓ scope◉ write· critic· ready·
  Alt+W finds the next request while inside Pi.              │
                                                             │    PLAN   2 phases · 3 tasks · 2 criteria
                                                             │           ! 1 waiting: Keep the Use as reply button?
                                                             │           ✓ critic pass 1
                                                             │
                                                             │    LOG    38s set_wo… reviewing-plan
                                                             │           42s set_wo… plan-md
                                                             │           44s set_wo… demo-001
```

## Plan, question answered, 160 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ Demo Lenses ⧉2  e2e                                                                        now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    Exercise Plan and Commit lenses
  Alt+W finds the next request while inside Pi.              │    DOING  Clarifying scope
 ── NEW 1 ───────────────────────────────────────────────────│    WHERE  PL◉ EX· RV· RF· CM· │ inspect✓ scope◉ write· critic· ready·
▌    ◐ Demo Lenses ⧉2   e2e · Exercise Plan and Comm… PL  now│
▌    DOING  Clarifying scope                                 │    PLAN   2 phases · 3 tasks · 2 criteria
                                                             │           ✓ 1 answered
                                                             │           ✓ critic pass 1
                                                             │
                                                             │    LOG    50s set_wo… reviewing-plan
                                                             │           54s set_wo… plan-md
                                                             │           56s set_wo… demo-001
                                                             │
                                                             │
```

## Commit after `complete_workflow`, 160 columns (hashes match `git log` in each repo)

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ◉  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  ◐ Demo Lenses ⧉2  e2e                                                                        now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    Exercise Plan and Commit lenses
  Alt+W finds the next request while inside Pi.              │    DOING  Commit complete
 ── NEW 1 ───────────────────────────────────────────────────│    WHERE  PL✓ EX✓ RV✓ RF✓ CM✓ │ archive✓ commit✓
▌    ◐ Demo Lenses ⧉2   e2e · Exercise Plan and Com… CM✓  now│
▌    DOING  Commit complete                                  │    CLOSE  2 commits
                                                             │           ✓ Plan archived
                                                             │           ✓ Ticket demo-001 done
                                                             │           ✓ app 7b6201c Archive demo plan
                                                             │           ✓ lib 9ba921b Add lib notes
                                                             │
                                                             │    LOG    52s comple…
                                                             │           54s bash    git -C app add -A && git -C app commit -m "Archive demo plan" && echo lib …
                                                             │           56s set_wo… committing-changes
                                                             │
                                                             │
```

## Commit after `complete_workflow`, 100 columns

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                          ◉  1 session
  NEW DAILY LOOP · Enter Dismiss      │  ◐ Demo Lenses ⧉2  e2e                                    1m
  Tab opens an answer; p writes a     │    app
  reply; Enter opens Pi.              │    Exercise Plan and Commit lenses
  Esc leaves answer focus without     │    DOING  Commit complete
  declining the question.             │    WHERE  PL✓ EX✓ RV✓ RF✓ CM✓ │ archive✓ commit✓
  Alt+W finds the next request while  │
  inside Pi.                          │    CLOSE  2 commits
 ── NEW 1 ────────────────────────────│           ✓ Plan archived
▌    ◐ Demo Lenses ⧉2   e2e   CM✓   1m│           ✓ Ticket demo-001 done
▌    DOING  Commit complete           │           ✓ app 7b6201c Archive demo plan
                                      │           ✓ lib 9ba921b Add lib notes
                                      │
                                      │    LOG    1m  comple…
                                      │           1m  bash    git -C app add -A && git -C app commi…
                                      │           1m  set_wo… committing-changes
```

## Pi stopped (tmux killed): the registry keeps the Commit lens

```text
pi hub  FLEET   Codex 1 week▰▰▰▰▱   Claude 1 5h▰▰▰▰▱ week▰▰▱▱▱                                                                                      ×  1 session
  NEW DAILY LOOP · Enter Dismiss                             │  × Demo Lenses ⧉2 new  e2e                                                                    now
  Tab opens an answer; p writes a reply; Enter opens Pi.     │    app
  Esc leaves answer focus without declining the question.    │    Exercise Plan and Commit lenses
  Alt+W finds the next request while inside Pi.              │    ERR    tmux session is missing
 ── HEALTH 1 ────────────────────────────────────────────────│
▌    × Demo Lenses ⧉2 new   e2e · Exercise Plan and… CM✓  now│    DOING  Commit complete
▌    ERR    tmux session is missing                          │    WHERE  PL✓ EX✓ RV✓ RF✓ CM✓ │ archive✓ commit✓
                                                             │
                                                             │    CLOSE  2 commits
                                                             │           ✓ Plan archived
                                                             │           ✓ Ticket demo-001 done
                                                             │           ✓ app 7b6201c Archive demo plan
                                                             │           ✓ lib 9ba921b Add lib notes
                                                             │    Check Details before restarting.
                                                             │
```
