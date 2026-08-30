export const COCKPIT_EXPECTED_FRAMES: Record<60 | 100 | 160, string> = {
  60: `╭ pi agent hub ────────────────────────────────────────────╮
│FLEET                     8 trees · 1 needs you · 1 health│
│── NEEDS YOU                                            ·1│
│▌ · ? ◐ Docs refresh                                   ◉RV│
│  “Which changelog section wins?”                         │
│                                                          │
│── HEALTH                                               ·1│
│  ·   × Flaky test investigation                          │
│                                                          │
│── ACTIVE                                               ·2│
│  ▾   ◐ Dashboard UI polish                       ⚙︎1 · ◉EX│
│  └─   ● code-critic Review cockpit hierarchy geometry    │
│  ·   ● Package release checks                         ◉RV│
│                                                          │
│── QUIET                                     ·3 · ?1 child│
│  ▸   ○ Quiet parent                                    ?1│
│  ·   ○ MCP integration cleanup                           │
│  ·   ○ Theme compatibility spike                  backlog│
│                                                          │
│─▾ ARCHIVED                                             ·1│
│  ·   - Recent archive                                  1m│
│──────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · / Filter · : Actions · ? Help │
╰──────────────────────────────────────────────────────────╯`,
  100: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────╮
│FLEET                                                             8 trees · 1 needs you · 1 health│
│TIERS           │─│ NEEDS YOU                                                                   ·1│
│NEEDS YOU      1│▌│ · ? ◐ Docs refresh                                                    ◉RV · 8m│
│HEALTH         1│ │ “Which changelog section wins?”                                               │
│ACTIVE         2│ └ #cockpit-001 · Docs                                                           │
│QUIET          3│── HEALTH                                                                      ·1│
│ARCHIVED       1│ │ ·   × Flaky test investigation                                              8m│
│                │ └ QA                                                                            │
│                │── ACTIVE                                                                      ·2│
│                │ │ ▾   ◐ Dashboard UI polish                                        ⚙︎1 · ◉EX · 8m│
│                │ │ #cockpit-001 · Pi Agent Hub                                                   │
│                │ └ └─   ● code-critic Review cockpit hierarchy geometry                          │
│                │ │ ·   ● Package release checks                                               ◉RV│
│                │ └ #cockpit-001 · Release                                                        │
│                │── QUIET                                                            ·3 · ?1 child│
│                │   ▸   ○ Quiet parent                                                     ?1 · 8m│
│                │   ·   ○ MCP integration cleanup                                               8m│
│                │   ·   ○ Theme compatibility spike                          backlog · Experiments│
│                │─▾ ARCHIVED                                                                    ·1│
│                │   ·   - Recent archive                                                        1m│
│──────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Workspace · n New · / Filter · S Board · : Actions · ? Help                       │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯`,
  160: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│FLEET                                                                                                                         8 trees · 1 needs you · 1 health│
│TIERS            │─│ NEEDS YOU                                                                                 ·1│Docs refresh                       ◐ waiting│
│NEEDS YOU       1│▌│ · ? ◐ Docs refresh                                                       ✓ PL─✓ EX─◉ RV · 8m│#cockpit-001 · Docs                         │
│HEALTH          1│ │ “Which changelog section wins?”                                                             │────────────────────────────────────────────│
│ACTIVE          2│ └ #cockpit-001 · Docs                                                                         │? “Which changelog section wins?”           │
│QUIET           3│── HEALTH                                                                                    ·1│Review · step 3 of 3                        │
│ARCHIVED        1│ │ ·   × Flaky test investigation                                                            8m│Answer in the Pi session.                   │
│                 │ └ QA                                                                                          │────────────────────────────────────────────│
│                 │── ACTIVE                                                                                    ·2│▸ Enter  Answer                             │
│                 │ │ ▾   ◐ Dashboard UI polish                                           ⚙︎1 · ✓ PL─◉ EX─· RV · 8m│  a      Mark read                          │
│                 │ │ #cockpit-001 · Pi Agent Hub                                                                 │  i      Details                            │
│                 │ └ └─   ● code-critic Review cockpit hierarchy geometry                                        │  :      Actions                            │
│                 │ │ ·   ● Package release checks                                                  ✓ PL─✓ EX─◉ RV│                                            │
│                 │ └ #cockpit-001 · Release                                                                      │                                            │
│                 │── QUIET                                                                          ·3 · ?1 child│                                            │
│                 │   ▸   ○ Quiet parent                                                                   ?1 · 8m│                                            │
│                 │   ·   ○ MCP integration cleanup                                                             8m│                                            │
│                 │   ·   ○ Theme compatibility spike                                        backlog · Experiments│                                            │
│                 │─▾ ARCHIVED                                                                                  ·1│                                            │
│                 │   ·   - Recent archive                                                                      1m│                                            │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help                                                                                        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`,
};
