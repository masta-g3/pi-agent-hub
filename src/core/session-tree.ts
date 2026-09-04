import { orderedSessions } from "./session-order.js";
import { matchesDashboardFilter, matchesFilter as matchesDashboardTextFilter, parseDashboardFilter, type DashboardFilter } from "./dashboard-filter.js";
import type { ManagedSession, RuntimeSession } from "./types.js";

export interface SessionTreeRow {
  id: string;
  kind?: "main" | "subagent";
  parentId?: string;
}

export interface SessionTreeTrace<T extends SessionTreeRow> {
  owner: T | undefined;
  terminal: T;
  linkedParentIds: readonly string[];
  parents: readonly T[];
  missingParent: boolean;
  cycle: boolean;
}

export interface SessionTreeIndex<T extends SessionTreeRow> {
  get(id: string): T | undefined;
  trace(session: T): SessionTreeTrace<T>;
  descendants(id: string): readonly T[];
}

export function isSubagentSession(session: Pick<ManagedSession, "kind">): boolean {
  return session.kind === "subagent";
}

export function createSessionTreeIndex<T extends SessionTreeRow>(sessions: readonly T[]): SessionTreeIndex<T> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const traces = new Map<T, SessionTreeTrace<T>>();
  const childrenByParent = new Map<string, T[]>();
  for (const session of sessions) {
    if (!session.parentId) continue;
    const children = childrenByParent.get(session.parentId) ?? [];
    children.push(session);
    childrenByParent.set(session.parentId, children);
  }
  const descendantCache = new Map<string, readonly T[]>();
  return {
    get(id) {
      return byId.get(id);
    },
    descendants(id) {
      const cached = descendantCache.get(id);
      if (cached) return cached;
      const result: T[] = [];
      const queued = new Set<string>([id]);
      const queue = [id];
      for (let index = 0; index < queue.length; index += 1) {
        for (const child of childrenByParent.get(queue[index]!) ?? []) {
          if (queued.has(child.id)) continue;
          queued.add(child.id);
          queue.push(child.id);
          result.push(child);
        }
      }
      descendantCache.set(id, result);
      return result;
    },
    trace(session) {
      const cached = traces.get(session);
      if (cached) return cached;
      const linkedParentIds: string[] = [];
      const linked = new Set<string>();
      let linkedParentId = session.parentId;
      while (linkedParentId && !linked.has(linkedParentId)) {
        linked.add(linkedParentId);
        linkedParentIds.push(linkedParentId);
        linkedParentId = byId.get(linkedParentId)?.parentId;
      }

      const seen = new Set<string>();
      const parents: T[] = [];
      let terminal = session;
      let missingParent = false;
      let cycle = false;
      while (isSubagentSession(terminal) && terminal.parentId) {
        if (seen.has(terminal.parentId)) {
          cycle = true;
          break;
        }
        seen.add(terminal.parentId);
        const parent = byId.get(terminal.parentId);
        if (!parent) {
          missingParent = true;
          break;
        }
        parents.push(parent);
        terminal = parent;
      }
      const trace: SessionTreeTrace<T> = {
        owner: isSubagentSession(terminal) ? undefined : terminal,
        terminal,
        linkedParentIds,
        parents,
        missingParent,
        cycle,
      };
      traces.set(session, trace);
      return trace;
    },
  };
}

export function sessionDepth(
  session: RuntimeSession,
  sessions: readonly RuntimeSession[],
  tree: SessionTreeIndex<RuntimeSession> = createSessionTreeIndex(sessions),
): number {
  return tree.trace(session).parents.length;
}

export function sessionCascadeIds(sessions: ManagedSession[], id: string): Set<string> {
  return new Set([id, ...createSessionTreeIndex(sessions).descendants(id).map((session) => session.id)]);
}

export function orderedSessionRows(sessions: RuntimeSession[], filter?: string): RuntimeSession[] {
  const visible = filter?.trim() ? treeFilteredSessions(sessions, parseDashboardFilter(filter)) : sessions;
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
  for (const residual of orderedSessions(childRows.filter((child) => !added.has(child.id)))) addWithChildren(residual);
  return rows;
}

function treeFilteredSessions(sessions: RuntimeSession[], filter: DashboardFilter): RuntimeSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, RuntimeSession[]>();
  for (const session of sessions) {
    if (!isSubagentSession(session) || !session.parentId) continue;
    const children = childrenByParent.get(session.parentId) ?? [];
    children.push(session);
    childrenByParent.set(session.parentId, children);
  }

  const visible = new Map<string, RuntimeSession>();
  const tree = createSessionTreeIndex(sessions);
  for (const session of sessions) {
    if (!matchesDashboardFilter(session, filter, tree)) continue;
    visible.set(session.id, session);
    if (isSubagentSession(session) && session.parentId) {
      addAncestors(session, byId, visible);
    } else {
      addDescendants(session.id, childrenByParent, visible);
    }
  }
  return [...visible.values()];
}

export const matchesFilter = matchesDashboardTextFilter;

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
