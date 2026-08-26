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

export interface SessionObservationDeps {
  presence?: (name: string) => Promise<TmuxPresence>;
  presenceSnapshot?: (names: readonly string[]) => Promise<Map<string, TmuxPresenceResult>>;
  heartbeat?: (id: string) => Promise<Heartbeat | undefined>;
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
  const heartbeat = deps.heartbeat ?? readHeartbeat;
  const observations = new Map<string, SessionObservation>();
  for (const session of sessions) {
    const result = presenceByTmux.get(session.tmuxSession) ?? { presence: "unknown" as const, error: "tmux session presence was not observed" };
    if (isSubagentSession(session) && result.presence === "missing") {
      observations.set(session.id, observation(session, result));
      continue;
    }
    observations.set(session.id, observation(session, result, await heartbeat(session.id)));
  }
  return observations;
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
