# fleet-design-001 — Fleet surfaces

The dashboard looked dated next to web apps. A design brainstorm with two `frontend-designer` subagents (Fable 5.1, Opus 5.5) and four mockup rounds led the maintainer to choose the boldest variant. This ticket replaces the framed look with painted surfaces in the existing renderer: no second render path and no config switch. Visual target and result: `agent-work/tickets/fleet-design-001/` (`mockups.html`, `implemented-vs-target.png`).

## Implemented

- **Surface tokens** (`src/tui/theme.ts` `surfaceTokens()`):
  - Card, band, keycap and pill-ink colors are derived from `selectedBg`.
  - A theme is dark when `text` is brighter than `selectedBg`. When `text` is the terminal default (as in Catppuccin Mocha), `selectedBg` brightness alone decides.
  - A non-hex `selectedBg` derives nothing.
  - `styleFg`/`styleBg` underpin `styleToken`/`styleBgToken`. `luminance()` is shared with appearance detection.
- **Frameless shell** (`src/tui/layout.ts`): the outer `box()`, the footer rule and the `Shell` inset are gone at every width.
  - The header band shows `pi hub` (only when room remains), the mode label and quota.
  - The Status header shows filled tier pills. They shrink to counts before any tier drops.
  - The footer band shows keycaps through one `footerLayout()`, which produces both the line and the hit targets. `FooterItem.x` is the keycap start.
  - Dialogs keep their frames.
- **Selected card:**
  - A tone `▌` stripe runs down every line on `selectedBg`: request tone, health tone, otherwise accent.
  - `QUESTION`/`READY`/`BLOCKED` pills sit above the request text.
  - Keycap rows come from the shared `layoutKeyRows()`.
  - Padding rows are added after windowing, only when two rows spare, and only above 60 columns.
  - Body text aligns under the title (column 2 below 40 columns).
  - The existing panel/`framedCard` machinery is kept. `requestFrameIdentity` was renamed `selectedCardIdentity`.
- **Unselected cards** in NEEDS YOU, HEALTH, NEW and ACTIVE sit on a raised card surface with a 1-column inset (edge to edge at 60 columns and below). Each has one identity line: title, markers, `↳N`, muted group, and the task at 100+ columns. `cardDetailLines()` adds:
  - a request in up to three lines: pill, hanging text, then the `→` recommendation;
  - otherwise a status line: the step name at 80+, plus activity, phase and tasks;
  - on HEALTH cards, the error reason;
  - on a collapsed tree with no step or activity of its own, its first running subagent (`RenderSession.runningSubagent`).
- **QUIET/ARCHIVED** rows stay flat. Dense rows keep `group · age`.
- **Other rendering:**
  - Fleet headings read `LABEL  N` in bold tone, with separate stripe and `▸` columns.
  - Tree gutters are board-only.
  - The `[group]` badge and `◈` are removed from fleet cards; `glyphs.repo` is deleted.
  - `⚙︎N` became `↳N`.
  - `dim` renders as `muted` on any painted card.

## Decisions

- Two tickets: the look first, the segmented workflow bar later (`fleet-design-002`). The shell changes on every screen; cards change only in the no-pin fleet. Board and pin rows are otherwise unchanged.
- Replace the old look outright instead of adding a style flag.
- Pill and keycap padding depends only on `NO_COLOR`, so an unfocused (quiet) or unpaintable theme never moves text or hit targets. Under `NO_COLOR`, pills and keycaps become plain bold words.
- Approved during the work:
  - surface derivation when `text` is the terminal default;
  - richer unselected cards (full requests, a status line for every active card, the subagent line).
- Not done: one space between a painted keycap and its label. It would change about 70 key-line assertions.

## Verification

- `npm test` passed 1,579 tests; typecheck is clean.
- code-critic findings fixed (board-only gutter preparation, dim-as-muted on painted cards); the re-review returned LGTM.
- Live check: the installed build rendered in the user's 230-column dashboard and the iPhone mockup comparison.
- Installed feature-only from this worktree (`main` at `1ae4daa` plus this patch) with `npm pack` and `npm install -g`.

## Follow-up

- `fleet-design-002`: a segmented workflow bar replaces the step grid.
- `fleet-design-003`: the instrument panel. Chosen direction: designer A's ruled modules and fleet meter, plus an LCD readout on the selected agent. A collapsed HEALTH tier still shows its `ERR` lines. The designer specs and mockups were kept outside the repo because they show a private dashboard.

## Durable docs

- `AGENTS.md` TUI rules (short card contract, frameless shell, surface tokens).
- `docs/STRUCTURE.md` (surface tokens, card anatomy and detail lines).
- `docs/CONFIG.md` Theme behavior and Plain terminals.
- `docs/FEATURES.md` and `README.md`.
