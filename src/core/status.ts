import { readJsonOr } from "./atomic-json.js";
import { heartbeatPath } from "./paths.js";
import type { ManagedSession, SessionStatus, Heartbeat, StatusInput, TmuxState } from "./types.js";

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 60_000;
export const TMUX_ACTIVE_MS = 5_000;

export interface ComputedStatus {
  status: SessionStatus;
  note?: string;
  error?: string;
}

export async function readHeartbeat(sessionId: string): Promise<Heartbeat | undefined> {
  return readJsonOr<Heartbeat | undefined>(heartbeatPath(sessionId), undefined);
}

export function computeStatus(input: StatusInput): ComputedStatus {
  const { session, tmux, heartbeat, now } = input;
  if (!tmux.exists) {
    return session.status === "stopped"
      ? { status: "stopped" }
      : { status: "error", error: tmux.error ?? "tmux session is missing" };
  }

  const fallbackFromTmux = (note?: string): ComputedStatus => {
    if (tmux.recentActivityMs !== undefined && tmux.recentActivityMs < TMUX_ACTIVE_MS) {
      return { status: "running", note };
    }
    if (session.status === "starting") return { status: "starting", note };
    if (session.status === "running") return { status: "waiting", note };
    return { status: session.acknowledgedAt ? "idle" : "waiting", note };
  };

  if (!heartbeat) return fallbackFromTmux("missing heartbeat");
  if (heartbeat.state === "error") return { status: "error", error: heartbeat.message ?? "Pi session reported an error" };
  if (heartbeat.state === "shutdown") return { status: "stopped" };

  const stale = now - heartbeat.updatedAt > HEARTBEAT_STALE_MS;
  if (stale) return fallbackFromTmux("stale heartbeat");
  if (heartbeat.state === "running" || heartbeat.state === "starting") return { status: "running" };

  const lastAgentEnd = heartbeat.stateSince;
  if (!session.acknowledgedAt || session.acknowledgedAt < lastAgentEnd) return { status: "waiting" };
  return { status: "idle" };
}

export function applyComputedStatus(session: ManagedSession, computed: ComputedStatus, now = Date.now(), heartbeat?: Heartbeat): ManagedSession {
  return {
    ...session,
    status: computed.status,
    error: computed.error,
    sessionFile: heartbeat?.piSessionFile ?? session.sessionFile,
    piSessionId: heartbeat?.piSessionId ?? session.piSessionId,
    updatedAt: now,
  };
}

export function markAcknowledged(session: ManagedSession, now = Date.now()): ManagedSession {
  return { ...session, acknowledgedAt: now, status: session.status === "waiting" ? "idle" : session.status, updatedAt: now };
}

export function tmuxMissing(error?: string): TmuxState {
  return { exists: false, error };
}
