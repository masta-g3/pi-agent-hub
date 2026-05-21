import { groupOrder, orderedSessions } from "../core/session-order.js";
import { orderedSessionRows, sessionDepth } from "../core/session-tree.js";
import type { ManagedSession, SessionStatus } from "../core/types.js";

export interface RenderSession {
  id: string;
  title: string;
  cwd: string;
  additionalCwds: string[];
  workspaceCwd?: string;
  repoCount: number;
  group: string;
  status: SessionStatus;
  displayStatus: "running" | "waiting" | "idle" | "error" | "stopped";
  symbol: string;
  selected: boolean;
  error?: string;
  sessionFile?: string;
  enabledMcpServers: string[];
  skillCount?: number;
  kind: "main" | "subagent";
  depth: number;
  parentId?: string;
  agentName?: string;
  taskPreview?: string;
  resultSummary?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  worktreeBaseBranch?: string;
  worktreeOwnedByHub?: boolean;
}

export interface StatusCounts {
  running: number;
  waiting: number;
  idle: number;
  error: number;
  stopped: number;
}

export interface RenderGroup {
  name: string;
  statusCounts: StatusCounts;
  sessions: RenderSession[];
}

export interface RenderSummary {
  total: number;
  visibleTotal: number;
  statusCounts: StatusCounts;
}

export interface RenderModel {
  width: number;
  height?: number;
  empty: boolean;
  noMatches: boolean;
  showPreview: boolean;
  compactFooter: boolean;
  groups: RenderGroup[];
  summary: RenderSummary;
  selected?: RenderSession;
  footer: string;
  filter?: string;
  preview: string;
  detailsExpanded: boolean;
}

export interface BuildRenderModelInput {
  sessions: ManagedSession[];
  selectedId?: string;
  width: number;
  height?: number;
  filter?: string;
  filterEditing?: boolean;
  preview?: string;
  detailsExpanded?: boolean;
  selectedSkillCount?: number;
}

export function buildRenderModel(input: BuildRenderModelInput): RenderModel {
  const visible = orderedSessionRows(input.sessions, input.filter);
  const selectedId = pickSelectedId(visible, input.selectedId);
  const mapped = visible.map((session) => toRenderSession(session, session.id === selectedId, input.sessions, session.id === selectedId ? input.selectedSkillCount : undefined));
  const groupsByName = new Map<string, RenderSession[]>();
  for (const session of mapped) {
    const group = groupsByName.get(session.group) ?? [];
    group.push(session);
    groupsByName.set(session.group, group);
  }

  const groups = [...groupsByName.entries()]
    .sort(([a], [b]) => groupOrder(a, b))
    .map(([name, sessions]) => ({
      name,
      statusCounts: countRenderSessions(sessions),
      sessions,
    } satisfies RenderGroup));

  const compactFooter = input.width < 80;
  return {
    width: input.width,
    empty: input.sessions.length === 0,
    noMatches: input.sessions.length > 0 && visible.length === 0,
    showPreview: input.width >= 80,
    compactFooter,
    groups,
    summary: {
      total: input.sessions.length,
      visibleTotal: visible.length,
      statusCounts: countRenderSessions(mapped),
    },
    ...(input.height ? { height: input.height } : {}),
    selected: mapped.find((session) => session.selected),
    footer: compactFooter ? "Enter · n · /  │  i · r · R · w  │  ?" : "Enter Open · n New · / Filter  │  i Info · r Rename · R Restart · w Finish WT  │  ? Help",
    filter: input.filter,
    preview: input.preview ?? "",
    detailsExpanded: input.detailsExpanded ?? false,
  };
}

export function retainSelectionAfterRefresh(
  previous: ManagedSession[],
  next: ManagedSession[],
  selectedId: string | undefined,
): string | undefined {
  if (!next.length) return undefined;
  if (selectedId && next.some((session) => session.id === selectedId)) return selectedId;
  const removed = previous.find((session) => session.id === selectedId);
  if (!removed) return next[0]?.id;

  const sameGroup = orderedSessions(next).filter((session) => session.group === removed.group);
  if (!sameGroup.length) return orderedSessions(next)[0]?.id;

  const previousSameGroup = orderedSessions(previous).filter((session) => session.group === removed.group);
  const oldIndex = previousSameGroup.findIndex((session) => session.id === selectedId);
  return sameGroup[Math.min(oldIndex, sameGroup.length - 1)]?.id ?? sameGroup.at(-1)?.id;
}

function pickSelectedId(sessions: ManagedSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function toRenderSession(session: ManagedSession, selected: boolean, sessions: ManagedSession[], skillCount: number | undefined): RenderSession {
  const displayStatus = displayStatusFor(session.status);
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    additionalCwds: session.additionalCwds ?? [],
    workspaceCwd: session.workspaceCwd,
    repoCount: 1 + (session.additionalCwds?.length ?? 0),
    group: session.group,
    status: session.status,
    displayStatus,
    symbol: symbolFor(displayStatus),
    selected,
    error: session.error,
    sessionFile: session.sessionFile,
    enabledMcpServers: session.enabledMcpServers ?? [],
    ...(skillCount !== undefined ? { skillCount } : {}),
    kind: session.kind ?? "main",
    depth: sessionDepth(session, sessions),
    parentId: session.parentId,
    agentName: session.agentName,
    taskPreview: session.taskPreview,
    resultSummary: session.resultSummary,
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    worktreeBaseBranch: session.worktreeBaseBranch,
    worktreeOwnedByHub: session.worktreeOwnedByHub,
  };
}

function displayStatusFor(status: SessionStatus): RenderSession["displayStatus"] {
  if (status === "starting") return "running";
  return status;
}

function symbolFor(status: RenderSession["displayStatus"]): string {
  switch (status) {
    case "running": return "●";
    case "waiting": return "◐";
    case "idle": return "○";
    case "error": return "×";
    case "stopped": return "-";
  }
}

function emptyStatusCounts(): StatusCounts {
  return { running: 0, waiting: 0, idle: 0, error: 0, stopped: 0 };
}

function countRenderSessions(sessions: RenderSession[]): StatusCounts {
  const counts = emptyStatusCounts();
  for (const session of sessions) counts[session.displayStatus] += 1;
  return counts;
}
