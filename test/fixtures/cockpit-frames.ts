export const COCKPIT_EXPECTED_FRAMES: Record<60 | 100 | 160, string> = {
  60: `╭ pi agent hub ────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                     │
│PINNED · ▢1 Docs refresh · constrained                    │
│◐ waiting · NEEDS YOU                                     │
│? Which changelog section wins?                           │
│p Send text… · : Actions                                  │
│── NEEDS YOU                                            ·1│
│▌ ? ◐ ▢1 Docs refresh                      Docs · ◉RV · 8m│
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
│↓ 1 more                                                  │
│──────────────────────────────────────────────────────────│
│1–4 Slot · x Close · Ctrl+Q · : · ?                       │
╰──────────────────────────────────────────────────────────╯`,
  100: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                             │
│PINNED · ▢1 Docs refresh · 2 empty                                                                │
│◐ waiting · NEEDS YOU                                                                             │
│? Which changelog section wins?                                                                   │
│p Send text… · : Actions                                                                          │
│── NEEDS YOU                                                                                    ·1│
│▌ ? ◐ ▢1 Docs refresh                                                              Docs · ◉RV · 8m│
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
│↓ 1 more                                                                                          │
│──────────────────────────────────────────────────────────────────────────────────────────────────│
│1–4 Assign · Alt+1–4 Focus · P Next · x Close · Ctrl+Q Return · : Actions · ? Help                │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯`,
  160: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                                                                                         │
│PINNED · ▢1 Docs refresh · 2 empty · 3 empty · 4 empty                                                                                                        │
│◐ waiting · NEEDS YOU                                                                                                                                         │
│? Which changelog section wins?                                                                                                                               │
│p Send text… · : Actions                                                                                                                                      │
│── NEEDS YOU                                                                                                                                                ·1│
│▌ ? ◐ ▢1 Docs refresh                                                                                                                          Docs · ◉RV · 8m│
│                                                                                                                                                              │
│── HEALTH                                                                                                                                                   ·1│
│  × Flaky test investigation                                                                                                                           QA · 8m│
│                                                                                                                                                              │
│── ACTIVE                                                                                                                                                   ·2│
│  ◐ Dashboard UI polish ▾                                                                                                              Pi Agent Hub · ◉EX · 8m│
│    └ ● code-critic                                                                                                                               Pi Agent Hub│
│  ● Package release checks                                                                                                                       Release · ◉RV│
│                                                                                                                                                              │
│── QUIET                                                                                                                                                    ·2│
│  ○ MCP integration cleanup                                                                                                                  Integrations · 8m│
│  ○ Theme compatibility spike                                                                                                       backlog · Experiments · 8m│
│↓ 1 more                                                                                                                                                      │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│1–4 Assign · Alt+1–4 Focus · P Next · x Close · Ctrl+Q Return · : Actions · ? Help                                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`,
};
