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
│↑↓ Move · Enter Open · / Filter · : Actions · ? Help      │
╰──────────────────────────────────────────────────────────╯`,
  100: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                             │
│·1  ◫2 Docs refresh  ·3  ·4                                                                       │
│── NEEDS YOU                       ·1│Docs refresh                                       ◐ waiting│
│▌ ? ◐ ◫2 Docs refresh Docs · ◉RV · 8m│✓ PL─✓ EX─◉ RV · cockpit-001                                │
│                                     │/tmp/docs                                                   │
│── HEALTH                          ·1│                                                            │
│  × Flaky test investigation  QA · 8m│── work ─                                                   │
│                                     │attention ? Which changelog section wins?                   │
│── ACTIVE                          ·2│                                                            │
│  ◐ Dashboard U… ▾ Pi Agent Hub · ◉EX│── preview ────────────────────────────────                 │
│    └ ● code-critic      Pi Agent Hub│Pi preview                                                  │
│  ● Package release ch… Release · ◉RV│waiting for your reply                                      │
│                                     │                                                            │
│── QUIET                           ·2│                                                            │
│  ○ MCP integratio… Integrations · 8m│                                                            │
│  ○ Theme compatibility spike backlog│                                                            │
│                                     │                                                            │
│─▾ ARCHIVED                        ·1│                                                            │
│· - Recent archive                 1m│                                                            │
│                                     │                                                            │
│──────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯`,
  160: `╭ pi agent hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│8 sessions · ?1 needs you · ×1 health                                                                                                                         │
│·1  ◫2 Docs refresh  ·3  ·4                                                                                                                                   │
│── NEEDS YOU                          ·1│Docs refresh                                                                                                ◐ waiting│
│▌ ? ◐ ◫2 Docs refresh    Docs · ◉RV · 8m│✓ PL─✓ EX─◉ RV · cockpit-001                                                                                         │
│                                        │/tmp/docs                                                                                                            │
│── HEALTH                             ·1│                                                                                                                     │
│  × Flaky test investigation     QA · 8m│── work ─                                                                                                            │
│                                        │attention ? Which changelog section wins?                                                                            │
│── ACTIVE                             ·2│                                                                                                                     │
│  ◐ Dashboard UI p… ▾ Pi Agent Hub · ◉EX│── preview ────────────────────────────────                                                                          │
│    └ ● code-critic         Pi Agent Hub│Pi preview                                                                                                           │
│  ● Package release checks Release · ◉RV│waiting for your reply                                                                                               │
│                                        │                                                                                                                     │
│── QUIET                              ·2│                                                                                                                     │
│  ○ MCP integration c… Integrations · 8m│                                                                                                                     │
│  ○ Theme compati… backlog · Experiments│                                                                                                                     │
│                                        │                                                                                                                     │
│─▾ ARCHIVED                           ·1│                                                                                                                     │
│· - Recent archive                    1m│                                                                                                                     │
│                                        │                                                                                                                     │
│──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help                                                                                        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯`,
};
