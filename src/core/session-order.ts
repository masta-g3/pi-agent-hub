import { sectionRank, sessionSection } from "./session-bucket.js";
import type { ManagedSession } from "./types.js";

export function orderedSessions<T extends ManagedSession>(sessions: T[]): T[] {
  const ranks = orderRanks(sessions);
  const indexById = new Map(sessions.map((session, index) => [session.id, index]));
  return sessions.slice().sort((a, b) => sectionRank(a) - sectionRank(b) || groupOrder(a.group, b.group) || ranks.get(a.id)! - ranks.get(b.id)! || indexById.get(a.id)! - indexById.get(b.id)!);
}

export function nextOrderInGroup(sessions: ManagedSession[], group: string, section: ReturnType<typeof sessionSection> = "active"): number {
  const ranks = orderRanks(sessions);
  const orders = sessions.filter((session) => session.group === group && sessionSection(session) === section).map((session) => ranks.get(session.id) ?? 0);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function assignGroupOrder<T extends ManagedSession>(sessions: T[], orderedIds: string[], group: string, section: ReturnType<typeof sessionSection> = "active"): T[] {
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  return sessions.map((session) => session.group === group && sessionSection(session) === section ? { ...session, order: orderById.get(session.id) ?? session.order } : session);
}

export function groupOrder(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "default") return -1;
  if (b === "default") return 1;
  return a.localeCompare(b);
}

function orderRanks(sessions: ManagedSession[]): Map<string, number> {
  const groupCounts = new Map<string, number>();
  const ranks = new Map<string, number>();
  for (const session of sessions) {
    const fallback = groupCounts.get(session.group) ?? 0;
    groupCounts.set(session.group, fallback + 1);
    ranks.set(session.id, typeof session.order === "number" && Number.isFinite(session.order) ? session.order : fallback);
  }
  return ranks;
}
