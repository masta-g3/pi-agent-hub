# Plain terminal support

**Feature:** ui-polish-010 → Plain terminal support
**Session:** pi parent (workflow-orchestrator)
**Worktree:** /Users/manager/.local/share/agent-worktrees/ui-polish-010-9274ecf0a9f1/pi-agent-hub on `ui-polish-010`
**Start branch:** `ui-polish-integration`
**PR target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md` (critique finding 19)
**Depends on:** ui-polish-004, ui-polish-005, ui-polish-006, ui-polish-007, ui-polish-008, ui-polish-009 (runs last so no later renderer adds glyph literals)

## Goal

The dashboard works in plain terminals: it honors `NO_COLOR`, and an opt-in ASCII glyph set avoids symbols with inconsistent widths.

## Confirmed decisions

- `NO_COLOR` (set and non-empty, per no-color.org) disables all foreground and background color from the dashboard theme. Bold may remain. Selection stays visible through the existing `▌` marker plus reverse video on the selected row's marker cell or title (pick one; reverse on the title is preferred if width-safe). Pi theme sync is skipped under `NO_COLOR`.
- Glyphs are centralized in one module (`src/tui/glyphs.ts`) with two sets, `unicode` (today's symbols after ui-polish-004) and `ascii`. Every row/status/marker glyph literal in `src/tui/*` reads from the active set: status (`●` spinner `◐ ○ × -`), attention (`? ! ✓`), disclosure (`▸ ▾`), tree (`│ └`), selection (`▌`), worktree markers (`⎇ ⎇… ⎇! ⎇✓`), repo (`◈`/`⧉`), subagents (`⚙︎`), grid (`✓ ◉ ·`), progress (`■ □`).
  ASCII mapping (proposal; keep 1-cell widths): `●`→`*`, spinner→`|/-\`, `◐`→`~`, `○`→`o`, `×`→`x`, `✓`→`v`, `▸`→`>`, `▾`→`v`, `│`→`|`, `└`→`` ` ``, `▌`→`>`, `⎇`→`@`, `◈`/`⧉`→`#`, `⚙︎`→`+`, `◉`→`O`, `■`/`□`→`#`/`.`.
- Selection: environment variable `PI_AGENT_HUB_GLYPHS=ascii` (any other value or unset = `unicode`), read at dashboard start. No persisted config and no CLI command (epic excludes new persisted state). Document it in docs/CONFIG.md. Preserve it through `dashboardEnv()` so dashboard recreation keeps it (AGENTS.md tmux rule).
- The ASCII set also covers shared chrome: frame corners and edges (`╭╮╰╯│─`), rules and separators (`─`, ` · `), navigation labels (`↑↓`, `←→`, `▸`), and truncation ellipsis (`…`→`...` with width accounting). User text (titles, messages) is never altered.
- Tmux chrome (`src/core/tmux.ts`) and Pi sessions are out of scope.

## Context Files

- Core: `src/tui/layout.ts` frame/rule helpers (:1801–1825), `src/tui/dashboard-commands.ts` footer arrows (:302–303), `truncate` helper, `src/core/tmux.ts` `dashboardEnv()`, `src/tui/theme.ts` (`styleToken`, `styleBgToken`, runtime theme sync), `src/tui/render-model.ts` (`SPINNER_FRAMES`, `symbolFor`), `src/tui/layout.ts` (glyph literals), `src/core/worktree-lifecycle.ts:4,48–53` (marker type), `src/tui/status-evidence.ts`, `src/tui/conversation.ts`, `src/core/config.ts` (or the module that parses `config.json`), `src/cli.ts`/config command, `src/app/run-tui.ts` (startup wiring).
- Tests: `test/theme.test.ts`, `test/config.test.ts`, `test/cli-config.test.ts`, `test/render-model.test.ts`, `test/phone-layout.test.ts`.
- Reference: docs/CONFIG.md "Global config", existing `dashboard.attentionNotify` handling as the pattern.

## Reuse

- Env handling pattern of existing `PI_AGENT_HUB_*` variables and `dashboardEnv()`. Theme application stays in `styleToken`. One glyph module; no per-file constants.

## Implementation Phases

### Phase 1: NO_COLOR
- [ ] Tests: with `NO_COLOR=1`, a rendered dashboard frame contains no SGR color codes (30–37, 38;…, 40–47, 48;…, 90–97) but the selected row is still identifiable (`▌` and reverse on the title); with `NO_COLOR=""` colors remain.
- [ ] Implement in theme styling and skip theme sync.

### Phase 2: Glyph module
- [ ] Test: with `ascii`, a fleet+workspace+board frame at 80/160 contains only ASCII printable characters (except user text) and all lines have exact width.
- [ ] Create `glyphs.ts`; replace literals including frame, rules, arrows, and ellipsis; wire `PI_AGENT_HUB_GLYPHS` → active set at startup.
- [ ] Test: `dashboardEnv()` forwards `PI_AGENT_HUB_GLYPHS`.

### Phase 3: Docs
- [ ] docs/CONFIG.md (NO_COLOR, `PI_AGENT_HUB_GLYPHS`), docs/STRUCTURE.md (glyph module ownership).
- [ ] Full `npm test` passes.

## Acceptance Criteria

- [ ] With `NO_COLOR` set, frames have no color codes and selection remains visible (test).
- [ ] With `PI_AGENT_HUB_GLYPHS=ascii`, dashboard frames (including frame, rules, footer, truncation) use only ASCII glyphs and keep exact widths (test at 80/160).
- [ ] Default rendering is unchanged (existing tests pass).
- [ ] The variable is documented and survives dashboard recreation; `npm test` passes.

## Discovered Work

(none yet)

## Reflection Candidates

- docs/CONFIG.md, docs/STRUCTURE.md (glyph ownership), AGENTS.md TUI Rules (glyphs come from `glyphs.ts`).
