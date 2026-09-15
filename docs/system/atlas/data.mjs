// Single source of truth for the pi-agent-hub architecture atlas.
// Build: node docs/system/atlas/build.mjs

export const META = {
  title: 'pi-agent-hub',
  artifactUrl: './atlas.html',
  sourcePath: 'docs/system/atlas/data.mjs',
  buildCmd: 'node docs/system/atlas/build.mjs',
  stats: [
    { k: 'System', v: 'Pi-native session hub' },
    { k: 'Runtime', v: 'Pi + tmux' },
  ],
  intro: `_**This file is the generated text twin of the interactive architecture atlas.** Both views come from one source file._`,
  onePara: `pi-agent-hub is a local terminal control center for long-running Pi coding-agent sessions. The CLI opens a keyboard-driven dashboard, tmux keeps each managed Pi process alive, a small Pi extension reports live state through heartbeat files, and the controller projects registry plus runtime data into a pure render model. Hub can organize sessions, open live side panes, create explicit multi-repo workspaces or Hub-owned worktrees, and attach project Skills and MCP tools without becoming an agent runtime, project manager, or general Git manager.`,
  costModel: [],
  deepDive: '',
  platformGives: 'Pi supplies the coding-agent runtime, conversation history, extension hooks, themes, Skills, and tool registration. tmux supplies durable processes, clients, panes, key bindings, and attach/switch semantics. @earendil-works/pi-tui supplies the terminal UI runtime.',
  weOwn: 'Hub owns the CLI and dashboard, registry and heartbeat projection, safe lifecycle orchestration, tmux chrome and return behavior, symlink workspaces, explicit Hub-owned worktree flows, project capability pickers, and the small heartbeat/MCP bridge extension.',
  filesystem: `src/
  cli.ts                    command routing
  app/                      dashboard controller and orchestration
  core/                     registry, heartbeat, tmux, state, workspace, Git
  extension/                Pi heartbeat and MCP bridge
  tui/                      pure projections, rendering, dialogs, input
  skills/                   project Skill selection and materialization
  mcp/                      MCP config, clients, pool, Pi tool adapter

test/                       Node test-runner contracts
docs/system/atlas/data.mjs  atlas source of truth`,
};

export const DECISIONS = [
  { axis: 'Agent runtime', decision: 'Pi remains the only agent runtime; Hub supervises it instead of replacing it.', adr: '[Context](../../CONTEXT.md)' },
  { axis: 'Process substrate', decision: 'tmux owns durable processes, attach/switch, panes, and return keys.', adr: '[Structure](../STRUCTURE.md)' },
  { axis: 'State', decision: 'Hub state stays under PI_AGENT_HUB_DIR or the Pi state directory and uses atomic JSON stores.', adr: '[Config](../CONFIG.md)' },
  { axis: 'Rendering', decision: 'Dashboard structure is projected through pure, testable render-model functions.', adr: '[Structure](../STRUCTURE.md)' },
  { axis: 'Metadata', decision: 'Context and workflow are producer-owned soft contracts; Hub validates and projects them.', adr: '[Config](../CONFIG.md)' },
  { axis: 'Repository ownership', decision: 'Multi-repo workspaces expose repos through symlinks and may add generated instructions; Git ownership is limited to explicit Hub worktrees.', adr: '[Features](../FEATURES.md)' },
  { axis: 'Capabilities', decision: 'Skills and MCP attach to the selected session’s primary repository.', adr: '[Config](../CONFIG.md)' },
  { axis: 'Workflow board', decision: 'The board is a read-only projection and never advances or schedules producer workflows.', adr: '[Features](../FEATURES.md)' },
];

export const GROUPS = [
  { id: 'surface', title: 'User surfaces' },
  { id: 'orchestration', title: 'Hub orchestration' },
  { id: 'state', title: 'Local state' },
  { id: 'runtime', title: 'Runtime substrate' },
  { id: 'integration', title: 'Project and producer integrations' },
];

export const NODES = [
  {
    id: 'U', code: 'U', name: 'Operator', short: 'OPERATOR', group: 'surface',
    gx: 0.5, gy: 8.5, w: 2, d: 2, h: 42, kind: 'screen',
    one: 'The person who sees, organizes, opens, and steers managed Pi sessions.',
    what: 'The operator starts at <code>pi-hub</code>, scans session state, uses keyboard or mouse actions, and enters a Pi session only when direct work is needed.',
    how: 'The user contract is documented in <code>docs/FEATURES.md</code>; Hub optimizes for one local terminal and a Pi power user.',
    steps: [['Launch', 'Run pi-hub or pi-hub tui.'], ['Select', 'Choose a session, group, lifecycle section, or workflow lane.'], ['Act', 'Open, send, restart, organize, or change project capabilities.'], ['Return', 'Use Ctrl+Q to return from a managed session.']],
    cond: [],
  },
  {
    id: 'CL', code: 'CL', name: 'Command line', short: 'CLI', group: 'surface',
    gx: 2.8, gy: 7.2, w: 2, d: 2, h: 36, kind: 'gate',
    one: 'The small command router that opens the dashboard or invokes direct session operations.',
    what: 'It exposes <code>pi-hub</code> as the primary command and keeps <code>pi-agent-hub</code> as a compatibility alias. It routes dashboard, list, lifecycle, doctor, config, and MCP pool commands.',
    how: '<code>src/cli.ts</code> delegates to <code>src/app/*</code> and <code>src/core/*</code>. Public names stay centralized in <code>src/core/names.ts</code>.',
    steps: [['Parse', 'Read the command and arguments.'], ['Route', 'Call one application or core boundary.'], ['Report', 'Print an id, diagnostic, or exact error.']],
    cond: [{ q: 'Which executable name is canonical?', r: 'pi-hub is primary; pi-agent-hub remains a compatibility alias (2026-08-23).' }],
  },
  {
    id: 'D', code: 'D', name: 'Dashboard TUI', short: 'DASHBOARD', group: 'surface',
    gx: 4.8, gy: 5.7, w: 3, d: 3, h: 46, kind: 'screen',
    one: 'The keyboard-driven control surface for all managed sessions.',
    what: 'The dashboard combines project and workflow groupings, compact rows or junction cards, dialogs, filtering, previews, themes, lifecycle actions, and four optional live session panels.',
    how: '<code>src/app/run-tui.ts</code> composes <code>SessionsController</code>, <code>SessionsView</code>, refresh loops, project pickers, themes, and side-pane lifecycle. Small dialog modules live under <code>src/tui/</code>.',
    steps: [['Start', 'Load registry, theme, view state, repo history, Skills, and MCP catalog.'], ['Compose', 'Wire the controller to SessionsView actions.'], ['Refresh', 'Poll runtime state and request pure renders.'], ['Dispatch', 'Pause refresh for mutating lifecycle operations.'], ['Stop', 'Drain side-pane work and restore tmux state.']],
    cond: [{ q: 'Does the dashboard own workflow execution?', r: 'No. It displays producer metadata and sends explicit user actions only (2026-08-23).' }],
  },
  {
    id: 'RP', code: 'RP', name: 'Render projection', short: 'PROJECTION', group: 'orchestration',
    gx: 7.1, gy: 5.6, w: 3, d: 3, h: 24, kind: 'slab',
    one: 'A pure projection turns runtime sessions and view state into width-safe dashboard rows and cards.',
    what: 'It separates project lifecycle sections from workflow lanes, keeps session-tree ownership explicit, derives status and attention summaries, and gives navigation the same visible structure used by rendering.',
    how: '<code>src/tui/render-model.ts</code> builds <code>DashboardProjection</code> and <code>RenderModel</code>. <code>src/tui/layout.ts</code>, theme helpers, and <code>SessionsView</code> render the result without owning persistent runtime state.',
    steps: [['Order', 'Build the scope-specific ordered session tree.'], ['Project', 'Choose lifecycle sections or canonical workflow lanes.'], ['Decorate', 'Add status, attention, workflow, plan, and worktree display data.'], ['Window', 'Keep selected context visible within terminal height.'], ['Render', 'Emit ANSI-width-safe rows, cards, details, and footer.']],
    cond: [],
  },
  {
    id: 'C', code: 'C', name: 'Sessions controller', short: 'CONTROLLER', group: 'orchestration',
    gx: 9.5, gy: 5.0, w: 3, d: 3, h: 66, kind: 'tall',
    one: 'The controller reconciles durable session records with one live tmux and heartbeat observation pass.',
    what: 'It loads the latest registry, observes tmux once, reads heartbeats, computes status, preserves concurrent changes with version checks, prunes only confirmed stale rows, and exposes runtime-only context for the dashboard.',
    how: '<code>src/app/controller.ts</code> combines <code>sessionPresenceSnapshot()</code>, <code>readHeartbeat()</code>, <code>computeStatus()</code>, <code>applyComputedStatus()</code>, tree indexes, and <code>updateRegistry()</code>.',
    steps: [['Load', 'Read the latest registry snapshot.'], ['Observe', 'List tmux sessions once and read each relevant heartbeat.'], ['Match', 'Apply only observations matching id, tmux target, and updatedAt version.'], ['Reduce', 'Compute liveness, persisted workflow, title, and pruning changes.'], ['Overlay', 'Keep fresh context and workflow mode in memory only.'], ['Expose', 'Return ordered RuntimeSession rows to the view.']],
    cond: [{ q: 'Can a stale refresh overwrite a concurrent registry mutation?', r: 'No. Observation application requires matching tmux identity and updatedAt version (2026-08-23).' }],
  },
  {
    id: 'R', code: 'R', name: 'Session registry', short: 'REGISTRY', group: 'state',
    gx: 12.0, gy: 6.2, w: 3, d: 3, h: 30, kind: 'store',
    one: 'The durable local record of managed session identity, organization, and retained state.',
    what: '<code>registry.json</code> records managed sessions, tmux names, primary paths, group and bucket labels, worktree metadata, cached Pi names, and retained workflow snapshots.',
    how: '<code>src/core/registry.ts</code> owns <code>loadRegistry()</code> and <code>updateRegistry()</code>. <code>src/core/atomic-json.ts</code> supplies lock-directory guarded read-modify-write and rename-based atomic writes.',
    steps: [['Lock', 'Acquire registry.json.lock.'], ['Reload', 'Parse the latest v1 state.'], ['Transform', 'Apply one short synchronous mutation.'], ['Compare', 'Skip the write when the JSON snapshot did not change.'], ['Commit', 'Rename a complete temporary JSON file into place.']],
    cond: [{ q: 'Are generic context and active workflow modes persisted?', r: 'No. Context and active mode are runtime-only; the base workflow snapshot may be retained (2026-08-23).' }],
  },
  {
    id: 'P', code: 'P', name: 'Managed Pi session', short: 'PI SESSION', group: 'runtime',
    gx: 10.8, gy: 1.0, w: 3, d: 3, h: 62, kind: 'tall',
    one: 'The actual coding-agent process and durable conversation that Hub supervises.',
    what: 'Each parent session is ordinary Pi running inside a managed tmux session. Pi owns conversation history, agent turns, themes, extension hooks, Skills, and tools.',
    how: '<code>src/core/pi-process.ts</code> builds Pi arguments. Lifecycle code launches <code>pi</code> with the Hub extension, session id, state path, primary cwd, and optional worktree guidance.',
    steps: [['Launch', 'Start Pi in the primary cwd or symlink workspace.'], ['Load', 'Resume or fork conversation state and extensions.'], ['Work', 'Run agent turns and tools.'], ['Publish', 'Trigger extension lifecycle events.'], ['Persist', 'Let Pi own its conversation files.']],
    cond: [{ q: 'Does Hub delete Pi conversation files when a row is deleted?', r: 'No. Normal Hub deletion preserves Pi conversation/session files (2026-08-23).' }],
  },
  {
    id: 'E', code: 'E', name: 'Hub Pi extension', short: 'HUB EXTENSION', group: 'runtime',
    gx: 8.1, gy: 1.2, w: 2.5, d: 2.5, h: 42, kind: 'job',
    one: 'A small Pi extension publishes live state and bridges configured MCP tools.',
    what: 'It listens to Pi session and agent lifecycle events, tracks compaction correctly, snapshots Pi name, theme, generic context, and workflow metadata, then writes one heartbeat file per managed session.',
    how: '<code>src/extension/index.ts</code> registers idempotently, serializes heartbeat writes through one promise chain, writes with <code>writeJsonAtomic()</code>, polls one-time theme commands, and calls <code>registerMcpTools()</code>.',
    steps: [['Register', 'Install event handlers once per Pi process.'], ['Observe', 'Track session, turn, compaction, name, and shutdown events.'], ['Snapshot', 'Read bounded theme, context, workflow, and identity data.'], ['Write', 'Serialize one atomic heartbeat update.'], ['Cleanup', 'Close MCP clients, write shutdown, and clear the process guard.']],
    cond: [{ q: 'What happens if Pi loads the extension twice?', r: 'A process-global guard suppresses duplicate registration and clears on session shutdown (2026-08-23).' }],
  },
  {
    id: 'H', code: 'H', name: 'Heartbeat files', short: 'HEARTBEATS', group: 'state',
    gx: 10.2, gy: 8.2, w: 3, d: 3, h: 28, kind: 'store',
    one: 'Per-session JSON snapshots carry live Pi state from the extension to the dashboard.',
    what: 'A heartbeat contains a required liveness envelope plus optional Pi identity, subagent metadata, active theme, generic ticket context, and producer workflow data.',
    how: '<code>src/core/heartbeat.ts</code> reads unknown JSON, requires the expected managed session id, validates the envelope, and parses each optional projection independently. Malformed optional data never hides valid liveness.',
    steps: [['Read', 'Load heartbeats/&lt;session-id&gt;.json as unknown data.'], ['Verify', 'Match managedSessionId, cwd, state, and timestamps.'], ['Normalize', 'Parse theme, context, workflow, and optional compatibility fields.'], ['Return', 'Supply one trusted Heartbeat or treat it as missing.']],
    cond: [{ q: 'Can malformed workflow data crash or hide session liveness?', r: 'No. Optional metadata is omitted independently from the valid liveness envelope (2026-08-23).' }],
  },
  {
    id: 'T', code: 'T', name: 'tmux substrate', short: 'TMUX', group: 'runtime',
    gx: 5.8, gy: 1.0, w: 3.4, d: 3.4, h: 22, kind: 'slab',
    one: 'tmux keeps dashboard and Pi processes durable and supplies native attach, switch, pane, and key behavior.',
    what: 'One stable <code>pi-agent-hub</code> tmux session hosts the dashboard. Each managed Pi process gets <code>pi-agent-hub-&lt;id-prefix&gt;</code>. Hub configures chrome and guarded return bindings but does not emulate a terminal multiplexer.',
    how: '<code>src/core/tmux.ts</code> centralizes command execution, session presence, pane geometry, capture/send, status bars, root binding save/restore, pre-sizing, and client switching.',
    steps: [['Create', 'Start detached dashboard or managed sessions.'], ['Observe', 'List sessions and inspect panes/clients.'], ['Attach', 'Use native attach or switch-client.'], ['Guard', 'Install Ctrl+Q, Alt+R, and sidebar focus bindings.'], ['Restore', 'Put previous global bindings and window sizing back.']],
    cond: [{ q: 'Is tmux an implementation detail Hub can replace silently?', r: 'No. tmux is the explicit durable process and client substrate (2026-08-23).' }],
  },
  {
    id: 'SP', code: 'SP', name: 'Side-pane lifecycle', short: 'SIDE PANES', group: 'orchestration',
    gx: 3.4, gy: 2.5, w: 2.7, d: 2.7, h: 38, kind: 'screen',
    one: 'A serialized coordinator manages up to four stateless nested tmux session panels.',
    what: 'The dashboard can show managed sessions in fixed quadrant slots while it stays a sidebar. Pane tags are live tmux state, not registry state, and the layout repairs itself from current pane geometry.',
    how: '<code>src/app/side-pane-lifecycle.ts</code> serializes inspection, mutation, focus, handoff, chrome, and shutdown. <code>src/app/side-pane.ts</code> performs low-level stateless pane operations.',
    steps: [['Pause', 'Stop presence polling before mutation.'], ['Inspect', 'Map owned pane ttys to managed tmux sessions and repair slot tags.'], ['Mutate', 'Assign, move, swap, close, focus, or hand off.'], ['Synchronize', 'Update borders, titles, footers, return bindings, and sidebar width.'], ['Resume', 'Restart polling or drain everything during shutdown.']],
    cond: [{ q: 'Are side-panel assignments persisted in registry.json?', r: 'No. They exist only as live @pi_hub_slot tmux pane options (2026-08-23).' }],
  },
  {
    id: 'L', code: 'L', name: 'Session lifecycle', short: 'LIFECYCLE', group: 'orchestration',
    gx: 12.3, gy: 3.3, w: 2.8, d: 2.8, h: 48, kind: 'gate',
    one: 'One application boundary sequences creation, start, stop, restart, fork, delete, and worktree completion safely.',
    what: 'Lifecycle work separates external tmux, filesystem, and Git operations from short registry commits. It rolls back failed creation and preserves recoverable state after partial multi-repo worktree failures.',
    how: '<code>src/app/session-lifecycle.ts</code> owns orchestration. <code>delete-session.ts</code> and <code>worktree-session.ts</code> remain explicit safety entry points used by callers.',
    steps: [['Prepare', 'Resolve current registry identity and preflight external state.'], ['External work', 'Create/stop tmux, workspace, or Git resources outside the lock.'], ['Commit', 'Apply a narrow update to the latest registry.'], ['Clean', 'Remove heartbeat or workspace state only after commit ordering allows it.'], ['Recover', 'Rollback creation or retain unfinished worktree metadata on failure.']],
    cond: [{ q: 'Can Git or tmux work run inside the registry mutation callback?', r: 'No. External work completes before a short latest-state registry transformation (2026-08-23).' }],
  },
  {
    id: 'W', code: 'W', name: 'Workspace and worktrees', short: 'WORKSPACES', group: 'state',
    gx: 14.7, gy: 4.8, w: 3, d: 3, h: 28, kind: 'store',
    one: 'Hub exposes multiple repositories through symlink workspaces and owns Git worktrees only through explicit flows.',
    what: 'A multi-repo workspace contains links to selected repositories plus <code>.pi</code> from the primary repo. When repo guidance exists, Hub also writes a generated workspace-root <code>AGENTS.md</code>. Worktree mode creates one same-named branch per repo under Hub state and requires clean-state preflight before finish or discard.',
    how: '<code>src/core/multi-repo.ts</code> creates owned symlink workspaces and combined instructions. <code>src/core/worktree.ts</code> validates paths, creates branches, processes additional repos before primary, and reports partial failure.',
    steps: [['Validate', 'Canonicalize repo roots and reject duplicates or unsafe owned paths.'], ['Create', 'Build worktrees when requested, then symlink them into one workspace.'], ['Guide', 'Generate bounded multi-repo and worktree instructions.'], ['Run', 'Start Pi from the workspace while exporting only the primary cwd contract.'], ['Finish', 'Preflight, merge/remove additional repos first, then primary, or retain failed state.']],
    cond: [{ q: 'Does a normal multi-repo session move or own source repositories?', r: 'No. Its workspace contains symlinks only; explicit worktree mode is the narrow Git-owning path (2026-08-23).' }],
  },
  {
    id: 'S', code: 'S', name: 'Project Skills', short: 'SKILLS', group: 'integration',
    gx: 3.0, gy: 9.6, w: 2.6, d: 2.6, h: 26, kind: 'cards',
    one: 'The Skill picker materializes a final project-local selection for Pi to load.',
    what: 'The operator chooses Skills from configured pool directories. Hub writes selection state once and materializes each enabled Skill under the selected session’s primary repository.',
    how: '<code>src/skills/catalog.ts</code> discovers configured pool entries. <code>src/skills/attach.ts</code> updates <code>.pi/sessions/skills.json</code> and creates managed symlinks or copies under <code>.pi/skills</code>.',
    steps: [['List', 'Read the configured Skill pool.'], ['Pick', 'Edit Enabled and Available columns.'], ['Apply', 'Write one final project selection.'], ['Materialize', 'Create or remove only managed .pi/skills entries.'], ['Reload', 'Restart Pi when capability loading must refresh.']],
    cond: [{ q: 'Which repository receives Skill state in a multi-repo session?', r: 'Only the primary repository receives project Skill state (2026-08-23).' }],
  },
  {
    id: 'M', code: 'M', name: 'MCP bridge', short: 'MCP BRIDGE', group: 'integration',
    gx: 6.0, gy: 9.2, w: 2.7, d: 2.7, h: 27, kind: 'cards',
    one: 'Project MCP selection becomes namespaced Pi tools through direct or explicitly pooled clients.',
    what: 'The project enables server ids from a global catalog. At Pi session start the Hub extension connects to direct servers or an opt-in Unix-socket pool and registers normalized tools with Pi.',
    how: '<code>src/mcp/config.ts</code> owns catalog and project state. <code>register-tools.ts</code> adapts schemas/results and tool names. <code>pool-daemon.ts</code> hosts pooled stdio clients only when <code>pi-hub mcp-pool</code> runs.',
    steps: [['Select', 'Write enabled server ids for the primary project.'], ['Connect', 'Open direct clients or route to pool.sock.'], ['Discover', 'List server tools and allocate unique Pi names.'], ['Register', 'Expose input schemas and execution callbacks to Pi.'], ['Close', 'Dispose direct clients on session shutdown.']],
    cond: [{ q: 'Does Hub start the MCP pool automatically?', r: 'No. Pooled servers require an explicit pi-hub mcp-pool process (2026-08-23).' }],
  },
  {
    id: 'WF', code: 'WF', name: 'Workflow metadata', short: 'WORKFLOW META', group: 'integration',
    gx: 13.5, gy: -0.6, w: 2.8, d: 2.8, h: 34, kind: 'slab',
    one: 'Producer-owned context and workflow entries add ticket, attention, lane, activity, and plan meaning without coupling Hub to one workflow.',
    what: 'Optional Pi extensions append bounded custom entries to the active Pi branch. The Hub extension reads the latest valid snapshot, heartbeats it, and the dashboard shows independent workflow position, runtime status, attention, and subagent counts.',
    how: '<code>src/core/session-context.ts</code> validates <code>pi-agent-hub-context</code>. <code>src/core/heartbeat.ts</code> adapts producer <code>activeStep</code> into persisted <code>activeIndex</code> and validates optional decorations independently.',
    steps: [['Publish', 'A producer appends a custom context or workflow-runtime entry.'], ['Read', 'The Hub extension scans the current Pi branch newest-first.'], ['Validate', 'Normalize base workflow, activity, mode, plan, and context independently.'], ['Heartbeat', 'Send the snapshot with live state.'], ['Project', 'Choose canonical lanes and render independent display axes.']],
    cond: [{ q: 'Does Hub mirror a workflow step list or mode vocabulary?', r: 'No. The producer owns ids, order, labels, short codes, modes, and update time (2026-08-23).' }],
  },
  {
    id: 'SA', code: 'SA', name: 'Subagent compatibility', short: 'SUBAGENTS', group: 'integration',
    gx: 16.0, gy: 1.3, w: 2.6, d: 2.6, h: 33, kind: 'box',
    one: 'Optional pi-tmux-subagents rows appear as nested compatibility data while their lifecycle remains externally owned.',
    what: 'Subagent tools may add flat registry rows with parent links and task metadata. Hub builds recursive trees, displays child liveness and attention independently, and prunes rows only when their tmux sessions are confirmed missing.',
    how: '<code>src/core/session-tree.ts</code> owns ancestry, depth, cycle handling, and cached descendant lookup. Controller and render projections apply scope-specific policies without taking ownership of the producer’s standalone state.',
    steps: [['Report', 'External subagent tooling publishes a compatible registry row and heartbeat.'], ['Link', 'Build ancestry and top-level owner from the current row scope.'], ['Project', 'Nest only disclosed children under the parent.'], ['Summarize', 'Count running descendants without promoting child status or attention.'], ['Prune', 'Remove a compatibility row after explicit tmux absence.']],
    cond: [{ q: 'Does Hub become the subagent scheduler or result store?', r: 'No. pi-tmux-subagents owns standalone child state; Hub only projects compatible rows (2026-08-23).' }],
  },
];

export const FLOWS = [
  {
    id: 'refresh', name: 'Dashboard refresh', hops: [
      ['D', 'C', 'refresh tick', { selectedId: '7f3…', filter: '' }, 'yx'],
      ['C', 'T', 'one tmux snapshot', { format: '#{session_name}' }, 'xy'],
      ['T', 'C', 'present sessions', { names: ['pi-agent-hub-7f3…'] }, 'yx'],
      ['C', 'H', 'read heartbeat', { sessionId: '7f3…' }, 'xy'],
      ['H', 'C', 'validated live state', { state: 'waiting', workflow: { activeIndex: 1 } }, 'yx'],
      ['C', 'R', 'version-checked update', { id: '7f3…', status: 'waiting' }, 'xy'],
      ['R', 'C', 'committed registry', { version: 1, changed: true }, 'yx'],
      ['C', 'RP', 'runtime sessions', { count: 12, selectedId: '7f3…' }, 'xy'],
      ['RP', 'D', 'render model', { grouping: 'stage', density: 'all-cards' }, 'yx'],
    ],
  },
  {
    id: 'open', name: 'Open and return', hops: [
      ['U', 'D', 'Enter', { action: 'open', sessionId: '7f3…' }, 'yx'],
      ['D', 'SP', 'handoff request', { tmuxSession: 'pi-agent-hub-7f3…' }, 'xy'],
      ['SP', 'T', 'switch-client + guarded keys', { returnKey: 'C-q', renameKey: 'M-r' }, 'yx'],
      ['T', 'P', 'interactive client', { geometry: 'latest' }, 'xy'],
      ['P', 'T', 'Ctrl+Q', { target: 'pi-agent-hub' }, 'yx'],
      ['T', 'D', 'return to dashboard', { restoredBindings: true }, 'xy'],
    ],
  },
  {
    id: 'create', name: 'Create a worktree session', hops: [
      ['U', 'D', 'new-session form', { cwd: '/repo', branch: 'feature/x', worktree: true }, 'yx'],
      ['D', 'L', 'create intent', { repos: 2, group: 'default' }, 'xy'],
      ['L', 'W', 'create owned worktrees', { branch: 'feature/x', repos: 2 }, 'yx'],
      ['W', 'L', 'workspace mapping', { primary: '/state/worktrees/repo/…', links: 2 }, 'xy'],
      ['L', 'R', 'append session record', { status: 'starting', worktreeOwnedByHub: true }, 'yx'],
      ['L', 'T', 'new managed tmux session', { env: ['PI_AGENT_HUB_SESSION_ID', 'PI_AGENT_HUB_PRIMARY_CWD'] }, 'xy'],
      ['T', 'P', 'launch pi + extension', { cwd: '/state/workspaces/7f3…' }, 'yx'],
      ['P', 'E', 'session_start', { state: 'waiting' }, 'xy'],
      ['E', 'H', 'atomic heartbeat', { managedSessionId: '7f3…', state: 'waiting' }, 'yx'],
    ],
  },
  {
    id: 'metadata', name: 'Workflow metadata to board', hops: [
      ['WF', 'P', 'custom branch entry', { customType: 'workflow-runtime', activeStep: 'execute' }, 'yx'],
      ['P', 'E', 'agent lifecycle event', { event: 'agent_settled' }, 'xy'],
      ['E', 'H', 'heartbeat snapshot', { activeIndex: 1, ticketId: 'hub-042' }, 'yx'],
      ['H', 'C', 'validated workflow', { steps: ['plan', 'execute', 'review'], activeIndex: 1 }, 'xy'],
      ['C', 'RP', 'runtime workflow overlay', { mode: 'focus', persisted: false }, 'yx'],
      ['RP', 'D', 'lane and card', { lane: 'EXECUTE', marker: '◉EX', attention: '?' }, 'xy'],
    ],
  },
  {
    id: 'capabilities', name: 'Apply project capabilities', hops: [
      ['U', 'D', 'picker selection', { skills: ['system-atlas'], mcp: ['filesystem'] }, 'yx'],
      ['D', 'S', 'write Skill selection', { project: '/primary', enabled: ['system-atlas'] }, 'xy'],
      ['D', 'M', 'write MCP selection', { project: '/primary', enabledServers: ['filesystem'] }, 'yx'],
      ['D', 'L', 'restart session', { reason: 'reload capabilities' }, 'xy'],
      ['L', 'P', 'new Pi process', { cwd: '/primary' }, 'yx'],
      ['P', 'S', 'load materialized Skills', { path: '.pi/skills' }, 'xy'],
      ['P', 'E', 'session_start', { loadExtensions: true }, 'yx'],
      ['E', 'M', 'register enabled MCP tools', { serverId: 'filesystem' }, 'xy'],
    ],
  },
];

export const CH = [
  {
    id: 'entry', title: 'From one command to one dashboard', reveal: ['U', 'CL', 'D'],
    lede: 'The system begins as a small local control surface, not a new agent runtime.',
    story: '<p>The operator runs <code>pi-hub</code>; the CLI opens the dashboard; the dashboard shows and steers managed Pi sessions. <mark>Hub is the control surface, not the agent.</mark></p>',
    flow: [['U', 'CL', 'pi-hub', { command: 'dashboard' }], ['CL', 'D', 'open dashboard', { tmuxSession: 'pi-agent-hub' }], ['D', 'U', 'session overview', { running: 3, waiting: 2 }]],
  },
  {
    id: 'state', title: 'Durable identity and one reconciler', reveal: ['C', 'R'],
    lede: 'The controller is the single bridge between durable records and the live dashboard.',
    story: '<p>The registry says which sessions Hub manages. The controller reads the latest state, applies bounded changes, and gives the dashboard a runtime view. <mark>Every Hub-owned registry mutation goes through one atomic update path.</mark></p>',
    flow: [['D', 'C', 'refresh', { now: 1787443200000 }], ['C', 'R', 'load/update registry', { path: 'registry.json' }], ['R', 'C', 'latest sessions', { version: 1, sessions: 12 }], ['C', 'D', 'runtime snapshot', { selectedId: '7f3…' }]],
  },
  {
    id: 'live', title: 'Pi reports what is happening', reveal: ['P', 'E', 'H'],
    lede: 'A tiny Pi extension turns agent lifecycle events into validated local heartbeat files.',
    story: '<p>Pi remains responsible for the conversation and agent turn. The extension observes that process and writes a heartbeat; the controller accepts only a valid envelope. <mark>Optional metadata can fail without hiding liveness.</mark></p>',
    flow: [['P', 'E', 'agent_end', { state: 'waiting' }], ['E', 'H', 'atomic heartbeat', { managedSessionId: '7f3…', state: 'waiting' }], ['H', 'C', 'validated heartbeat', { fresh: true }], ['C', 'R', 'persist computed status', { status: 'waiting' }], ['C', 'D', 'attention row', { symbol: '◐' }]],
  },
  {
    id: 'render', title: 'One pure view of many states', reveal: ['RP'],
    lede: 'Pure projection keeps lifecycle, workflow, hierarchy, and terminal width understandable.',
    story: '<p>The controller supplies runtime sessions. The projection builds either project sections or workflow lanes, then decorates and windows the rows. <mark>Navigation and rendering share the same structural projection.</mark></p>',
    flow: [['C', 'RP', 'runtime sessions + view state', { grouping: 'stage', density: 'all-cards' }], ['RP', 'D', 'width-safe model', { sections: ['PLAN', 'EXECUTE', 'OTHER ACTIVE'] }], ['D', 'U', 'terminal frame', { selected: '7f3…' }]],
  },
  {
    id: 'tmux', title: 'Durable processes and live panels', reveal: ['T', 'SP'],
    lede: 'tmux keeps every process alive and lets Hub compose native session views instead of emulating them.',
    story: '<p>The side-pane coordinator serializes panel operations and repairs its view from live tmux state. Full-screen entry installs guarded return keys and then uses native client switching. <mark>Panel layout is ephemeral tmux state.</mark></p>',
    flow: [['D', 'SP', 'assign slot 2', { sessionId: '7f3…' }], ['SP', 'T', 'split nested attach', { slot: 2 }], ['T', 'P', 'show managed session', { statusBar: false }], ['P', 'T', 'Ctrl+Q', { focus: 'sidebar' }], ['T', 'D', 'sidebar focus', { slot: 2 }]],
  },
  {
    id: 'lifecycle', title: 'Create and remove without losing work', reveal: ['L', 'W'],
    lede: 'Lifecycle orchestration keeps external effects outside short state commits and treats source repositories conservatively.',
    story: '<p>Creation can build a symlink workspace or explicit Hub-owned worktrees before starting Pi. Finish and discard preflight cleanliness; deletion preserves Pi conversations and normally preserves worktree files. <mark>Recoverable files win over automatic cleanup.</mark></p>',
    flow: [['D', 'L', 'create worktree session', { branch: 'feature/x', repos: 2 }], ['L', 'W', 'create and link', { additionalFirstOnFinish: true }], ['W', 'L', 'prepared workspace', { links: 2, piFromPrimary: true }], ['L', 'R', 'commit session record', { status: 'starting' }], ['L', 'T', 'start process', { target: 'pi-agent-hub-7f3…' }], ['T', 'P', 'run Pi', { cwd: '/state/workspaces/7f3…' }]],
  },
  {
    id: 'capabilities', title: 'Project capabilities stay project-local', reveal: ['S', 'M'],
    lede: 'Skills and MCP are selected from the dashboard but attach only to the primary repository.',
    story: '<p>The picker writes one final selection instead of racing per-item updates. Pi loads materialized Skills; the Hub extension adapts configured MCP servers into tools. <mark>Changing capabilities does not turn Hub into a tool registry platform.</mark></p>',
    flow: [['D', 'S', 'apply Skills', { project: '/primary', enabled: ['system-atlas'] }], ['D', 'M', 'apply MCP', { project: '/primary', enabledServers: ['filesystem'] }], ['D', 'L', 'restart', { reload: 'project capabilities' }], ['L', 'P', 'launch Pi', { primaryCwd: '/primary' }], ['P', 'S', 'load Skills', { materializedPath: '.pi/skills' }], ['P', 'E', 'session_start', {}], ['E', 'M', 'register tools', { directOrPooled: true }]],
  },
  {
    id: 'workflow', title: 'Producer meaning without producer coupling', reveal: ['WF'],
    lede: 'Optional metadata gives the dashboard richer meaning while producers keep their own vocabulary and execution.',
    story: '<p>A producer writes a bounded branch entry. The extension carries it through the heartbeat, and the renderer chooses canonical lanes without mirroring step ids. <mark>Workflow position, liveness, attention, and child activity stay independent.</mark></p>',
    flow: [['WF', 'P', 'workflow-runtime entry', { activeStep: 'execute', ticketId: 'hub-042' }], ['P', 'E', 'branch snapshot', { event: 'agent_settled' }], ['E', 'H', 'heartbeat', { activeIndex: 1 }], ['H', 'C', 'validated metadata', { base: true, mode: true }], ['C', 'RP', 'runtime overlay', { persistMode: false }], ['RP', 'D', 'EXECUTE card', { marker: '◉EX' }]],
  },
  {
    id: 'compat', title: 'Nested agents without a second runtime', reveal: ['SA'],
    lede: 'Subagent rows are a compatibility projection over externally owned tmux-backed child work.',
    story: '<p>Hub accepts bounded parent links and task metadata, then builds a tree for display and cascade safety. It never promotes child attention or state to the parent. <mark>Compatibility does not imply lifecycle ownership.</mark></p>',
    flow: [['SA', 'R', 'compatible registry row', { kind: 'subagent', parentId: '7f3…' }], ['R', 'C', 'flat rows', { count: 13 }], ['C', 'RP', 'scope-specific tree', { expandedParentIds: ['7f3…'] }], ['RP', 'D', 'nested child row', { depth: 1, runningCount: 1 }], ['D', 'U', 'supervision view', { parentPromoted: false }]],
  },
  {
    id: 'all', title: 'The whole system', reveal: [],
    lede: 'All structures are visible now; choose a representative flow and inspect any packet.',
    story: '<p>The dominant loop is local and explicit: user action enters the dashboard, Hub coordinates state and tmux, Pi does the agent work, and the extension reports back. Choose a flow below, hover any structure, click to pin, and use → to go inside. The <mark>Open questions</mark> tab records architecture clarifications by stable ID.</p>',
    flow: null,
  },
];

export const HOW_HTML = `<div class="eyebrow">pi-agent-hub · TypeScript package</div><h1 class="t">How it is built</h1><div class="sub">Pi runs agents · tmux keeps them alive · Hub projects and controls</div>
<h3 class="sec">Primary boundaries</h3>
<p><code>src/cli.ts</code> routes commands. <code>src/app/</code> coordinates dashboard behavior and lifecycle. <code>src/core/</code> owns state, heartbeat, tmux, workspace, and Git primitives. <code>src/tui/</code> stays pure and testable. <code>src/extension/</code> is the process-local Pi bridge.</p>
<h3 class="sec">State boundary</h3>
<p>Global Hub state lives under <code>PI_AGENT_HUB_DIR</code> or the Pi state directory. Project capability state stays in the primary repository’s <code>.pi/</code>. Pi conversation files remain Pi-owned.</p>
<h3 class="sec">Safety boundary</h3>
<p>External tmux, filesystem, and Git work happens outside registry locks. Registry changes reload latest state and write atomically. Worktree finish/discard requires clean state and preserves recoverable files on failure.</p>
<h3 class="sec">Verification</h3>
<p>Tests compile with TypeScript and run through Node’s test runner. Pure projection, parser, state, lifecycle, tmux, and dialog contracts have focused test files under <code>test/</code>.</p>`;
