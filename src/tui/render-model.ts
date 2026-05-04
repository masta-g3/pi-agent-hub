import type { ManagedSession, SessionStatus } from "../core/types.js";

export interface RenderSession {
  id: string;
  title: string;
  cwd: string;
  group: string;
  status: SessionStatus;
  displayStatus: "running" | "waiting" | "idle" | "error" | "stopped";
  symbol: string;
  selected: boolean;
  error?: string;
  sessionFile?: string;
  enabledMcpServers: string[];
}

export interface RenderGroup {
  name: string;
  waitingCount: number;
  errorCount: number;
  live: RenderSession[];
  stopped: RenderSession[];
}

export interface RenderModel {
  width: number;
  empty: boolean;
  noMatches: boolean;
  showPreview: boolean;
  compactFooter: boolean;
  groups: RenderGroup[];
  selected?: RenderSession;
  footer: string;
  filter?: string;
  preview: string;
}

export interface BuildRenderModelInput {
  sessions: ManagedSession[];
  selectedId?: string;
  width: number;
  filter?: string;
  filterEditing?: boolean;
  preview?: string;
}

const groupOrder = (a: string, b: string) => {
  if (a === b) return 0;
  if (a === "default") return -1;
  if (b === "default") return 1;
  return a.localeCompare(b);
};

const statusRank: Record<SessionStatus, number> = {
  error: 0,
  waiting: 1,
  running: 2,
  starting: 2,
  idle: 3,
  stopped: 4,
};

export function buildRenderModel(input: BuildRenderModelInput): RenderModel {
  const filter = input.filter?.trim().toLowerCase();
  const visible = filter ? input.sessions.filter((session) => matchesFilter(session, filter)) : input.sessions;
  const selectedId = pickSelectedId(visible, input.selectedId);
  const mapped = visible.map((session) => toRenderSession(session, session.id === selectedId));
  const groupsByName = new Map<string, RenderSession[]>();
  for (const session of mapped) {
    const group = groupsByName.get(session.group) ?? [];
    group.push(session);
    groupsByName.set(session.group, group);
  }

  const groups = [...groupsByName.entries()]
    .sort(([a], [b]) => groupOrder(a, b))
    .map(([name, sessions]) => {
      const sorted = sessions.slice().sort((a, b) => statusRank[a.status] - statusRank[b.status] || a.title.localeCompare(b.title));
      const stopped = sorted.filter((session) => session.status === "stopped");
      const live = sorted.filter((session) => session.status !== "stopped");
      return {
        name,
        waitingCount: sorted.filter((session) => session.status === "waiting").length,
        errorCount: sorted.filter((session) => session.status === "error").length,
        live,
        stopped,
      } satisfies RenderGroup;
    });

  const compactFooter = input.width < 80;
  return {
    width: input.width,
    empty: input.sessions.length === 0,
    noMatches: input.sessions.length > 0 && visible.length === 0,
    showPreview: input.width >= 80,
    compactFooter,
    groups,
    selected: mapped.find((session) => session.selected),
    footer: input.filter !== undefined
      ? input.filterEditing
        ? `filter: ${input.filter || ""}  • esc clear • enter done`
        : `filter: ${input.filter || ""}  • esc clear`
      : compactFooter ? "? help • / filter • enter • e rename • g group • d delete • q" : "↑↓/jk • enter attach • n new • e rename • f fork • g move • G rename group • r restart • d delete • s skills • m mcp • q",
    filter: input.filter,
    preview: input.preview ?? "",
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

  const sameGroup = next.filter((session) => session.group === removed.group);
  if (!sameGroup.length) return next[0]?.id;

  const previousSameGroup = previous.filter((session) => session.group === removed.group);
  const oldIndex = previousSameGroup.findIndex((session) => session.id === selectedId);
  return sameGroup[Math.min(oldIndex, sameGroup.length - 1)]?.id ?? sameGroup.at(-1)?.id;
}

function pickSelectedId(sessions: ManagedSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function matchesFilter(session: ManagedSession, filter: string): boolean {
  return [session.title, session.group, session.cwd.split(/[\\/]/).pop() ?? "", session.status]
    .some((value) => value.toLowerCase().includes(filter));
}

function toRenderSession(session: ManagedSession, selected: boolean): RenderSession {
  const displayStatus = displayStatusFor(session.status);
  return {
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    group: session.group,
    status: session.status,
    displayStatus,
    symbol: symbolFor(displayStatus),
    selected,
    error: session.error,
    sessionFile: session.sessionFile,
    enabledMcpServers: session.enabledMcpServers ?? [],
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
