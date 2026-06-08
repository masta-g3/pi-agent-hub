import { orderedSessions } from "./session-order.js";
import type { ManagedSession, RuntimeSession } from "./types.js";

export function isSubagentSession(session: ManagedSession): boolean {
  return session.kind === "subagent";
}

export function sessionDepth(session: RuntimeSession, sessions: RuntimeSession[]): number {
  if (!isSubagentSession(session) || !session.parentId) return 0;
  const byId = new Map(sessions.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  let depth = 0;
  let parentId: string | undefined = session.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = isSubagentSession(parent) ? parent.parentId : undefined;
  }
  return depth;
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

export function orderedSessionRows(sessions: RuntimeSession[], filter?: string): RuntimeSession[] {
  const visible = filter?.trim() ? treeFilteredSessions(sessions, filter.trim().toLowerCase()) : sessions;
  const visibleIds = new Set(visible.map((session) => session.id));
  const childrenByParent = new Map<string, RuntimeSession[]>();
  const childRows = visible.filter(isSubagentSession);
  for (const child of childRows) {
    if (!child.parentId) continue;
    const children = childrenByParent.get(child.parentId) ?? [];
    children.push(child);
    childrenByParent.set(child.parentId, children);
  }

  const rows: RuntimeSession[] = [];
  const added = new Set<string>();
  function addWithChildren(session: RuntimeSession): void {
    if (added.has(session.id)) return;
    rows.push(session);
    added.add(session.id);
    for (const child of orderedSessions(childrenByParent.get(session.id) ?? [])) addWithChildren(child);
  }

  for (const parent of orderedSessions(visible.filter((session) => !isSubagentSession(session)))) addWithChildren(parent);
  for (const orphan of orderedSessions(childRows.filter((child) => !child.parentId || !visibleIds.has(child.parentId)))) addWithChildren(orphan);
  return rows;
}

function treeFilteredSessions(sessions: RuntimeSession[], filter: string): RuntimeSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, RuntimeSession[]>();
  for (const session of sessions) {
    if (!isSubagentSession(session) || !session.parentId) continue;
    const children = childrenByParent.get(session.parentId) ?? [];
    children.push(session);
    childrenByParent.set(session.parentId, children);
  }

  const visible = new Map<string, RuntimeSession>();
  for (const session of sessions) {
    if (!matchesFilter(session, filter)) continue;
    visible.set(session.id, session);
    if (isSubagentSession(session) && session.parentId) {
      addAncestors(session, byId, visible);
    } else {
      addDescendants(session.id, childrenByParent, visible);
    }
  }
  return [...visible.values()];
}

export function matchesFilter(session: RuntimeSession, filter: string): boolean {
  return [
    session.title,
    session.group,
    basename(session.cwd),
    ...(session.additionalCwds ?? []).map(basename),
    session.status,
    session.agentName ?? "",
    session.taskPreview ?? "",
    session.sessionMetadata?.goal ?? "",
    session.sessionMetadata?.status ?? "",
    session.sessionMetadata?.nextStep ?? "",
    session.sessionMetadata?.stage ?? "",
  ].some((value) => value.toLowerCase().includes(filter));
}

function addAncestors(session: RuntimeSession, byId: Map<string, RuntimeSession>, visible: Map<string, RuntimeSession>): void {
  const seen = new Set<string>();
  let parentId = session.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return;
    visible.set(parent.id, parent);
    parentId = parent.parentId;
  }
}

function addDescendants(id: string, childrenByParent: Map<string, RuntimeSession[]>, visible: Map<string, RuntimeSession>): void {
  for (const child of childrenByParent.get(id) ?? []) {
    visible.set(child.id, child);
    addDescendants(child.id, childrenByParent, visible);
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
