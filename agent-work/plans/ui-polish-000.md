# Dashboard UI polish epic

Goal: Bring the dashboard's visual, interaction, and copy design to a top-tier TUI standard by reduction and consistency, without adding features.
Design reference: `agent-work/ui-review/critique.md` (findings 1–19, mockups). Its proposals are the starting point; each ticket plan holds the approved details.
Scope: Footer and cursor correctness, key notation and copy, color roles and contrast, fleet row hierarchy and motion, header tier chips, dense one-line rows, board encoding, help and workspace rows, dialog and conversation polish, plain-terminal support.
Boundaries: Keep Pi as runtime, tmux as substrate, groups as labels, producer metadata read-only, attention explicit, one command catalog, and all established shortcuts. Never repurpose `r`, `R`, `N`, `e`, `Alt+N`. Keep rendering pure and width-safe through theme/layout helpers.
Implementation rule: Replace old paths instead of adding parallel renderers or settings. Card richness stays adaptive with no user setting. Update `AGENTS.md` and `docs/STRUCTURE.md` rules in the same ticket that changes them.
Excludes: New features, new commands or shortcuts, new persisted state (except removing navigator-only state), pane-tail capture, and changes to sort order or tier classification.

## Decisions

- Start branch `main` at `4107745`; integration branch `ui-polish-integration`; one draft PR into `main`. The user merges.
- The tier navigator column is removed. The header summary becomes clickable tier chips with the same jump behavior (user, 2026-10-25).
- Running rows show a static `●`; only the selected running row animates (user, 2026-10-25).
- The recent taller fleet cards (`dashboard-scanability-012`) stay as the richest rung. Density changes add rungs; they do not remove richer ones.
- Dim is decoration only (rules, separators, borders). Information uses `muted` or stronger. Theme token values (built-in and Pi themes) are unchanged; the fix is role assignment. On the selected row, dim decoration renders `muted`.
- Ordering: ui-polish-005 also depends on ui-polish-002 (summary copy). ui-polish-010 runs last, after 005–009, so no renderer adds glyph literals after its ASCII check.
- ASCII glyphs are selected by the environment variable `PI_AGENT_HUB_GLYPHS=ascii`, not persisted config.

## Tickets

- `ui-polish-001` — Done when the footer names what Enter does at every width, shows `] Next request` when requests exist, labels `b` as a backlog toggle, and the cursor starts on the first rendered row.
- `ui-polish-002` — Done when every surface formats keys one way and uses one user-facing name per concept.
- `ui-polish-003` — Done when no information renders in `dim`, dim never sits on the selected row, and unavailable palette actions look disabled, not erroneous.
- `ui-polish-004` — Done when fleet titles share one start column, rows show one state glyph, the title is the strongest text, and only the selected running row animates.
- `ui-polish-005` — Done when the navigator column is gone and header tier chips jump like the navigator did.
- `ui-polish-006` — Done when Active parents fall back to one-line rows before the list scrolls.
- `ui-polish-007` — Done when the board uses the fleet workflow grid and its lane headings outrank group headings.
- `ui-polish-008` — Done when help is a grouped static reference and workspace actions are label-first with a clear primary row.
- `ui-polish-009` — Done when the new-session dialog has a clear primary button and one hint line, and the answer card docks under the latest message.
- `ui-polish-010` — Done when `NO_COLOR` is honored with visible selection and `PI_AGENT_HUB_GLYPHS=ascii` renders ASCII-only chrome.
