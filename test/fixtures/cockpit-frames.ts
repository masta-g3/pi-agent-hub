export const COCKPIT_EXPECTED_FRAMES: Record<60 | 100 | 160, string> = {
  60: `╭ pi agent hub ────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                     │
│── NEEDS YOU                                            ·1│
│▌ · ? ◐ Docs refresh                                   ◉RV│
│  “Which changelog section wins?”                         │
│                                                          │
│── HEALTH                                               ·1│
│  ·   × Flaky test investigation                          │
│                                                          │
│── ACTIVE                                               ·2│
│  ▾   ◐ Dashboard UI polish ⚙︎1                         ◉EX│
│  └─   ● code-critic Review cockpit hierarchy geometry    │
│  ·   ● Package release checks                         ◉RV│
│                                                          │
│── QUIET                                                ·2│
│  ·   ○ MCP integration cleanup                           │
│  ·   ○ Theme compatibility spike                  backlog│
│                                                          │
│─▾ ARCHIVED                                             ·1│
│  ·   - Recent archive                                  1m│
│                                                          │
│──────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · / Filter · : Actions · ? Help │
╰──────────────────────────────────────────────────────────╯`,
  100: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                             │
│FLEET           │── NEEDS YOU                                                                   ·1│
│NEEDS YOU      1│▌ · ? ◐ Docs refresh                                                     ◉RV · 8m│
│HEALTH         1│  “Which changelog section wins?”                                                │
│ACTIVE         2│  #cockpit-001 · Docs                                                            │
│QUIET          2│── HEALTH                                                                      ·1│
│ARCHIVED       1│  ·   × Flaky test investigation                                               8m│
│                │  QA                                                                             │
│                │── ACTIVE                                                                      ·2│
│                │  ▾   ◐ Dashboard UI polish ⚙︎1                                           ◉EX · 8m│
│                │  #cockpit-001 · Pi Agent Hub                                                    │
│                │  └─   ● code-critic Review cockpit hierarchy geometry                           │
│                │  ·   ● Package release checks                                                ◉RV│
│                │  #cockpit-001 · Release                                                         │
│                │── QUIET                                                                       ·2│
│                │  ·   ○ MCP integration cleanup                                                8m│
│                │  Integrations                                                                   │
│                │  ·   ○ Theme compatibility spike                           backlog · Experiments│
│                │─▾ ARCHIVED                                                                    ·1│
│                │  ·   - Recent archive                                                         1m│
│──────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · n New · / Filter · S Board · : Actions · ? Help                       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯`,
  160: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                                                                                         │
│FLEET            │── NEEDS YOU                                                                                 ·1│SELECTED SESSION                            │
│NEEDS YOU       1│▌ · ? ◐ Docs refresh                                                        ✓ PL─✓ EX─◉ RV · 8m│Docs refresh                       ◐ waiting│
│HEALTH          1│  “Which changelog section wins?”                                                              │#cockpit-001 · Docs                         │
│ACTIVE          2│  #cockpit-001 · Docs                                                                          │────────────────────────────────────────────│
│QUIET           2│── HEALTH                                                                                    ·1│? QUESTION                                  │
│ARCHIVED        1│  ·   × Flaky test investigation                                                             8m│“Which changelog section wins?”             │
│                 │  QA                                                                                           │RECOMMENDED NEXT                            │
│                 │── ACTIVE                                                                                    ·2│Answer the producer's explicit question.    │
│                 │  ▾   ◐ Dashboard UI polish ⚙︎1                                              ✓ PL─◉ EX─· RV · 8m│────────────────────────────────────────────│
│                 │  #cockpit-001 · Pi Agent Hub                                                                  │p   Send text… · send one line without open…│
│                 │  └─   ● code-critic Review cockpit hierarchy geometry                                         │Enter Open · attach to the session; stopped…│
│                 │  ·   ● Package release checks                                                   ✓ PL─✓ EX─◉ RV│a   Mark read · acknowledge the selected wa…│
│                 │  #cockpit-001 · Release                                                                       │:   Actions · search actions, sessions, bou…│
│                 │── QUIET                                                                                     ·2│────────────────────────────────────────────│
│                 │  ·   ○ MCP integration cleanup                                                              8m│STATE                                       │
│                 │  Integrations                                                                                 │◐ waiting · NEEDS YOU                       │
│                 │  ·   ○ Theme compatibility spike                                         backlog · Experiments│producer asked a question                   │
│                 │─▾ ARCHIVED                                                                                  ·1│i Explain live status                       │
│                 │  ·   - Recent archive                                                                       1m│                                            │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help                                                                                        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`,
};
