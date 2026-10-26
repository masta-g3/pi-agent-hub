# Plain terminal support

**Feature:** ui-polish-010
**Branch:** `ui-polish-010`
**Integration target:** `ui-polish-integration`
**Epic:** `agent-work/plans/ui-polish-000.md`

## Delivered

- Non-empty `NO_COLOR` suppresses dashboard theme foreground/background colors. The exact selected session retains a reverse-video marker cell. Bold remains available. Empty `NO_COLOR` preserves colors.
- Under `NO_COLOR`, dashboard startup skips Pi theme loading/synchronization and theme refresh. Theme-picker availability uses the existing command catalog guard.
- `src/tui/glyphs.ts` centralizes Unicode and ASCII glyphs. `PI_AGENT_HUB_GLYPHS=ascii` selects ASCII once per dashboard process; any other value keeps Unicode. No persisted setting or new command was added.
- All Hub-owned TUI surfaces use the shared glyph set: fleet and dense rows, board, workspace actions, frame/rules, navigation hints, truncation, Help, palette, dialogs/pickers/forms, and Conversation controls. Cursor/start-truncation budgets account for the three-cell ASCII ellipsis.
- Core worktree markers remain canonical data and convert at the render-model boundary. User and producer text is never transliterated.
- `dashboardEnv()` preserves both environment variables during dashboard recreation. Managed Pi sessions and tmux chrome remain outside this change.

## Confirmed boundaries

- Parent approved ASCII applying only to Hub-owned chrome. Pi's Markdown message formatting, including Unicode quote/table borders inside Conversation, remains unchanged.
- Selection uses the approved marker-cell reversal option rather than title reversal, keeping parent/subagent selection consistent.
- Existing theme/layout/render-model/catalog paths were extended; no second renderer, persisted state, or dependencies were introduced.

## Verification

- Full `env -u PI_TMUX_SUBAGENTS_JOB_ID npm test`: **1,251/1,251 pass**.
- Review regression run: **184/184 pass** across plain-terminal, theme, render-model, and phone-layout tests.
- Additional combined ASCII/NO_COLOR probes: **144 frames pass**, spanning widths 30–200 and heights 3–40.
- Isolated real-tmux smoke: 160/80-column fleet, reverse selection without SGR colors, Help, palette, new-session form, full-width workspace, and exit pass. Temporary Hub/Pi state and a separate tmux server protected live state.
- `npm run typecheck` and `git diff --check` pass. The source-inventory test prevents new noncentralized TUI glyph literals.
- Integration tip `d65d61479557ec1d37525b6222df9c1f3691cb95` was already included at commit handoff; no new merge changes required another full-suite run.

## Review and reflection

- Code critic: LGTM; no actionable findings or implementation corrections.
- Docs critic: LGTM; no high-impact findings. CONFIG.md owns operator settings and the Markdown boundary; STRUCTURE.md owns glyph/theme boundaries. AGENTS.md points to those docs instead of duplicating the details.
- No follow-up tickets or unresolved reflection candidates. Temporary validation scripts/logs were removed; no ticket artifact directory remains.
- Plan/ticket closeout is committed on the ticket branch only. Integration, push/PR actions, and worktree cleanup belong to the parent.
