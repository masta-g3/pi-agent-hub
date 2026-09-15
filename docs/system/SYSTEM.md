# pi-agent-hub — System Definition

_**This file is the generated text twin of the interactive architecture atlas.** Both views come from one source file._

_Question status: **0 open · 15 resolved**._

## One paragraph

pi-agent-hub is a local terminal control center for long-running Pi coding-agent sessions. The CLI opens a keyboard-driven dashboard, tmux keeps each managed Pi process alive, a small Pi extension reports live state through heartbeat files, and the controller projects registry plus runtime data into a pure render model. Hub can organize sessions, open live side panes, create explicit multi-repo workspaces or Hub-owned worktrees, and attach project Skills and MCP tools without becoming an agent runtime, project manager, or general Git manager.

## Decisions locked

| Axis | Decision | ADR |
|---|---|---|
| Agent runtime | Pi remains the only agent runtime; Hub supervises it instead of replacing it. | [Context](../../CONTEXT.md) |
| Process substrate | tmux owns durable processes, attach/switch, panes, and return keys. | [Structure](../STRUCTURE.md) |
| State | Hub state stays under PI_AGENT_HUB_DIR or the Pi state directory and uses atomic JSON stores. | [Config](../CONFIG.md) |
| Rendering | Dashboard structure is projected through pure, testable render-model functions. | [Structure](../STRUCTURE.md) |
| Metadata | Context and workflow are producer-owned soft contracts; Hub validates and projects them. | [Config](../CONFIG.md) |
| Repository ownership | Multi-repo workspaces expose repos through symlinks and may add generated instructions; Git ownership is limited to explicit Hub worktrees. | [Features](../FEATURES.md) |
| Capabilities | Skills and MCP attach to the selected session’s primary repository. | [Config](../CONFIG.md) |
| Workflow board | The board is a read-only projection and never advances or schedules producer workflows. | [Features](../FEATURES.md) |

## Reading order (the atlas chapters)

1. **From one command to one dashboard** — The system begins as a small local control surface, not a new agent runtime. _(adds U, CL, D)_
2. **Durable identity and one reconciler** — The controller is the single bridge between durable records and the live dashboard. _(adds C, R)_
3. **Pi reports what is happening** — A tiny Pi extension turns agent lifecycle events into validated local heartbeat files. _(adds P, E, H)_
4. **One pure view of many states** — Pure projection keeps lifecycle, workflow, hierarchy, and terminal width understandable. _(adds RP)_
5. **Durable processes and live panels** — tmux keeps every process alive and lets Hub compose native session views instead of emulating them. _(adds T, SP)_
6. **Create and remove without losing work** — Lifecycle orchestration keeps external effects outside short state commits and treats source repositories conservatively. _(adds L, W)_
7. **Project capabilities stay project-local** — Skills and MCP are selected from the dashboard but attach only to the primary repository. _(adds S, M)_
8. **Producer meaning without producer coupling** — Optional metadata gives the dashboard richer meaning while producers keep their own vocabulary and execution. _(adds WF)_
9. **Nested agents without a second runtime** — Subagent rows are a compatibility projection over externally owned tmux-backed child work. _(adds SA)_
10. **The whole system** — All structures are visible now; choose a representative flow and inspect any packet.

## Structures

### User surfaces

#### U · Operator

**In one line.** The person who sees, organizes, opens, and steers managed Pi sessions.

**What it does.** The operator starts at `pi-hub`, scans session state, uses keyboard or mouse actions, and enters a Pi session only when direct work is needed.

**How it's built.** The user contract is documented in `docs/FEATURES.md`; Hub optimizes for one local terminal and a Pi power user.

**Steps in execution.**

1. **Launch** — Run pi-hub or pi-hub tui.
2. **Select** — Choose a session, group, lifecycle section, or workflow lane.
3. **Act** — Open, send, restart, organize, or change project capabilities.
4. **Return** — Use Ctrl+Q to return from a managed session.

#### CL · Command line

**In one line.** The small command router that opens the dashboard or invokes direct session operations.

**What it does.** It exposes `pi-hub` as the primary command and keeps `pi-agent-hub` as a compatibility alias. It routes dashboard, list, lifecycle, doctor, config, and MCP pool commands.

**How it's built.** `src/cli.ts` delegates to `src/app/*` and `src/core/*`. Public names stay centralized in `src/core/names.ts`.

**Steps in execution.**

1. **Parse** — Read the command and arguments.
2. **Route** — Call one application or core boundary.
3. **Report** — Print an id, diagnostic, or exact error.

**Questions.**

- ~~**Q-CL1** Which executable name is canonical?~~ ✓ pi-hub is primary; pi-agent-hub remains a compatibility alias (2026-08-23).

#### D · Dashboard TUI

**In one line.** The keyboard-driven control surface for all managed sessions.

**What it does.** The dashboard combines project and workflow groupings, compact rows or junction cards, dialogs, filtering, previews, themes, lifecycle actions, and four optional live session panels.

**How it's built.** `src/app/run-tui.ts` composes `SessionsController`, `SessionsView`, refresh loops, project pickers, themes, and side-pane lifecycle. Small dialog modules live under `src/tui/`.

**Steps in execution.**

1. **Start** — Load registry, theme, view state, repo history, Skills, and MCP catalog.
2. **Compose** — Wire the controller to SessionsView actions.
3. **Refresh** — Poll runtime state and request pure renders.
4. **Dispatch** — Pause refresh for mutating lifecycle operations.
5. **Stop** — Drain side-pane work and restore tmux state.

**Questions.**

- ~~**Q-D1** Does the dashboard own workflow execution?~~ ✓ No. It displays producer metadata and sends explicit user actions only (2026-08-23).

### Hub orchestration

#### RP · Render projection

**In one line.** A pure projection turns runtime sessions and view state into width-safe dashboard rows and cards.

**What it does.** It separates project lifecycle sections from workflow lanes, keeps session-tree ownership explicit, derives status and attention summaries, and gives navigation the same visible structure used by rendering.

**How it's built.** `src/tui/render-model.ts` builds `DashboardProjection` and `RenderModel`. `src/tui/layout.ts`, theme helpers, and `SessionsView` render the result without owning persistent runtime state.

**Steps in execution.**

1. **Order** — Build the scope-specific ordered session tree.
2. **Project** — Choose lifecycle sections or canonical workflow lanes.
3. **Decorate** — Add status, attention, workflow, plan, and worktree display data.
4. **Window** — Keep selected context visible within terminal height.
5. **Render** — Emit ANSI-width-safe rows, cards, details, and footer.

#### C · Sessions controller

**In one line.** The controller reconciles durable session records with one live tmux and heartbeat observation pass.

**What it does.** It loads the latest registry, observes tmux once, reads heartbeats, computes status, preserves concurrent changes with version checks, prunes only confirmed stale rows, and exposes runtime-only context for the dashboard.

**How it's built.** `src/app/controller.ts` combines `sessionPresenceSnapshot()`, `readHeartbeat()`, `computeStatus()`, `applyComputedStatus()`, tree indexes, and `updateRegistry()`.

**Steps in execution.**

1. **Load** — Read the latest registry snapshot.
2. **Observe** — List tmux sessions once and read each relevant heartbeat.
3. **Match** — Apply only observations matching id, tmux target, and updatedAt version.
4. **Reduce** — Compute liveness, persisted workflow, title, and pruning changes.
5. **Overlay** — Keep fresh context and workflow mode in memory only.
6. **Expose** — Return ordered RuntimeSession rows to the view.

**Questions.**

- ~~**Q-C1** Can a stale refresh overwrite a concurrent registry mutation?~~ ✓ No. Observation application requires matching tmux identity and updatedAt version (2026-08-23).

#### SP · Side-pane lifecycle

**In one line.** A serialized coordinator manages up to four stateless nested tmux session panels.

**What it does.** The dashboard can show managed sessions in fixed quadrant slots while it stays a sidebar. Pane tags are live tmux state, not registry state, and the layout repairs itself from current pane geometry.

**How it's built.** `src/app/side-pane-lifecycle.ts` serializes inspection, mutation, focus, handoff, chrome, and shutdown. `src/app/side-pane.ts` performs low-level stateless pane operations.

**Steps in execution.**

1. **Pause** — Stop presence polling before mutation.
2. **Inspect** — Map owned pane ttys to managed tmux sessions and repair slot tags.
3. **Mutate** — Assign, move, swap, close, focus, or hand off.
4. **Synchronize** — Update borders, titles, footers, return bindings, and sidebar width.
5. **Resume** — Restart polling or drain everything during shutdown.

**Questions.**

- ~~**Q-SP1** Are side-panel assignments persisted in registry.json?~~ ✓ No. They exist only as live @pi_hub_slot tmux pane options (2026-08-23).

#### L · Session lifecycle

**In one line.** One application boundary sequences creation, start, stop, restart, fork, delete, and worktree completion safely.

**What it does.** Lifecycle work separates external tmux, filesystem, and Git operations from short registry commits. It rolls back failed creation and preserves recoverable state after partial multi-repo worktree failures.

**How it's built.** `src/app/session-lifecycle.ts` owns orchestration. `delete-session.ts` and `worktree-session.ts` remain explicit safety entry points used by callers.

**Steps in execution.**

1. **Prepare** — Resolve current registry identity and preflight external state.
2. **External work** — Create/stop tmux, workspace, or Git resources outside the lock.
3. **Commit** — Apply a narrow update to the latest registry.
4. **Clean** — Remove heartbeat or workspace state only after commit ordering allows it.
5. **Recover** — Rollback creation or retain unfinished worktree metadata on failure.

**Questions.**

- ~~**Q-L1** Can Git or tmux work run inside the registry mutation callback?~~ ✓ No. External work completes before a short latest-state registry transformation (2026-08-23).

### Local state

#### R · Session registry

**In one line.** The durable local record of managed session identity, organization, and retained state.

**What it does.** `registry.json` records managed sessions, tmux names, primary paths, group and bucket labels, worktree metadata, cached Pi names, and retained workflow snapshots.

**How it's built.** `src/core/registry.ts` owns `loadRegistry()` and `updateRegistry()`. `src/core/atomic-json.ts` supplies lock-directory guarded read-modify-write and rename-based atomic writes.

**Steps in execution.**

1. **Lock** — Acquire registry.json.lock.
2. **Reload** — Parse the latest v1 state.
3. **Transform** — Apply one short synchronous mutation.
4. **Compare** — Skip the write when the JSON snapshot did not change.
5. **Commit** — Rename a complete temporary JSON file into place.

**Questions.**

- ~~**Q-R1** Are generic context and active workflow modes persisted?~~ ✓ No. Context and active mode are runtime-only; the base workflow snapshot may be retained (2026-08-23).

#### H · Heartbeat files

**In one line.** Per-session JSON snapshots carry live Pi state from the extension to the dashboard.

**What it does.** A heartbeat contains a required liveness envelope plus optional Pi identity, subagent metadata, active theme, generic ticket context, and producer workflow data.

**How it's built.** `src/core/heartbeat.ts` reads unknown JSON, requires the expected managed session id, validates the envelope, and parses each optional projection independently. Malformed optional data never hides valid liveness.

**Steps in execution.**

1. **Read** — Load heartbeats/&lt;session-id&gt;.json as unknown data.
2. **Verify** — Match managedSessionId, cwd, state, and timestamps.
3. **Normalize** — Parse theme, context, workflow, and optional compatibility fields.
4. **Return** — Supply one trusted Heartbeat or treat it as missing.

**Questions.**

- ~~**Q-H1** Can malformed workflow data crash or hide session liveness?~~ ✓ No. Optional metadata is omitted independently from the valid liveness envelope (2026-08-23).

#### W · Workspace and worktrees

**In one line.** Hub exposes multiple repositories through symlink workspaces and owns Git worktrees only through explicit flows.

**What it does.** A multi-repo workspace contains links to selected repositories plus `.pi` from the primary repo. When repo guidance exists, Hub also writes a generated workspace-root `AGENTS.md`. Worktree mode creates one same-named branch per repo under Hub state and requires clean-state preflight before finish or discard.

**How it's built.** `src/core/multi-repo.ts` creates owned symlink workspaces and combined instructions. `src/core/worktree.ts` validates paths, creates branches, processes additional repos before primary, and reports partial failure.

**Steps in execution.**

1. **Validate** — Canonicalize repo roots and reject duplicates or unsafe owned paths.
2. **Create** — Build worktrees when requested, then symlink them into one workspace.
3. **Guide** — Generate bounded multi-repo and worktree instructions.
4. **Run** — Start Pi from the workspace while exporting only the primary cwd contract.
5. **Finish** — Preflight, merge/remove additional repos first, then primary, or retain failed state.

**Questions.**

- ~~**Q-W1** Does a normal multi-repo session move or own source repositories?~~ ✓ No. Its workspace contains symlinks only; explicit worktree mode is the narrow Git-owning path (2026-08-23).

### Runtime substrate

#### P · Managed Pi session

**In one line.** The actual coding-agent process and durable conversation that Hub supervises.

**What it does.** Each parent session is ordinary Pi running inside a managed tmux session. Pi owns conversation history, agent turns, themes, extension hooks, Skills, and tools.

**How it's built.** `src/core/pi-process.ts` builds Pi arguments. Lifecycle code launches `pi` with the Hub extension, session id, state path, primary cwd, and optional worktree guidance.

**Steps in execution.**

1. **Launch** — Start Pi in the primary cwd or symlink workspace.
2. **Load** — Resume or fork conversation state and extensions.
3. **Work** — Run agent turns and tools.
4. **Publish** — Trigger extension lifecycle events.
5. **Persist** — Let Pi own its conversation files.

**Questions.**

- ~~**Q-P1** Does Hub delete Pi conversation files when a row is deleted?~~ ✓ No. Normal Hub deletion preserves Pi conversation/session files (2026-08-23).

#### E · Hub Pi extension

**In one line.** A small Pi extension publishes live state and bridges configured MCP tools.

**What it does.** It listens to Pi session and agent lifecycle events, tracks compaction correctly, snapshots Pi name, theme, generic context, and workflow metadata, then writes one heartbeat file per managed session.

**How it's built.** `src/extension/index.ts` registers idempotently, serializes heartbeat writes through one promise chain, writes with `writeJsonAtomic()`, polls one-time theme commands, and calls `registerMcpTools()`.

**Steps in execution.**

1. **Register** — Install event handlers once per Pi process.
2. **Observe** — Track session, turn, compaction, name, and shutdown events.
3. **Snapshot** — Read bounded theme, context, workflow, and identity data.
4. **Write** — Serialize one atomic heartbeat update.
5. **Cleanup** — Close MCP clients, write shutdown, and clear the process guard.

**Questions.**

- ~~**Q-E1** What happens if Pi loads the extension twice?~~ ✓ A process-global guard suppresses duplicate registration and clears on session shutdown (2026-08-23).

#### T · tmux substrate

**In one line.** tmux keeps dashboard and Pi processes durable and supplies native attach, switch, pane, and key behavior.

**What it does.** One stable `pi-agent-hub` tmux session hosts the dashboard. Each managed Pi process gets `pi-agent-hub-<id-prefix>`. Hub configures chrome and guarded return bindings but does not emulate a terminal multiplexer.

**How it's built.** `src/core/tmux.ts` centralizes command execution, session presence, pane geometry, capture/send, status bars, root binding save/restore, pre-sizing, and client switching.

**Steps in execution.**

1. **Create** — Start detached dashboard or managed sessions.
2. **Observe** — List sessions and inspect panes/clients.
3. **Attach** — Use native attach or switch-client.
4. **Guard** — Install Ctrl+Q, Alt+R, and sidebar focus bindings.
5. **Restore** — Put previous global bindings and window sizing back.

**Questions.**

- ~~**Q-T1** Is tmux an implementation detail Hub can replace silently?~~ ✓ No. tmux is the explicit durable process and client substrate (2026-08-23).

### Project and producer integrations

#### S · Project Skills

**In one line.** The Skill picker materializes a final project-local selection for Pi to load.

**What it does.** The operator chooses Skills from configured pool directories. Hub writes selection state once and materializes each enabled Skill under the selected session’s primary repository.

**How it's built.** `src/skills/catalog.ts` discovers configured pool entries. `src/skills/attach.ts` updates `.pi/sessions/skills.json` and creates managed symlinks or copies under `.pi/skills`.

**Steps in execution.**

1. **List** — Read the configured Skill pool.
2. **Pick** — Edit Enabled and Available columns.
3. **Apply** — Write one final project selection.
4. **Materialize** — Create or remove only managed .pi/skills entries.
5. **Reload** — Restart Pi when capability loading must refresh.

**Questions.**

- ~~**Q-S1** Which repository receives Skill state in a multi-repo session?~~ ✓ Only the primary repository receives project Skill state (2026-08-23).

#### M · MCP bridge

**In one line.** Project MCP selection becomes namespaced Pi tools through direct or explicitly pooled clients.

**What it does.** The project enables server ids from a global catalog. At Pi session start the Hub extension connects to direct servers or an opt-in Unix-socket pool and registers normalized tools with Pi.

**How it's built.** `src/mcp/config.ts` owns catalog and project state. `register-tools.ts` adapts schemas/results and tool names. `pool-daemon.ts` hosts pooled stdio clients only when `pi-hub mcp-pool` runs.

**Steps in execution.**

1. **Select** — Write enabled server ids for the primary project.
2. **Connect** — Open direct clients or route to pool.sock.
3. **Discover** — List server tools and allocate unique Pi names.
4. **Register** — Expose input schemas and execution callbacks to Pi.
5. **Close** — Dispose direct clients on session shutdown.

**Questions.**

- ~~**Q-M1** Does Hub start the MCP pool automatically?~~ ✓ No. Pooled servers require an explicit pi-hub mcp-pool process (2026-08-23).

#### WF · Workflow metadata

**In one line.** Producer-owned context and workflow entries add ticket, attention, lane, activity, and plan meaning without coupling Hub to one workflow.

**What it does.** Optional Pi extensions append bounded custom entries to the active Pi branch. The Hub extension reads the latest valid snapshot, heartbeats it, and the dashboard shows independent workflow position, runtime status, attention, and subagent counts.

**How it's built.** `src/core/session-context.ts` validates `pi-agent-hub-context`. `src/core/heartbeat.ts` adapts producer `activeStep` into persisted `activeIndex` and validates optional decorations independently.

**Steps in execution.**

1. **Publish** — A producer appends a custom context or workflow-runtime entry.
2. **Read** — The Hub extension scans the current Pi branch newest-first.
3. **Validate** — Normalize base workflow, activity, mode, plan, and context independently.
4. **Heartbeat** — Send the snapshot with live state.
5. **Project** — Choose canonical lanes and render independent display axes.

**Questions.**

- ~~**Q-WF1** Does Hub mirror a workflow step list or mode vocabulary?~~ ✓ No. The producer owns ids, order, labels, short codes, modes, and update time (2026-08-23).

#### SA · Subagent compatibility

**In one line.** Optional pi-tmux-subagents rows appear as nested compatibility data while their lifecycle remains externally owned.

**What it does.** Subagent tools may add flat registry rows with parent links and task metadata. Hub builds recursive trees, displays child liveness and attention independently, and prunes rows only when their tmux sessions are confirmed missing.

**How it's built.** `src/core/session-tree.ts` owns ancestry, depth, cycle handling, and cached descendant lookup. Controller and render projections apply scope-specific policies without taking ownership of the producer’s standalone state.

**Steps in execution.**

1. **Report** — External subagent tooling publishes a compatible registry row and heartbeat.
2. **Link** — Build ancestry and top-level owner from the current row scope.
3. **Project** — Nest only disclosed children under the parent.
4. **Summarize** — Count running descendants without promoting child status or attention.
5. **Prune** — Remove a compatibility row after explicit tmux absence.

**Questions.**

- ~~**Q-SA1** Does Hub become the subagent scheduler or result store?~~ ✓ No. pi-tmux-subagents owns standalone child state; Hub only projects compatible rows (2026-08-23).

## Flows (representative packets)

Payload shapes are what the design implies, not measured traffic.

### Dashboard refresh

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | D → C | refresh tick | `{"selectedId":"7f3…","filter":""}` |
| 2 | C → T | one tmux snapshot | `{"format":"#{session_name}"}` |
| 3 | T → C | present sessions | `{"names":["pi-agent-hub-7f3…"]}` |
| 4 | C → H | read heartbeat | `{"sessionId":"7f3…"}` |
| 5 | H → C | validated live state | `{"state":"waiting","workflow":{"activeIndex":1}}` |
| 6 | C → R | version-checked update | `{"id":"7f3…","status":"waiting"}` |
| 7 | R → C | committed registry | `{"version":1,"changed":true}` |
| 8 | C → RP | runtime sessions | `{"count":12,"selectedId":"7f3…"}` |
| 9 | RP → D | render model | `{"grouping":"stage","density":"all-cards"}` |

### Open and return

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → D | Enter | `{"action":"open","sessionId":"7f3…"}` |
| 2 | D → SP | handoff request | `{"tmuxSession":"pi-agent-hub-7f3…"}` |
| 3 | SP → T | switch-client + guarded keys | `{"returnKey":"C-q","renameKey":"M-r"}` |
| 4 | T → P | interactive client | `{"geometry":"latest"}` |
| 5 | P → T | Ctrl+Q | `{"target":"pi-agent-hub"}` |
| 6 | T → D | return to dashboard | `{"restoredBindings":true}` |

### Create a worktree session

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → D | new-session form | `{"cwd":"/repo","branch":"feature/x","worktree":true}` |
| 2 | D → L | create intent | `{"repos":2,"group":"default"}` |
| 3 | L → W | create owned worktrees | `{"branch":"feature/x","repos":2}` |
| 4 | W → L | workspace mapping | `{"primary":"/state/worktrees/repo/…","links":2}` |
| 5 | L → R | append session record | `{"status":"starting","worktreeOwnedByHub":true}` |
| 6 | L → T | new managed tmux session | `{"env":["PI_AGENT_HUB_SESSION_ID","PI_AGENT_HUB_PRIMARY_CWD"]}` |
| 7 | T → P | launch pi + extension | `{"cwd":"/state/workspaces/7f3…"}` |
| 8 | P → E | session_start | `{"state":"waiting"}` |
| 9 | E → H | atomic heartbeat | `{"managedSessionId":"7f3…","state":"waiting"}` |

### Workflow metadata to board

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | WF → P | custom branch entry | `{"customType":"workflow-runtime","activeStep":"execute"}` |
| 2 | P → E | agent lifecycle event | `{"event":"agent_settled"}` |
| 3 | E → H | heartbeat snapshot | `{"activeIndex":1,"ticketId":"hub-042"}` |
| 4 | H → C | validated workflow | `{"steps":["plan","execute","review"],"activeIndex":1}` |
| 5 | C → RP | runtime workflow overlay | `{"mode":"focus","persisted":false}` |
| 6 | RP → D | lane and card | `{"lane":"EXECUTE","marker":"◉EX","attention":"?"}` |

### Apply project capabilities

| # | From → To | Packet | Representative payload |
|---|---|---|---|
| 1 | U → D | picker selection | `{"skills":["system-atlas"],"mcp":["filesystem"]}` |
| 2 | D → S | write Skill selection | `{"project":"/primary","enabled":["system-atlas"]}` |
| 3 | D → M | write MCP selection | `{"project":"/primary","enabledServers":["filesystem"]}` |
| 4 | D → L | restart session | `{"reason":"reload capabilities"}` |
| 5 | L → P | new Pi process | `{"cwd":"/primary"}` |
| 6 | P → S | load materialized Skills | `{"path":".pi/skills"}` |
| 7 | P → E | session_start | `{"loadExtensions":true}` |
| 8 | E → M | register enabled MCP tools | `{"serverId":"filesystem"}` |

## Questions — index

Reference by ID. ✓ resolved (with date) · otherwise open.

- ~~**Q-CL1**~~ (CL) ✓ pi-hub is primary; pi-agent-hub remains a compatibility alias (2026-08-23).
- ~~**Q-D1**~~ (D) ✓ No. It displays producer metadata and sends explicit user actions only (2026-08-23).
- ~~**Q-C1**~~ (C) ✓ No. Observation application requires matching tmux identity and updatedAt version (2026-08-23).
- ~~**Q-SP1**~~ (SP) ✓ No. They exist only as live @pi_hub_slot tmux pane options (2026-08-23).
- ~~**Q-L1**~~ (L) ✓ No. External work completes before a short latest-state registry transformation (2026-08-23).
- ~~**Q-R1**~~ (R) ✓ No. Context and active mode are runtime-only; the base workflow snapshot may be retained (2026-08-23).
- ~~**Q-H1**~~ (H) ✓ No. Optional metadata is omitted independently from the valid liveness envelope (2026-08-23).
- ~~**Q-W1**~~ (W) ✓ No. Its workspace contains symlinks only; explicit worktree mode is the narrow Git-owning path (2026-08-23).
- ~~**Q-P1**~~ (P) ✓ No. Normal Hub deletion preserves Pi conversation/session files (2026-08-23).
- ~~**Q-E1**~~ (E) ✓ A process-global guard suppresses duplicate registration and clears on session shutdown (2026-08-23).
- ~~**Q-T1**~~ (T) ✓ No. tmux is the explicit durable process and client substrate (2026-08-23).
- ~~**Q-S1**~~ (S) ✓ Only the primary repository receives project Skill state (2026-08-23).
- ~~**Q-M1**~~ (M) ✓ No. Pooled servers require an explicit pi-hub mcp-pool process (2026-08-23).
- ~~**Q-WF1**~~ (WF) ✓ No. The producer owns ids, order, labels, short codes, modes, and update time (2026-08-23).
- ~~**Q-SA1**~~ (SA) ✓ No. pi-tmux-subagents owns standalone child state; Hub only projects compatible rows (2026-08-23).

## What the platform gives vs what we own

**Platform gives:** Pi supplies the coding-agent runtime, conversation history, extension hooks, themes, Skills, and tool registration. tmux supplies durable processes, clients, panes, key bindings, and attach/switch semantics. @earendil-works/pi-tui supplies the terminal UI runtime.

**We own:** Hub owns the CLI and dashboard, registry and heartbeat projection, safe lifecycle orchestration, tmux chrome and return behavior, symlink workspaces, explicit Hub-owned worktree flows, project capability pickers, and the small heartbeat/MCP bridge extension.

## Planned filesystem

```
src/
  cli.ts                    command routing
  app/                      dashboard controller and orchestration
  core/                     registry, heartbeat, tmux, state, workspace, Git
  extension/                Pi heartbeat and MCP bridge
  tui/                      pure projections, rendering, dialogs, input
  skills/                   project Skill selection and materialization
  mcp/                      MCP config, clients, pool, Pi tool adapter

test/                       Node test-runner contracts
docs/system/atlas/data.mjs  atlas source of truth
```

## How this file is maintained

Generated from `docs/system/atlas/data.mjs` by `node docs/system/atlas/build.mjs`, which also builds the interactive atlas (`atlas.html`, published at ./atlas.html). Edit the data file, rebuild, republish — never edit this file by hand.
