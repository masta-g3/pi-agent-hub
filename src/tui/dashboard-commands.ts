import type { DashboardShortcut } from "../core/dashboard-shortcuts.js";
import { matchesFilter } from "../core/session-tree.js";
import type { RuntimeSession, SessionStatus } from "../core/types.js";
import { matchesDashboardShortcut } from "./dashboard-shortcuts.js";

export type DashboardCommandGroup = "actions" | "sessions" | "filters" | "views";

export interface DashboardKeyBinding {
  key: string;
}

export interface DashboardCommand {
  id: string;
  group: DashboardCommandGroup;
  label: string;
  hint: string;
  displayKey?: string;
  bindings: DashboardKeyBinding[];
  targetSessionId?: string;
  enabled: boolean;
  disabledReason?: string;
  searchText: string;
}

export interface WorkspaceCommandSelection {
  recommendation: string;
  actions: DashboardCommand[];
  evidenceCommand: DashboardCommand;
  moreCommand: DashboardCommand;
}

export interface DashboardCommandCapabilities {
  openSession?: boolean;
  restart?: boolean;
  deleteSession?: boolean;
  finishWorktree?: boolean;
  forkSession?: boolean;
  renameSession?: boolean;
  syncPiName?: boolean;
  sendMessage?: boolean;
  runConfiguredShortcut?: boolean;
  skills?: boolean;
  mcp?: boolean;
  theme?: boolean;
  resetSidePane?: boolean;
  assignSidePane?: boolean;
  closeSidePane?: boolean;
  focusSidePane?: boolean;
  acknowledge?: boolean;
}

export interface DashboardCommandInput {
  sessions: readonly RuntimeSession[];
  selectedId?: string;
  filter?: string;
  grouping?: "project" | "stage";
  configuredShortcuts?: readonly DashboardShortcut[];
  capabilities?: DashboardCommandCapabilities;
  /** Set while another modal, pending choice, or busy operation owns input. */
  interactionBlockedReason?: string;
}

interface Availability {
  enabled: boolean;
  reason?: string;
}

interface ActionSpec {
  name: string;
  label: string;
  hint: string;
  keys: string[];
  available(session: RuntimeSession, input: DashboardCommandInput): Availability;
}

const sessionSearchTargets = new WeakMap<DashboardCommand, RuntimeSession>();
const statuses: SessionStatus[] = ["starting", "running", "waiting", "idle", "error", "stopped"];

const actionSpecs: ActionSpec[] = [
  { name: "open", label: "Open", hint: "attach to the session; stopped sessions restart", keys: ["Enter", "C-m", "C-j"], available: openAvailability },
  { name: "restart", label: "Restart choices…", hint: "resume, start a new conversation, or restart Active sessions", keys: ["r"], available: mainCapability("restart", "restart unavailable") },
  { name: "send", label: "Send text…", hint: "send one line without opening the session", keys: ["p"], available: liveMainCapability("sendMessage", "send transport unavailable") },
  { name: "rename", label: "Rename…", hint: "change the Pi session name", keys: ["R", "e"], available: renameAvailability },
  { name: "sync-name", label: "Sync Pi name", hint: "read the latest native Pi name", keys: ["N", "M-n"], available: mainCapability("syncPiName", "Pi name sync unavailable") },
  { name: "fork", label: "Fork…", hint: "fork the saved conversation", keys: ["f"], available: forkAvailability },
  { name: "move-group", label: "Move group…", hint: "change this session's group", keys: ["g"], available: mainAvailability },
  { name: "rename-group", label: "Rename group…", hint: "rename this group for every session", keys: ["G"], available: mainAvailability },
  { name: "archive", label: "Archive", hint: "move to Archived without stopping Pi", keys: ["A"], available: bucketAvailability("archived") },
  { name: "backlog", label: "Backlog", hint: "move to Backlog without stopping Pi", keys: ["B"], available: bucketAvailability("backlog") },
  { name: "restore", label: "Restore active", hint: "return this session to Active", keys: ["U"], available: restoreAvailability },
  { name: "delete", label: "Delete…", hint: "remove the Hub session record", keys: ["d"], available: capability("deleteSession", "delete unavailable") },
  { name: "finish-worktree", label: "Finish worktree…", hint: "finish or discard the Hub-owned worktree", keys: ["w"], available: worktreeAvailability },
  { name: "skills", label: "Skills…", hint: "edit project skills", keys: ["s"], available: mainCapability("skills", "Skills catalog unavailable") },
  { name: "mcp", label: "MCP…", hint: "edit project MCP servers", keys: ["m"], available: mainCapability("mcp", "MCP catalog unavailable") },
  { name: "panel", label: "Open panel", hint: "show this live session beside the cockpit", keys: ["o"], available: liveCapability("resetSidePane", "side pane unavailable") },
  ...([1, 2, 3, 4] as const).map((slot): ActionSpec => ({ name: `panel-${slot}`, label: `Open in panel ${slot}`, hint: `assign this live session to panel ${slot}`, keys: [`${slot}`], available: liveCapability("assignSidePane", "side pane unavailable") })),
  { name: "info", label: "Explain status", hint: "show runtime and cockpit evidence", keys: ["i"], available: () => enabled() },
  { name: "mark-read", label: "Mark read", hint: "acknowledge the selected waiting session", keys: ["a"], available: markReadAvailability },
  { name: "reorder-up", label: "Move up", hint: "reorder inside the current priority tie", keys: ["K", "Shift+Up"], available: reorderAvailability },
  { name: "reorder-down", label: "Move down", hint: "reorder inside the current priority tie", keys: ["J", "Shift+Down"], available: reorderAvailability },
];

export function buildDashboardCommands(input: DashboardCommandInput): DashboardCommand[] {
  const commands: DashboardCommand[] = [];
  const selected = input.selectedId ? input.sessions.find((session) => session.id === input.selectedId) : undefined;
  if (selected) {
    for (const spec of actionSpecs) commands.push(actionCommand(spec, selected, input));
    for (const [index, shortcut] of (input.configuredShortcuts ?? []).entries()) commands.push(configuredCommand(shortcut, index, selected, input));
  } else {
    commands.push(projectCommand("skills", "Skills…", "edit dashboard-project skills", "s", input.capabilities?.skills === true, "Skills catalog unavailable", input.interactionBlockedReason));
    commands.push(projectCommand("mcp", "MCP…", "edit dashboard-project MCP servers", "m", input.capabilities?.mcp === true, "MCP catalog unavailable", input.interactionBlockedReason));
  }
  for (const session of input.sessions) {
    const command = makeCommand({
      id: `session:${session.id}`,
      group: "sessions",
      label: session.title,
      hint: sessionHint(session),
      targetSessionId: session.id,
      enabled: true,
      searchText: [session.title, session.group, session.status].join(" "),
    });
    sessionSearchTargets.set(command, session);
    commands.push(command);
  }
  commands.push(...filterCommands(input));
  commands.push(...viewCommands(input));
  return commands;
}

export function selectWorkspaceCommands(
  session: RuntimeSession,
  commands: readonly DashboardCommand[],
  maxCount: number,
): WorkspaceCommandSelection {
  const attention = session.status === "waiting" || session.status === "idle" ? session.context?.attention : undefined;
  let recommendation: string;
  let actionNames: string[];

  if (attention) {
    recommendation = attention.kind === "question"
      ? "Answer the producer's explicit question."
      : attention.kind === "ready"
        ? "Review the producer's completed result."
        : "Resolve the producer's explicit blocker.";
    actionNames = ["send", "open", "mark-read"];
  } else if (session.status === "error") {
    recommendation = "Inspect live evidence before deciding whether to restart.";
    actionNames = ["open", "restart", "info"];
  } else if (session.status === "stopped") {
    recommendation = "Restart the session when this work should continue.";
    actionNames = ["open", "restart", "restore"];
  } else if (session.kind === "subagent") {
    recommendation = "Let the owner coordinate this task unless direct inspection is needed.";
    actionNames = ["open", "info"];
  } else if (session.bucket === "archived") {
    recommendation = "No intervention requested while this work remains Archived.";
    actionNames = ["open", "restore", "delete"];
  } else if (session.bucket === "backlog") {
    recommendation = "No intervention requested while this work remains in Backlog.";
    actionNames = ["open", "restore", "archive"];
  } else if (session.status === "idle" || session.status === "waiting") {
    recommendation = "No intervention requested.";
    actionNames = ["open", "send", "archive"];
  } else {
    recommendation = "Let the session continue; open it only when more context is needed.";
    actionNames = ["open", "panel", "send"];
  }

  const actionsByName = new Map(
    commands
      .filter((command) => command.group === "actions" && command.targetSessionId === session.id && command.enabled)
      .map((command) => [command.id.slice(`action:${session.id}:`.length), command]),
  );
  const actions = actionNames
    .map((name) => actionsByName.get(name))
    .filter((command): command is DashboardCommand => command !== undefined)
    .slice(0, Math.max(0, maxCount));
  const evidenceCommand = commands.find((command) => command.id === `action:${session.id}:info`);
  const moreCommand = commands.find((command) => command.id === "view:palette");
  if (!evidenceCommand || !moreCommand) throw new Error("workspace commands require evidence and palette descriptors");
  return { recommendation, actions, evidenceCommand, moreCommand };
}

export function searchDashboardCommands(commands: readonly DashboardCommand[], query: string): DashboardCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) => {
    const session = sessionSearchTargets.get(command);
    return command.searchText.includes(normalized) || Boolean(session && matchesFilter(session, normalized));
  });
}

export function commandForKey(commands: readonly DashboardCommand[], data: string): DashboardCommand | undefined {
  return commands.find((command) => command.bindings.some((binding) => matchesDashboardShortcut(data, binding.key)));
}

export function dashboardFooter(width: number): string {
  const global = viewCommands({ sessions: [], capabilities: { theme: true } });
  const open = actionSpecs.find((spec) => spec.name === "open")!;
  const item = (key: string, label: string) => `${key} ${label}`;
  const fromView = (id: string, label: string) => {
    const command = global.find((candidate) => candidate.id === id)!;
    return item(command.displayKey ?? "", label);
  };
  const openItem = item(open.keys[0]!, width < 120 ? "Workspace" : open.label);
  const palette = fromView("view:palette", "Actions");
  const help = fromView("view:help", "Help");
  if (width < 60) return ["↑↓", item("/", "Filter"), palette, help].join(" · ");
  const filter = item("/", "Filter");
  if (width < 100) return ["↑↓ Move", openItem, filter, palette, help].join(" · ");
  return ["↑↓ Move", openItem, fromView("action:new", "New"), filter, fromView("view:grouping", "Board"), palette, help].join(" · ");
}

function actionCommand(spec: ActionSpec, session: RuntimeSession, input: DashboardCommandInput): DashboardCommand {
  const availability = input.interactionBlockedReason ? disabled(input.interactionBlockedReason) : spec.available(session, input);
  return makeCommand({
    id: `action:${session.id}:${spec.name}`,
    group: "actions",
    label: spec.label,
    hint: spec.hint,
    displayKey: spec.keys[0],
    bindings: spec.keys.map((key) => ({ key })),
    targetSessionId: session.id,
    enabled: availability.enabled,
    disabledReason: availability.reason,
    searchText: `${spec.keys.join(" ")} ${spec.label} ${spec.hint}`,
  });
}

function configuredCommand(shortcut: DashboardShortcut, index: number, session: RuntimeSession, input: DashboardCommandInput): DashboardCommand {
  const availability = input.interactionBlockedReason
    ? disabled(input.interactionBlockedReason)
    : session.kind === "subagent"
    ? disabled("unavailable for subagents")
    : !isLive(session)
      ? disabled("session is not live")
      : input.capabilities?.runConfiguredShortcut !== true
        ? disabled("shortcut transport unavailable")
        : enabled();
  return makeCommand({
    id: `shortcut:${session.id}:${index}:${shortcut.key}`,
    group: "actions",
    label: shortcut.label ?? shortcut.send,
    hint: `send ${shortcut.send}`,
    displayKey: shortcut.key,
    bindings: [{ key: shortcut.key }],
    targetSessionId: session.id,
    enabled: availability.enabled,
    disabledReason: availability.reason,
    searchText: `${shortcut.key} ${shortcut.label ?? ""} ${shortcut.send} configured shortcut`,
  });
}

function projectCommand(name: string, label: string, hint: string, key: string, isEnabled: boolean, reason: string, blockedReason?: string): DashboardCommand {
  return makeCommand({
    id: `project:${name}`,
    group: "actions",
    label,
    hint,
    displayKey: key,
    bindings: [{ key }],
    enabled: isEnabled && !blockedReason,
    disabledReason: blockedReason ?? (isEnabled ? undefined : reason),
    searchText: `${key} ${label} ${hint}`,
  });
}

function filterCommands(input: DashboardCommandInput): DashboardCommand[] {
  const filters = [
    filterCommand("filter:open", "Filter…", "edit the free-text fleet filter", "/", true),
    filterCommand("filter:clear", "Clear filter", "show the complete fleet", undefined, input.filter !== undefined, input.filter === undefined ? "no filter is active" : undefined),
    filterCommand("filter:lifecycle:active", "Lifecycle: Active", "show Active sessions"),
    filterCommand("filter:lifecycle:backlog", "Lifecycle: Backlog", "show Backlog sessions"),
    filterCommand("filter:lifecycle:archived", "Lifecycle: Archived", "show Archived sessions"),
    ...statuses.map((status) => filterCommand(`filter:status:${status}`, `Status: ${titleCase(status)}`, `show ${status} sessions`)),
  ];
  const groups = [...new Set(input.sessions.map((session) => session.group))].sort((a, b) => compareCaseInsensitive(a, b));
  for (const group of groups) filters.push(filterCommand(`filter:group:${encodeURIComponent(group)}`, `Group: ${group}`, `show sessions in ${group}`));
  return filters;
}

function viewCommands(input: DashboardCommandInput): DashboardCommand[] {
  return [
    makeCommand({ id: "action:new", group: "views", label: "New session", hint: "create a managed Pi session", displayKey: "n", bindings: [{ key: "n" }], enabled: true, searchText: "n new session create" }),
    makeCommand({ id: "view:palette", group: "views", label: "Actions", hint: "search actions, sessions, bounded context, and filters", displayKey: ":", bindings: [{ key: ":" }], enabled: true, searchText: ": actions commands palette sessions bounded context filters search" }),
    makeCommand({ id: "view:focus-panel", group: "views", label: "Focus panel…", hint: "choose a numbered panel to focus", displayKey: "F", bindings: [{ key: "F" }], enabled: input.capabilities?.focusSidePane === true && !input.interactionBlockedReason, disabledReason: input.interactionBlockedReason ?? (input.capabilities?.focusSidePane === true ? undefined : "side pane unavailable"), searchText: "F focus panel pane" }),
    makeCommand({ id: "view:close-panel", group: "views", label: "Close panel…", hint: "choose a numbered panel to close", displayKey: "x", bindings: [{ key: "x" }], enabled: input.capabilities?.closeSidePane === true && !input.interactionBlockedReason, disabledReason: input.interactionBlockedReason ?? (input.capabilities?.closeSidePane === true ? undefined : "side pane unavailable"), searchText: "x close panel pane" }),
    makeCommand({ id: "view:theme", group: "views", label: "Theme…", hint: "preview and select the dashboard theme", displayKey: "t", bindings: [{ key: "t" }], enabled: input.capabilities?.theme === true && !input.interactionBlockedReason, disabledReason: input.interactionBlockedReason ?? (input.capabilities?.theme === true ? undefined : "theme settings unavailable"), searchText: "t theme colors appearance" }),
    makeCommand({ id: "view:density", group: "views", label: "Density", hint: "toggle compact and all-card rows", displayKey: "v", bindings: [{ key: "v" }], enabled: true, searchText: "v density compact cards view" }),
    makeCommand({ id: "view:grouping", group: "views", label: "Workflow board", hint: "toggle project and workflow grouping", displayKey: "S", bindings: [{ key: "S" }], enabled: true, searchText: "S workflow board project stage grouping view" }),
    makeCommand({ id: "view:help", group: "views", label: "Help", hint: "show all dashboard shortcuts", displayKey: "?", bindings: [{ key: "?" }], enabled: true, searchText: "? help shortcuts" }),
    makeCommand({ id: "view:quit", group: "views", label: "Quit", hint: "close the dashboard", displayKey: "q", bindings: [{ key: "q" }], enabled: true, searchText: "q quit close dashboard" }),
  ];
}

function filterCommand(id: string, label: string, hint: string, key?: string, isEnabled = true, reason?: string): DashboardCommand {
  return makeCommand({ id, group: "filters", label, hint, displayKey: key, bindings: key ? [{ key }] : [], enabled: isEnabled, disabledReason: reason, searchText: `${key ?? ""} ${label} ${hint}` });
}

function makeCommand(command: Omit<DashboardCommand, "bindings" | "searchText"> & Partial<Pick<DashboardCommand, "bindings" | "searchText">>): DashboardCommand {
  const disabledReason = command.enabled ? undefined : command.disabledReason ?? "command unavailable";
  return { ...command, bindings: command.bindings ?? [], disabledReason, searchText: (command.searchText ?? `${command.label} ${command.hint}`).toLowerCase() };
}

function sessionHint(session: RuntimeSession): string {
  const ticket = session.context?.ticket?.id ?? session.workflow?.ticketId;
  return [ticket ? `#${ticket}` : undefined, session.group, session.status].filter(Boolean).join(" · ");
}

function openAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  if (!isLive(session)) return input.capabilities?.restart === true ? enabled() : disabled("restart transport unavailable");
  return input.capabilities?.openSession === true ? enabled() : disabled("session transport unavailable");
}

function renameAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  const main = mainAvailability(session);
  if (!main.enabled) return main;
  if (!isLive(session)) return disabled("restart the Pi session before renaming");
  return input.capabilities?.renameSession === true ? enabled() : disabled("rename transport unavailable");
}

function forkAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  const main = mainAvailability(session);
  if (!main.enabled) return main;
  if (session.worktreeOwnedByHub === true || session.worktreePath) return disabled("Hub-owned worktree sessions cannot be forked");
  return input.capabilities?.forkSession === true ? enabled() : disabled("fork unavailable");
}

function bucketAvailability(bucket: "backlog" | "archived"): ActionSpec["available"] {
  return (session) => {
    const main = mainAvailability(session);
    if (!main.enabled) return main;
    return session.bucket === bucket ? disabled(`session is already ${bucket === "archived" ? "Archived" : "in Backlog"}`) : enabled();
  };
}

function restoreAvailability(session: RuntimeSession): Availability {
  const main = mainAvailability(session);
  if (!main.enabled) return main;
  return session.bucket ? enabled() : disabled("session already active");
}

function markReadAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  if (session.status !== "waiting" || session.acknowledgedAt !== undefined) return disabled("session has no unread attention");
  return input.capabilities?.acknowledge === true ? enabled() : disabled("acknowledge unavailable");
}

function worktreeAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  if (session.kind === "subagent") return disabled("unavailable for subagents");
  if (!(session.worktreeOwnedByHub === true || session.worktreePath || session.worktrees?.length)) return disabled("no Hub-owned worktree");
  return input.capabilities?.finishWorktree === true ? enabled() : disabled("worktree finish unavailable");
}

function reorderAvailability(session: RuntimeSession, input: DashboardCommandInput): Availability {
  const main = mainAvailability(session);
  if (!main.enabled) return main;
  if (input.grouping === "stage") return disabled("switch to project grouping to reorder");
  if (input.filter !== undefined) return disabled("clear filter to reorder");
  if (session.bucket === "archived") return disabled("Archived is sorted by archive time");
  return enabled();
}

function mainAvailability(session: RuntimeSession): Availability {
  return session.kind === "subagent" ? disabled("unavailable for subagents") : enabled();
}

function capability(name: keyof DashboardCommandCapabilities, reason: string): ActionSpec["available"] {
  return (_session, input) => input.capabilities?.[name] === true ? enabled() : disabled(reason);
}

function mainCapability(name: keyof DashboardCommandCapabilities, reason: string): ActionSpec["available"] {
  return (session, input) => {
    const main = mainAvailability(session);
    return main.enabled ? (input.capabilities?.[name] === true ? enabled() : disabled(reason)) : main;
  };
}

function liveCapability(name: keyof DashboardCommandCapabilities, reason: string): ActionSpec["available"] {
  return (session, input) => !isLive(session) ? disabled("session is not live") : input.capabilities?.[name] === true ? enabled() : disabled(reason);
}

function liveMainCapability(name: keyof DashboardCommandCapabilities, reason: string): ActionSpec["available"] {
  return (session, input) => {
    const main = mainAvailability(session);
    return !main.enabled ? main : !isLive(session) ? disabled("session is not live") : input.capabilities?.[name] === true ? enabled() : disabled(reason);
  };
}

function isLive(session: RuntimeSession): boolean {
  return session.status !== "stopped" && session.status !== "error";
}

function enabled(): Availability {
  return { enabled: true };
}

function disabled(reason: string): Availability {
  return { enabled: false, reason };
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function compareCaseInsensitive(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft < lowerRight ? -1 : lowerLeft > lowerRight ? 1 : left < right ? -1 : left > right ? 1 : 0;
}
