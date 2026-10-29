# pi-agent-hub Context

## Purpose

`pi-agent-hub` is a small Pi-native dashboard for supervising long-lived coding agents from one session list. It makes the daily agent workflow calm, visible, keyboard-fast, and recoverable while staying close to Pi. Agents ask questions, hand off results, report blockers, and get replies on their cards.

The daily loop is `]` Next request, `Tab` Answer or `p` Reply, then `]` again. `Enter` opens Pi, `i` toggles Details, and `Alt+W` opens the next request from inside Pi. Pins and follow view are opt-in for hands-on work. Pi runs the agents; tmux keeps them alive. Hub also organizes sessions and attaches project-local Skills and MCP.

## Target User

The primary user is a Pi power user who runs multiple coding-agent sessions at once and wants one terminal dashboard to supervise them. In practice, the maintainer is the main user and their workflow should be prioritized.

Secondary users are other Pi users who install the npm/Pi package and want the same tmux-backed session dashboard. External adoption is useful, but the product should not become generic at the expense of the maintainer's high-leverage daily use case.

## Project Type

This is a TypeScript npm package, CLI/TUI, and Pi extension. It is local-first tooling that composes with Pi, tmux, project Skills, MCP configuration, and optional Pi extension metadata.

## Project Stage

`pi-agent-hub` is a daily-use public package with a small external audience. It should evolve quickly when changes improve the maintainer's real workflow while preserving the project's small Pi-native center.

## Success Criteria

The project is successful when:

- The user supervises agents from one list where they ask, hand off results, and get replies without opening each session.
- `pi-hub` is the fastest, most reliable way for the primary user to manage many Pi sessions from one terminal.
- Session state is understandable, recoverable, and does not surprise the user.
- Pi remains the agent runtime and tmux remains the durable process substrate.
- Features reduce dashboard friction without adding enterprise-style abstractions.
- Extensibility is available where it naturally fits Pi: extensions, dashboard shortcuts, Skills, MCP, metadata, and workflow-stage signals.
- Multi-repo and worktree support enable agent work without taking broad ownership of source repositories.

## Operating Assumptions

- The tool is local-first and terminal-first.
- Users already have Pi, Node.js, and tmux available.
- The dashboard should stay keyboard-driven and practical for daily operation.
- Runtime state should be explicit and stored under Hub/Pi state directories, not hidden in source repositories except for project-scoped Pi configuration.
- Source repositories belong to the user. Hub may create explicit hub-owned worktrees and symlink workspaces, but it should not become a general Git manager.
- Groups and lifecycle buckets are organizational labels for dashboard rows, not first-class project-management records.
- Compatibility with Pi concepts matters more than abstract portability to other agent systems.
- Small, clear implementation should win over broad framework/platform design unless the maintainer's workflow clearly needs more structure.

## Out of Scope

`pi-agent-hub` should not be framed or built as:

- a custom agent runtime or replacement for Pi;
- an Agent Deck clone;
- a broad Git/worktree manager;
- a cloud service or synchronized hosted dashboard;
- an enterprise/team administration platform;
- a generic project-management system.

## Language

Use these terms consistently:

- **Pi session**: the underlying Pi coding-agent conversation/process.
- **Managed session**: a Pi session tracked by Hub and backed by a tmux session.
- **Dashboard**: the `pi-hub` terminal UI for viewing and controlling managed sessions.
- **Request**: an explicit agent question, ready handoff, or blocker.
- **Reply**: text sent from the selected card through Pi's bridge, using Send, Steer, or Queue.
- **Registry**: Hub's local record of managed sessions.
- **Heartbeat**: live state reported from the Pi extension into Hub state.
- **Group**: a simple session label used for dashboard organization.
- **Bucket**: an optional dashboard lifecycle section such as Active, Backlog, or Archived.
- **Subagent row**: optional compatibility display for child agent work reported by subagent tooling.
- **Project Skills / MCP**: Pi project-local capability configuration attached to the selected session's primary repo.
- **Multi-repo workspace**: a symlink workspace that exposes multiple repos to one session without moving or owning them.
- **Hub-owned worktree**: an explicit worktree created under Hub state for an isolated session branch.
- **Workflow rail / stage lane**: optional display of workflow-stage metadata reported by Pi extensions.

Avoid language that implies Hub is the runtime, an Agent Deck derivative, or a general Git manager. Prefer “Pi-native hub,” “dashboard,” “managed session,” and “tmux-backed” over broader framings like “agent platform” unless discussing future extensibility carefully.
