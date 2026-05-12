import { orderedSessions } from "./session-order.js";
import type { ManagedSession } from "./types.js";

export function isSubagentSession(session: ManagedSession): boolean {
  return session.kind === "subagent";
}

export function sessionDepth(session: ManagedSession, sessions: ManagedSession[]): number {
  if (!isSubagentSession(session) || !session.parentId) return 0;
  return sessions.some((candidate) => candidate.id === session.parentId) ? 1 : 0;
}

export function sessionCascadeIds(sessions: ManagedSession[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions) {
      if (session.parentId && ids.has(session.parentId) && !ids.has(session.id)) {
        ids.add(session.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function orderedSessionRows(sessions: ManagedSession[], filter?: string): ManagedSession[] {
  const visible = filter?.trim() ? treeFilteredSessions(sessions, filter.trim().toLowerCase()) : sessions;
  const visibleIds = new Set(visible.map((session) => session.id));
  const childrenByParent = new Map<string, ManagedSession[]>();
  const childRows = visible.filter(isSubagentSession);
  for (const child of childRows) {
    if (!child.parentId) continue;
    const children = childrenByParent.get(child.parentId) ?? [];
    children.push(child);
    childrenByParent.set(child.parentId, children);
  }

  const parents = orderedSessions(visible.filter((session) => !isSubagentSession(session)));
  const rows: ManagedSession[] = [];
  const added = new Set<string>();
  for (const parent of parents) {
    rows.push(parent);
    added.add(parent.id);
    for (const child of orderedSessions(childrenByParent.get(parent.id) ?? [])) {
      rows.push(child);
      added.add(child.id);
    }
  }

  const orphans = orderedSessions(childRows.filter((child) => !child.parentId || !visibleIds.has(child.parentId) || !added.has(child.parentId)));
  for (const child of orphans) if (!added.has(child.id)) rows.push(child);
  return rows;
}

function treeFilteredSessions(sessions: ManagedSession[], filter: string): ManagedSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, ManagedSession[]>();
  for (const session of sessions) {
    if (!isSubagentSession(session) || !session.parentId) continue;
    const children = childrenByParent.get(session.parentId) ?? [];
    children.push(session);
    childrenByParent.set(session.parentId, children);
  }

  const visible = new Map<string, ManagedSession>();
  for (const session of sessions) {
    if (!matchesFilter(session, filter)) continue;
    visible.set(session.id, session);
    if (isSubagentSession(session) && session.parentId) {
      const parent = byId.get(session.parentId);
      if (parent) visible.set(parent.id, parent);
    } else {
      for (const child of childrenByParent.get(session.id) ?? []) visible.set(child.id, child);
    }
  }
  return [...visible.values()];
}

export function matchesFilter(session: ManagedSession, filter: string): boolean {
  return [
    session.title,
    session.group,
    basename(session.cwd),
    ...(session.additionalCwds ?? []).map(basename),
    session.status,
    session.agentName ?? "",
    session.taskPreview ?? "",
  ].some((value) => value.toLowerCase().includes(filter));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
