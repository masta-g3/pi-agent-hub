export const COCKPIT_EXPECTED_FRAMES: Record<60 | 100 | 160, string> = {
  60: `╭ pi agent hub ────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                     │
│·1  ◫2 Docs refresh  ·3  ·4                               │
│── NEEDS YOU                                            ·1│
│▌ ? ◐ ◫2 Docs refresh                      Docs · ◉RV · 8m│
│                                                          │
│── HEALTH                                               ·1│
│  × Flaky test investigation                       QA · 8m│
│                                                          │
│── ACTIVE                                               ·2│
│  ◐ Dashboard UI polish ▾          Pi Agent Hub · ◉EX · 8m│
│    └ ● code-critic                           Pi Agent Hub│
│  ● Package release checks                   Release · ◉RV│
│                                                          │
│── QUIET                                                ·2│
│  ○ MCP integration cleanup              Integrations · 8m│
│  ○ Theme compatibility spike   backlog · Experiments · 8m│
│                                                          │
│─▾ ARCHIVED                                             ·1│
│· - Recent archive                                      1m│
│                                                          │
│──────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · / Filter · : Actions · ? Help │
╰──────────────────────────────────────────────────────────╯`,
  100: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                             │
│·1  ◫2 Docs refresh  ·3  ·4                                                                       │
│── NEEDS YOU                                                                                    ·1│
│▌ ? ◐ ◫2 Docs refresh                                                              Docs · ◉RV · 8m│
│                                                                                                  │
│── HEALTH                                                                                       ·1│
│  × Flaky test investigation                                                               QA · 8m│
│                                                                                                  │
│── ACTIVE                                                                                       ·2│
│  ◐ Dashboard UI polish ▾                                                  Pi Agent Hub · ◉EX · 8m│
│    └ ● code-critic                                                                   Pi Agent Hub│
│  ● Package release checks                                                           Release · ◉RV│
│                                                                                                  │
│── QUIET                                                                                        ·2│
│  ○ MCP integration cleanup                                                      Integrations · 8m│
│  ○ Theme compatibility spike                                           backlog · Experiments · 8m│
│                                                                                                  │
│─▾ ARCHIVED                                                                                     ·1│
│· - Recent archive                                                                              1m│
│                                                                                                  │
│──────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · n New · / Filter · S Board · : Actions · ? Help                       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯`,
  160: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                                                                                         │
│·1  ◫2 Docs refresh  ·3  ·4                                                                                                                                   │
│── NEEDS YOU                                                                                                   ·1│SELECTED SESSION                            │
│▌ ? ◐ ◫2 Docs refresh                                                                             Docs · ◉RV · 8m│Docs refresh                       ◐ waiting│
│                                                                                                                 │#cockpit-001 · Docs                         │
│── HEALTH                                                                                                      ·1│────────────────────────────────────────────│
│  × Flaky test investigation                                                                              QA · 8m│? QUESTION                                  │
│                                                                                                                 │“Which changelog section wins?”             │
│── ACTIVE                                                                                                      ·2│RECOMMENDED NEXT                            │
│  ◐ Dashboard UI polish ▾                                                                 Pi Agent Hub · ◉EX · 8m│Answer the producer's explicit question.    │
│    └ ● code-critic                                                                                  Pi Agent Hub│────────────────────────────────────────────│
│  ● Package release checks                                                                          Release · ◉RV│p   Send text… · send one line without open…│
│                                                                                                                 │Enter Open · attach to the session; stopped…│
│── QUIET                                                                                                       ·2│a   Mark read · acknowledge the selected wa…│
│  ○ MCP integration cleanup                                                                     Integrations · 8m│:   Actions · search actions, sessions, bou…│
│  ○ Theme compatibility spike                                                          backlog · Experiments · 8m│────────────────────────────────────────────│
│                                                                                                                 │STATE                                       │
│─▾ ARCHIVED                                                                                                    ·1│◐ waiting · NEEDS YOU                       │
│· - Recent archive                                                                                             1m│producer asked a question                   │
│                                                                                                                 │i Explain live status                       │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help                                                                                        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`,
};
