import { nextUpdatedAt } from "./session-version.js";
import type { ManagedSession, SessionClosure } from "./types.js";

export type SessionSection = "active" | "backlog" | "archived";

export const ARCHIVE_PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionSection(session: ManagedSession): SessionSection {
  return session.bucket ?? "active";
}

export function sectionRank(session: ManagedSession): number {
  switch (sessionSection(session)) {
    case "active": return 0;
    case "backlog": return 1;
    case "archived": return 2;
  }
}

export function moveToBucket<T extends ManagedSession>(session: T, bucket: "backlog" | "archived", now = Date.now()): T {
  if (session.bucket === bucket) return session;
  return { ...session, bucket, bucketChangedAt: now, updatedAt: nextUpdatedAt(session.updatedAt, now) };
}

export function restoreBucket<T extends ManagedSession>(session: T, now = Date.now()): T {
  if (session.bucket === undefined && session.closure === undefined) return session;
  const { bucket: _bucket, bucketChangedAt: _bucketChangedAt, closure: _closure, ...rest } = session;
  return { ...rest, updatedAt: nextUpdatedAt(session.updatedAt, now) } as T;
}

export function sessionClosure(session: Pick<ManagedSession, "closure" | "kind">): SessionClosure | undefined {
  if (session.kind === "subagent") return undefined;
  return session.closure === "done" || session.closure === "abandoned" ? session.closure : undefined;
}

/** Close records the outcome and a new archive transition, even for rows already archived. */
export function closeBucket<T extends ManagedSession>(session: T, closure: SessionClosure, now = Date.now()): T {
  if (session.closure !== undefined) return session;
  return { ...session, closure, bucket: "archived", bucketChangedAt: now, updatedAt: nextUpdatedAt(session.updatedAt, now) };
}
