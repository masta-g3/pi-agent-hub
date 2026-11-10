import { nextUpdatedAt } from "./session-version.js";
import type { ManagedSession } from "./types.js";

/** Rows read and written by one locked registry mutation. */
export interface RegistryChange {
  before: readonly ManagedSession[];
  after: readonly ManagedSession[];
}

export type UndoKind = "lifecycle" | "group" | "read";

const UNDO_FIELDS = {
  lifecycle: ["bucket", "bucketChangedAt", "closure"],
  group: ["group", "order"],
  read: ["acknowledgedAt", "dismissedRequestId", "status"],
} as const satisfies Record<UndoKind, readonly (keyof ManagedSession)[]>;

type UndoField = (typeof UNDO_FIELDS)[UndoKind][number];
type UndoValues = Partial<Pick<ManagedSession, UndoField>>;

export interface SessionUndo {
  /** Primary row revealed after a successful undo. */
  sessionId: string;
  title: string;
  label: string;
  /** `piSessionId` guards against a replaced conversation and is never restored. */
  changes: { id: string; piSessionId?: string; before: UndoValues; after: UndoValues }[];
}

export function sessionUndo(kind: UndoKind, change: RegistryChange | undefined, sessionId: string, title: string, label: string): SessionUndo | undefined {
  if (!change) return undefined;
  const fields: readonly UndoField[] = UNDO_FIELDS[kind];
  const afterById = new Map(change.after.map((session) => [session.id, session]));
  const changes: SessionUndo["changes"] = [];
  for (const previous of change.before) {
    const next = afterById.get(previous.id);
    if (!next) continue;
    const changed = fields.filter((field) => previous[field] !== next[field]);
    if (!changed.length) continue;
    changes.push({ id: previous.id, piSessionId: next.piSessionId, before: pick(previous, changed), after: pick(next, changed) });
  }
  return changes.length ? { sessionId, title, label, changes } : undefined;
}

/** All-or-nothing: any missing row, replaced conversation, or later edit of a recorded field refuses the whole undo. */
export function applySessionUndo(sessions: readonly ManagedSession[], undo: SessionUndo, now: number): ManagedSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const unchanged = undo.changes.every((change) => {
    const current = byId.get(change.id);
    return current !== undefined && current.piSessionId === change.piSessionId
      && (Object.keys(change.after) as UndoField[]).every((field) => current[field] === change.after[field]);
  });
  if (!unchanged) throw new Error(`${undo.title} changed since; nothing undone`);
  const changes = new Map(undo.changes.map((change) => [change.id, change]));
  return sessions.map((session) => {
    const change = changes.get(session.id);
    if (!change) return session;
    const restored: Record<string, unknown> = { ...session, updatedAt: nextUpdatedAt(session.updatedAt, now) };
    for (const field of Object.keys(change.before) as UndoField[]) {
      if (change.before[field] === undefined) delete restored[field];
      else restored[field] = change.before[field];
    }
    return restored as unknown as ManagedSession;
  });
}

function pick(session: ManagedSession, fields: readonly UndoField[]): UndoValues {
  return Object.fromEntries(fields.map((field) => [field, session[field]])) as UndoValues;
}
