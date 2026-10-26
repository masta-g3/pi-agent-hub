# Dashboard UI critique and improvement plan

Date: 2026-10-25. Scope: visual, interaction, and copy design of the `pi-hub` TUI.
Constraint: keep features, product boundaries, and the Pi-native, calm, keyboard-fast vision.

Evidence: frames rendered from the current `src/` (compiled to a temp dir; `dist/` untouched),
with synthetic sessions, at 160/120/100/80/50 columns. Screenshots in this folder.
The harness sessions have no tmux, so transport-gated actions (Open, Send, Pin) show as unavailable.
Do not read that as a product finding.

## Verdict

The information architecture is strong. The visual execution is not yet at the same level.

Strong already:
- Triage-first tiers (NEEDS YOU → HEALTH → ACTIVE → QUIET), sorted by attention, then recency.
- Independent axes (workflow position, runtime, attention) that are never merged.
- One command catalog drives keys, palette, help, footer, and workspace.
- Adaptive card richness by width and height; frameless phone layout.
- Rendering basics: pi-tui already does differential rendering and synchronized output (`CSI ?2026`).
  Most "Rendering" and "Input" rules in the referenced terminal-ui skill are already met.

The gap to top-tier TUIs (lazygit, k9s, btop, Linear-style keyboard UX) is mostly
**reduction and consistency**, not features:
1. Too many glyph channels compete before the title.
2. Typographic hierarchy is inverted: metadata is bolder than titles.
3. Important text is drawn in a color that fails contrast.
4. The same counts appear three times while the most useful action key is hidden.
5. Vocabulary and key notation drift between screens.

## Findings (priority order)

### P0: correctness

1. **Footer mislabels Enter at 61–119 columns.** It says `Enter Workspace`, but Enter opens or switches
   to the session (docs/FEATURES.md:173 and the switch assertion at test/sessions-view.test.ts:2114–2116).
   Source: `src/tui/dashboard-commands.ts:295`. The test at line 2122 locks in the wrong label.
   Fix: `Enter Open` at every width; add `i Workspace` below 120.
2. **`openWorkspace()` has no callers** (`src/tui/sessions-view.ts:787`). Remove it.
3. **Initial cursor is mid-list.** With an error session present, the first selection is the HEALTH row,
   while NEEDS YOU renders above it (`src/app/controller.ts:44` uses source order, errors first; the cockpit
   puts NEEDS YOU first). On launch, select the first *rendered* target.

### P1: visual hierarchy and legibility

4. **Inverted hierarchy.** `[group]` and `◈ repo` are bold; the session title is regular weight
   (see fleet-80.png). The title is the thing the user scans. Fix: title = bold text color;
   group = muted, no bold; repo = muted.
5. **Glyph overload before the title.** A row can carry five slots: `· ? ◐ ⎇  Title`.
   The total inventory is about 20 symbols (`· ▸ ▾ ▌ │ └ ? ! ✓ ◐ ○ × - ⠋ ⎇ ⎇… ⎇! ⎇✓ ◈ ⚙︎ ◉ ■□`).
   - The `·` placeholder is shown on every row with no children. Render a blank instead.
   - `?` and `◐` say the same thing on NEEDS YOU rows. Use one **state slot**: attention glyph when
     present (`? ! ✓`), else runtime glyph (`⠋ ◐ ○ × -`).
   - `⎇` in the title line shifts titles right by 3 cells, so titles do not align
     (`◐ ⎇  Checkout flow` versus `◐ Migration boundary`). The branch is already on the metadata line.
     Remove it from the title line, or give it a fixed column.
   - Result: every title starts at the same column. This is the largest single scanning gain.
6. **Contrast.** `dim` = xterm 240 (`#585858`): 2.4:1 on the background, 1.45:1 on the selected row.
   It is used for ages, footer labels, brackets, and "TIERS". `muted` 244 is 4.3:1.
   Fix: dim → about `#737aa2` (4.1:1), or reuse `muted`. Rule: dim is for rules and separators only.
   Never put information in dim, and never draw dim text on `selectedBg`.
7. **Redundant counts, wasted width.** The same numbers appear in the tier navigator, the top summary
   (`9 trees · 3 needs you · 1 health`), and each tier header (`·3`). The navigator is mouse-only,
   costs 17–18 columns, and stays visible at 100 columns, where the action workspace is gone.
   Fix: drop the navigator column. Make the header summary chips the mouse targets (same jump
   behavior). Put each count next to its tier label: `NEEDS YOU 3`.
   *This changes a documented rule in AGENTS.md (tier navigator).*
8. **Title line wastes its right side.** In the 2-line rung, line 1 is empty to the right, and the
   workflow grid and age go on line 2 (see fleet-dense-160.png: about 17 sessions in 44 rows).
   Fix: add a 1-line rung to the adaptive ladder, used before scrolling: state, title, group·age,
   grid on one line. Same 44 rows then show about 30 sessions. *Adds a rung; keeps the current ladder.*
9. **Motion noise.** Every running row animates a braille spinner at 250 ms. Six running rows means
   six moving things. CONTEXT.md asks for "calm". Fix: static `●` for running list rows; animate only
   the selected row or the header count. Use motion for *change*: a short highlight when a row enters
   NEEDS YOU.

### P2: semantics, copy, and consistency

10. **Disabled is not error.** The palette shows unavailable reasons in error red and labels in full
    text color (palette-160.png). Fix: dim the whole row, show the reason in muted, and sort
    unavailable rows below available ones.
11. **Help is a state dump, not a reference.** Each line appends `unavailable: …` for the current
    selection. Key column truncates (`Enter/C-m/C…`). Filters show `:` as their key.
    Fix: group by Session · Pins · Views · Filters; no availability state; full key column;
    show the alias set once.
12. **Key notation drifts:** `ctrl-o`, `^Y`, `Ctrl+Q`, `C-m`, `M-n`, `Alt+N`, `enter`/`Enter`, `esc`/`Esc`.
    Fix: one formatter: `Ctrl+O`, `Alt+N`, `Shift+↑`, `Enter`, `Esc`.
13. **Vocabulary drifts:** "trees" (internal), HEALTH tier versus `error` status, Details/Info/Hide details,
    board footer `S projects` versus footer `S Board`. Fix: user-facing "sessions"
    (`9 sessions · +2 agents`); one name per concept.
14. **Board uses a second workflow encoding.** Fleet uses grid columns (`✓ ✓ ◉ · ·` under PL EX RV…);
    board uses an inline rail (`✓ PL─● EX─· RV─·`). Lane headers (the primary grouping) are dim, while
    group subheaders are bright accent, and each card repeats the group as `[group]`.
    Fix: use the grid on the board too; lane header = strongest; group subheader muted; drop the
    repeated badge under a group subheader.
15. **Footer priorities.** `]` Next request is the core triage key, but it is not in the footer.
    `b Backlog` is ambiguous with `B` (move to Backlog). Fix: when requests exist, show
    `] Next request 3` first; relabel `b` as `Show backlog`.
16. **Action workspace.** Key-first rows with a wide gap (`a      Mark read`) and a faint `▸`.
    Fix: label-first rows with right-aligned key chips; draw the primary row as a filled accent bar.
    The primary should match what Enter does, so the screen and the key agree.
17. **New-session dialog** (new-session.png). `[ Create session ]` renders dim, so it reads as disabled;
    the `Actions` heading is out of the indent; the footer lists create twice (`enter`, `^Y`) and repeats
    `ctrl-o` from the hint line. Fix: accent primary button when valid; one hint line.
18. **Conversation and answer view** (README demo). Full-width colored rules per message, a large empty
    gap between the last message and the answer card, and three hint lines. Fix: speaker label with a
    short rule; dock the answer card directly under the last message; one hint line.
19. **Degradation.** Hub code has no `NO_COLOR` check. `⚙︎` (with VS15) and `⎇` render at inconsistent
    widths in some fonts. Fix: honor `NO_COLOR` (selection keeps `▌`); offer an ASCII glyph fallback.

## Mockups

Current NEEDS YOU card, 5 lines:

```
│ · ? ◐ ⎇  Checkout flow
│ [storefront] · 1m                                   ✓   ✓   ◉   ·   ·
│ “Bottom sheet or full page?”
│ reviewing implementation (pass 2)
└ ◈ shop ⎇ feat/guest-checkout
```

Proposed, 3 lines, aligned titles, one state slot:

```
▌ ?  Checkout flow                          storefront · 1m   ✓  ✓  ◉  ·  ·
     “Bottom sheet or full page?”
     reviewing implementation · pass 2 · shop ⎇ feat/guest-checkout
```

Proposed dense rung (1 line):

```
  ●  API cleanup                            services · 5m     ✓  ◉  ·  ·  ·
  ●  Dashboard polish ⚙1                    core · 8m         ✓  ◉  ·  ·  ·
  ○  Search tuning                          product · 14m
```

Proposed header (navigator removed; chips are mouse targets):

```
╭ pi hub · Fleet ──────────── 3 needs you · 1 error · 2 active · 2 quiet · 9 sessions ╮
│ NEEDS YOU 3                                                     PL  EX  RV  RF  CM │
```

Proposed workspace action rows:

```
▌ Open in Pi                     Enter
  Mark read                          a
  Details                            i
  All actions                        :
```

Proposed footer with open requests:

```
] Next request 3 · Enter Open · n New · / Filter · : Actions · ? Help
```

## Roadmap

Phase 1, quick wins (strings and tokens, low risk):
P0 items 1–3; contrast (6); key notation (12); vocabulary (13); footer (15); palette disabled styling (10).
Files: `dashboard-commands.ts`, `theme.ts`, `layout.ts`, `controller.ts`/`sessions-view.ts`, matching tests.

Phase 2, hierarchy (render-only):
title weight (4); single state slot, blank placeholder, aligned titles (5); calm motion (9);
help grouping (11); board encoding (14); workspace rows (16); dialog polish (17).
Files: `layout.ts`, `render-model.ts`, `sessions-view.ts` help, `new-session-dialog.ts`, `form.ts`.

Phase 3, structure (needs AGENTS.md and STRUCTURE.md rule updates):
navigator → header chips (7); 1-line dense rung (8); conversation docking (18); NO_COLOR and
ASCII glyph fallback (19).

## Referenced terminal-ui skill: applicability

The skill targets Ink and Clack. pi-agent-hub uses pi-tui, which already covers rendering
(single write, diffing, synchronized output). Rules that still apply here:
`ux-color-semantics` (10, 14), `tuicfg-help-system` (11), `input-immediate-feedback` (9, 15),
`robust-graceful-degradation` and `tuicfg-env-vars` (19), `ux-next-steps` (16).
