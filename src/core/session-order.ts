import { sectionRank, sessionSection } from "./session-bucket.js";
import { nextUpdatedAt } from "./session-version.js";
import type { ManagedSession } from "./types.js";

export function orderedSessions<T extends ManagedSession>(sessions: T[]): T[] {
  const ranks = orderRanks(sessions);
  const indexById = new Map(sessions.map((session, index) => [session.id, index]));
  return sessions.slice().sort((a, b) => {
    const sectionDifference = sectionRank(a) - sectionRank(b);
    if (sectionDifference) return sectionDifference;
    if (sessionSection(a) === "archived") {
      const aChangedAt = typeof a.bucketChangedAt === "number" ? a.bucketChangedAt : -Infinity;
      const bChangedAt = typeof b.bucketChangedAt === "number" ? b.bucketChangedAt : -Infinity;
      return bChangedAt - aChangedAt || indexById.get(a.id)! - indexById.get(b.id)!;
    }
    return compareSessionPriority(a, b)
      || groupOrder(a.group, b.group)
      || ranks.get(a.id)! - ranks.get(b.id)!
      || indexById.get(a.id)! - indexById.get(b.id)!;
  });
}

// Attention first, then recency: errors and unanswered requests stay on top; every other row sorts by last interaction.
export function sessionPriorityRank(session: Pick<ManagedSession, "status" | "acknowledgedAt">): number {
  if (session.status === "error") return 0;
  if (session.status === "waiting" && session.acknowledgedAt === undefined) return 1;
  return 2;
}

export function compareSessionPriority(
  a: Pick<ManagedSession, "status" | "acknowledgedAt" | "lastActivityAt">,
  b: Pick<ManagedSession, "status" | "acknowledgedAt" | "lastActivityAt">,
): number {
  const aRank = sessionPriorityRank(a);
  const bRank = sessionPriorityRank(b);
  const rankDifference = aRank - bRank;
  if (rankDifference) return rankDifference;
  return aRank === 0 ? 0 : compareActivity(a.lastActivityAt, b.lastActivityAt);
}

function compareActivity(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b - a;
}

export function nextOrderInGroup(sessions: ManagedSession[], group: string, section: ReturnType<typeof sessionSection> = "active"): number {
  const ranks = orderRanks(sessions);
  const orders = sessions.filter((session) => session.group === group && sessionSection(session) === section).map((session) => ranks.get(session.id) ?? 0);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function assignGroupOrder<T extends ManagedSession>(sessions: T[], orderedIds: string[], group: string, section: ReturnType<typeof sessionSection> = "active", now = Date.now()): T[] {
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  return sessions.map((session) => {
    if (session.group !== group || sessionSection(session) !== section) return session;
    const order = orderById.get(session.id) ?? session.order;
    return order === session.order ? session : { ...session, order, updatedAt: nextUpdatedAt(session.updatedAt, now) };
  });
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
