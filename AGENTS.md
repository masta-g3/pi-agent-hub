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
- Active/Backlog source rows use `src/core/session-order.ts`: groups stay stable in `default`-first alphabetical order; inside each group, errors come first, then unacknowledged `waiting` rows newest-first, then `starting`/`running`, acknowledged `waiting`/`idle`, and stopped rows. Acknowledged waiting/idle rows retain activity ordering inside their lower tier. Persisted user order breaks exact priority/activity ties, and `K`/`J` reorder only inside such a tie. Archived is globally newest-first by archive time and cannot be reordered. Do not sort by title or add a separate stopped section.
- The default project cockpit is a presentation-only stable partition of full owner trees: `NEEDS YOU` requires valid explicit producer attention on a waiting/idle owner; `HEALTH` requires owner runtime error; `ACTIVE` requires a starting/running owner or descendant; `QUIET` contains other non-archived trees; `ARCHIVED` remains lifecycle-owned and chronological. Classify from the full unfiltered fleet, then filter visibility. Descendants inherit owner placement, but child attention/error never promotes the owner and placement never changes row status, workflow, lifecycle, or attention. Surface hidden explicit child requests only as presentation-owner/tier counts derived from full-fleet request IDs minus visible projection IDs. Groups appear as row metadata, not project headings.
- Emit runtime and cockpit-placement evidence from the existing reducers, keep it on transient runtime/render projections, and never persist or couple it to workflow state. Reveal that evidence inside the selected-session action workspace; do not add a parallel Info screen. See `docs/STRUCTURE.md` for observation, invalidation, CLI, and workspace contracts.
- Do not repurpose established shortcuts: `r` restart choices, `R` rename, `N` sync from Pi `/name`, plus hidden compatibility aliases `e` for rename and `Alt+N` for sync.
- Keep catalog-owned direct keys, `:` palette entries, dashboard Help, configured actions, workspace rows, and stable footer controls sourced from `src/tui/dashboard-commands.ts`. All invocation paths must honor the same availability guard. Bind contextual command, mouse action, and dialog/picker submission to the exact session/project identity; palette session results only select and ephemerally reveal, never attach, restart, or acknowledge. See `docs/STRUCTURE.md` for search, ordering, precedence, and reveal contracts.

## TUI Rules

- Keep rendering pure/testable and ANSI width-safe through theme/layout helpers; reserve width for row prefixes, badges, and a readable title before retaining right-side metadata. Reserve complete mode labels before fitting top-right owner signals. Active parent tails retain hidden requests longest, then active descendants, workflow, and age; keep Backlog and Archived on their lifecycle-specific ladders. Derive one adaptive hierarchy from row role, grouping, width, and height: Active parents can gain bounded continuation lines, Backlog/Archived parents stay single-line, subagents use micro rows, and pin-mode fleet rows stay single-line beside the decision strip. In project rows, place an accented `⎇` before worktree titles and a dim `⧉ N` repository-count badge after multi-repo titles; show `backlog`, group, workflow rail, and activity age only as width permits, and keep the full branch plus compact repository count in the action workspace. Only Archived has a project section target; its collapse/disclosure state stays synthetic so session actions cannot reach a stale real selection. Keep dashboard footer command metadata in `src/tui/dashboard-commands.ts` and TUI styling in `src/tui/layout.ts`, distinct from managed-session tmux chrome in `src/core/tmux.ts`.
- Keep the workflow board a read-only projection over producer metadata: no mirrored stage list or board persistence. Canonical workflow trees stay in producer lanes; every other Active tree appears once in synthetic `OTHER ACTIVE`. Nest cards under top-level parent groups. Subagent trees start collapsed in both project and board grouping, use ephemeral `←`/`→` selected-tree and `Shift+←`/`Shift+→` all-tree disclosure state, accept `Space` as a board selected-tree toggle, and auto-reveal filtered child context without mutating disclosure state. Preserve one keyboard/navigation target per visible card; map visible continuation rows to their owning session only for mouse hit testing so whole-card single/double clicks match the title row. At normal 100+ widths, apply rich-tree gutters only after windowing, reserve the warning gutter for `NEEDS YOU`, and never imply a false end or continuation. Paint every visible line in the selected owner tree while keeping `▌` and all actions on the exact selected session. Top-level parent `⚙︎N` counts only starting/running descendants and never promotes child state. Treat workflow position, Hub runtime status, explicit attention, and running-subagent count as independent axes; show attention only for waiting/idle rows and never infer it from liveness. Keep the tier navigator project-only and mouse-only, and progress bars board-only. Keep responsive geometry, hit-map, adaptive hierarchy, navigator, progress, and windowing details in `docs/STRUCTURE.md`; do not add parallel projections or renderers.
- Keep one selected-session action workspace with this block order: identity, explicit request, Hub-derived recommendation, enabled catalog actions, bounded context, runtime state, optional evidence, producer workflow, tree. Use the same renderer at every width: 34 cells at 120–159, 44 at 160+, and an exact-session full-width screen below 120. The first narrow `Enter`/double-click opens it without side effects; workspace `Enter` runs Open/Restart. Never capture, render, or search raw tmux pane tails or Pi conversation content.
- Route dialogs through `SessionDialog` in `src/tui/dialog.ts` and the small `src/tui/*-dialog.ts` modules. Use `src/tui/text-input.ts` and `src/tui/form.ts`/`renderForm()` for editable inputs instead of one-off state.
- For themed footers, prefer Pi `statusLineBg` before `border` so Catppuccin border/accent colors do not become unreadable full-bar backgrounds.

## Persistence, Skills, and MCP

- Use `src/core/atomic-json.ts` for JSON state: `loadStore`, `updateStore`, `writeJsonAtomic`, and `isErrno`; avoid local errno helpers and parallel per-item read-modify-write loops.
- For Skills/MCP project state, write the final selection once. Pickers target the selected session's primary `cwd`, or dashboard cwd when nothing is selected; multi-repo sessions attach Skills/MCP only to the primary repo.
- Skill pool path editing lives in the `s` picker on `Alt+E`; `←`/`→` switch columns, `Tab` remains an alias, and printable keys including `e` must remain available for picker search.

## Tmux and Extension Behavior

- Clipboard is optional best-effort; attach/switch flows must always display the exact tmux command.
- Keep inside-tmux attach tmux-native with `src/core/tmux.ts`; do not stop/restart the TUI or add PTY attach unless outside-tmux return semantics are explicitly requested.
- Root `bind-key -n` shortcuts are server-global; preserve the passthrough and restore rules in `docs/STRUCTURE.md`. Numeric/spatial focus bindings send an intent to the exact saved sidebar pane; shell code must never resolve or focus a destination slot directly.
- Sidebar pins are nested tmux attaches identified by transient slot plus exact tty-to-managed-session identity. Never retarget, swap, replace, acknowledge on creation, or evict; contraction preserves pins and blocks additions/resizing but must still permit safe close/rollback. Serialize inspection, reconciliation, mutation, focus, handoff, and shutdown through the side-pane queue. Keep topology, geometry, chrome, and recovery behavior aligned with `docs/STRUCTURE.md`.
- Preserve `dashboardEnv()` for any tmux return path that can recreate the dashboard so custom `PI_*` dirs survive.
- Export `PI_AGENT_HUB_PRIMARY_CWD=ManagedSession.cwd` on every managed parent launch, including direct conversation forks. Never export the multi-repo workspace cwd or an additional repo through this contract, and do not change normal `f` or worktree behavior.
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

- Optional `kind: "subagent"` registry rows are owned by `pi-tmux-subagents`: keep them nested and short, show bounded task text in fleet micro rows, retain it in the action workspace/filtering, and disable normal session lifecycle/group/order actions on them.
- Optional producer-neutral `pi-agent-hub-context` Pi entries carry bounded ticket context and producer-accepted attention through the Hub heartbeat. Structurally validate the latest versioned snapshot, ignore unknown fields, and never persist context into `registry.json` or couple it to Rules. Display attention only for waiting/idle rows; do not infer or reclassify it from confidence, stage, liveness, or workflow state.
- Keep producer-owned `workflow-runtime` separate from generic context: its workflow vocabulary, activity, deterministic plan, ticket identity, modes, and optional current-position completion remain producer-defined. Render completion positionally: earlier steps and a completed current step are checked, the incomplete current step is active, and later steps are pending. This is a position cue, not an execution audit; direct later-step invocation checks earlier positions without Hub sequence enforcement. Context, workflow position, completion, Hub liveness, native Pi naming, and attention are independent axes.

## Validation

- Do not run `npm test` and `npm run package:check` concurrently because both rebuild `dist`.
- If the user is actively using an installed/linked `pi-hub`, avoid build/package commands unless approved; prefer `npm run typecheck` for non-disruptive validation.
