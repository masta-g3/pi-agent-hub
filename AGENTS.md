# pi-agent-hub Agent Notes

## Product Boundaries

- Keep Hub Pi-native and small: Pi is the agent runtime, tmux is the durable process substrate, and Agent Deck architecture stays out unless explicitly requested.
- Groups and lifecycle buckets are dashboard labels, not first-class records/projects. Custom dashboard shortcuts stay config-driven Pi text sends, not shell commands, macros, or event systems.

## Names and State Paths

- `pi-hub` is the primary CLI; `pi-agent-hub` remains a compatibility alias. Keep package/runtime/tmux state names as `pi-agent-hub` unless a full rename is requested.
- Keep global state under `PI_AGENT_HUB_DIR` or `<PI_CODING_AGENT_DIR>/pi-agent-hub`; never use `<PI_CODING_AGENT_DIR>/sessions`, which belongs to Pi conversations.
- Multi-repo workspaces live under `<PI_AGENT_HUB_DIR>/workspaces/<session-id>` and contain symlinks only. Repo picker history is one bounded `<PI_AGENT_HUB_DIR>/repo-history.json` file with no filesystem scanning.
- Hub-owned worktrees live under `<PI_AGENT_HUB_DIR>/worktrees`; support only explicit create/finish/discard flows, including one branch name across multi-repo sessions, unless broader Git management is requested.

## Dashboard Behavior

- Groups are implicit session labels: `g` moves the selected session, `G` renames its current group globally, and no empty-group lifecycle should be added unless the model changes.
- Active/Backlog/Archived are optional per-session buckets: `A`/`B`/`U` only reorganize rows and must not stop tmux/Pi; subagent rows follow their parent.
- Active/Backlog groups and rows use `src/core/session-order.ts`: errors first, starting/running next, waiting and idle mixed by newest `lastActivityAt`, and stopped last. Groups in the waiting/idle tier are ordered by their newest member activity; existing group order breaks remaining ties. Persisted user order breaks exact priority/activity ties, and `K`/`J` reorder only inside such a tie. Archived is globally newest-first by archive time and cannot be reordered. Do not sort by title or add a separate stopped section.
- Do not repurpose established shortcuts: `r` restart choices, `R` rename, `N` sync from Pi `/name`, plus hidden compatibility aliases `e` for rename and `Alt+N` for sync.

## TUI Rules

- Keep rendering pure/testable and ANSI width-safe through theme/layout helpers; reserve width for right-side badges/counts in left/right columns. In groups view, keep fixed Active/Backlog slots for a muted workflow stage and right-aligned activity age, with the age blank while running; Archived remains age-only. Archived collapse/disclosure stays ephemeral TUI state and must remain a synthetic non-session target so session actions cannot reach a stale real selection. Keep dashboard footer rendering in `src/tui/render-model.ts` distinct from managed-session tmux chrome in `src/core/tmux.ts`.
- Route dialogs through `SessionDialog` in `src/tui/dialog.ts` and the small `src/tui/*-dialog.ts` modules. Use `src/tui/text-input.ts` and `src/tui/form.ts`/`renderForm()` for editable inputs instead of one-off state.
- For themed footers, prefer Pi `statusLineBg` before `border` so Catppuccin border/accent colors do not become unreadable full-bar backgrounds.

## Persistence, Skills, and MCP

- Use `src/core/atomic-json.ts` for JSON state: `loadStore`, `updateStore`, `writeJsonAtomic`, and `isErrno`; avoid local errno helpers and parallel per-item read-modify-write loops.
- For Skills/MCP project state, write the final selection once. Pickers target the selected session's primary `cwd`, or dashboard cwd when nothing is selected; multi-repo sessions attach Skills/MCP only to the primary repo.
- Skill pool path editing lives in the `s` picker on `Alt+E`; `←`/`→` switch columns, `Tab` remains an alias, and printable keys including `e` must remain available for picker search.

## Tmux and Extension Behavior

- Clipboard is optional best-effort; attach/switch flows must always display the exact tmux command.
- Keep inside-tmux attach tmux-native with `src/core/tmux.ts`; do not stop/restart the TUI or add PTY attach unless outside-tmux return semantics are explicitly requested.
- Detect whole tmux-server replacement through the persisted server epoch before auto-recovery. Recover only missing Active parent sessions that were not explicitly stopped; keep Backlog, Archived, stopped, and subagent rows untouched, validate cwd/history first, and isolate per-session failures.
- Root `bind-key -n` shortcuts are server-global; preserve the passthrough and restore rules in `docs/STRUCTURE.md`.
- Sidebar workspace panes are stateless nested tmux attaches; manage only panes whose tty maps to `pi-agent-hub-*`, serialize live inspection/mutation/focus through the side-pane queue, and close Hub-owned side panes before stopping the dashboard TUI. Pre-size session windows before panel/full-screen attach, split at final geometry, and always restore `window-size latest` afterward.
- Preserve `dashboardEnv()` for any tmux return path that can recreate the dashboard so custom `PI_*` dirs survive.
- `Alt+R` rename-from-session intentionally round-trips through the dashboard action handoff and explicit rename dialog; do not add a parallel in-session rename UI to hide the flash.
- Tmux chrome must override both `*-style` and `*-format` options. Themes can embed ANSI/style directives in formats, not just styles.
- The extension can load via both `pi install` and managed-session `--extension`; keep registration idempotent and clear active guards on `session_shutdown`.
- `session.prelude` belongs in global `config.json` and runs only before managed `pi`; do not hardcode macOS keychain/SSH/direnv behavior or run it for dashboard/direct TUI.

## Lifecycle Safety

- Delete sessions through `src/app/delete-session.ts`, pause any active refresh loop first, and never delete Pi conversation/session files.
- Normal delete must not remove hub-owned worktree directories; finish/discard through `src/app/worktree-session.ts`.
- For worktree finish/discard, preflight Git cleanliness before stopping parent/subagent tmux sessions, process additional repos before the primary repo, and keep workspace `.pi` pointed at the source repo.
- Archive pruning is dashboard-only and starts after seven days: prune only after every row in the parent/subagent cascade is confirmed missing from tmux; keep rows when tmux presence is unknown.

## Compatibility Metadata

- Optional `kind: "subagent"` registry rows are owned by `pi-tmux-subagents`: keep them nested and short in the left pane, keep task text in details/filtering, and disable normal session lifecycle/group/order actions on them.
- Optional `session-metadata/<session-id>.json` files are extension-owned transient display state: do not persist them into `registry.json`, do not use them for liveness/status counts/title sync, and clean them up with deletion.

## Validation

- Do not run `npm test` and `npm run package:check` concurrently because both rebuild `dist`.
- If the user is actively using an installed/linked `pi-hub`, avoid build/package commands unless approved; prefer `npm run typecheck` for non-disruptive validation.
