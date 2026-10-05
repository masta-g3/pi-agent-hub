import { isSubagentSession } from "../core/session-tree.js";
import { readHeartbeat } from "../core/status.js";
import { sessionPresence, sessionPresenceSnapshot, type TmuxPresence, type TmuxPresenceResult } from "../core/tmux.js";
import type { Heartbeat, ManagedSession } from "../core/types.js";

export interface SessionObservation {
  tmuxSession: string;
  observedUpdatedAt: number;
  presence: TmuxPresence;
  error?: string;
  heartbeat?: Heartbeat;
}

// Keep a stalled read in flight instead of opening the same heartbeat again on each refresh.
const pendingHeartbeatReads = new Map<string, { read: Promise<Heartbeat | undefined>; expired: boolean }>();

function readManagedHeartbeat(id: string, signal?: AbortSignal): Promise<Heartbeat | undefined> {
  const pending = pendingHeartbeatReads.get(id);
  if (pending) return pending.expired ? Promise.resolve(undefined) : pending.read;
  const entry = { read: Promise.resolve(undefined) as Promise<Heartbeat | undefined>, expired: false };
  signal?.addEventListener("abort", () => { entry.expired = true; }, { once: true });
  entry.read = readHeartbeat(id, process.env, signal).finally(() => {
    pendingHeartbeatReads.delete(id);
  });
  pendingHeartbeatReads.set(id, entry);
  return entry.read;
}

export interface SessionObservationDeps {
  presence?: (name: string) => Promise<TmuxPresence>;
  presenceSnapshot?: (names: readonly string[]) => Promise<Map<string, TmuxPresenceResult>>;
  heartbeat?: (id: string, signal?: AbortSignal) => Promise<Heartbeat | undefined>;
  heartbeatTimeoutMs?: number;
}

export async function observeSessions(
  sessions: readonly ManagedSession[],
  deps: SessionObservationDeps = {},
): Promise<Map<string, SessionObservation>> {
  const presence = deps.presence ?? sessionPresence;
  const presenceByTmux = deps.presenceSnapshot
    ? await deps.presenceSnapshot(sessions.map((session) => session.tmuxSession))
    : deps.presence
      ? new Map<string, TmuxPresenceResult>(await Promise.all(sessions.map(async (session) => [session.tmuxSession, { presence: await presence(session.tmuxSession) }] as const)))
      : await sessionPresenceSnapshot(sessions.map((session) => session.tmuxSession));
  const heartbeat = deps.heartbeat ?? readManagedHeartbeat;
  const observations = await Promise.all(sessions.map(async (session) => {
    const result = presenceByTmux.get(session.tmuxSession) ?? { presence: "unknown" as const, error: "tmux session presence was not observed" };
    if (isSubagentSession(session) && result.presence === "missing") {
      return [session.id, observation(session, result)] as const;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deps.heartbeatTimeoutMs ?? 2_000);
    try {
      const value = await Promise.race([
        heartbeat(session.id, controller.signal),
        new Promise<undefined>((resolve) => controller.signal.addEventListener("abort", () => resolve(undefined), { once: true })),
      ]);
      return [session.id, observation(session, result, value)] as const;
    } finally {
      clearTimeout(timeout);
    }
  }));
  return new Map(observations);
}

function observation(session: ManagedSession, result: TmuxPresenceResult, heartbeat?: Heartbeat): SessionObservation {
  return {
    tmuxSession: session.tmuxSession,
    observedUpdatedAt: session.updatedAt,
    presence: result.presence,
    ...(result.error ? { error: result.error } : {}),
    ...(heartbeat ? { heartbeat } : {}),
  };
}
