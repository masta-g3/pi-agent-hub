import { nextUpdatedAt } from "./session-version.js";
export { readHeartbeat } from "./heartbeat.js";
import type { ManagedSession, SessionStatus, Heartbeat, RuntimeStatusEvidence, RuntimeStatusReason, StatusInput, WorkflowSnapshot } from "./types.js";

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 60_000;
export const TMUX_ACTIVE_MS = 5_000;

export interface ComputedStatus {
  status: SessionStatus;
  error?: string;
}

export interface StatusDecision extends ComputedStatus {
  evidence: RuntimeStatusEvidence;
}

export function computeStatus(input: StatusInput): StatusDecision {
  const { session, tmux, heartbeat, now } = input;
  const decision = (status: SessionStatus, reason: RuntimeStatusReason, error?: string): StatusDecision => ({
    status,
    ...(error ? { error } : {}),
    evidence: statusEvidence(input, reason),
  });

  if (!tmux.exists) {
    if (session.status === "stopped") return decision("stopped", "tmux-stopped");
    return tmux.error
      ? decision("error", "tmux-unknown", tmux.error)
      : decision("error", "tmux-missing", "tmux session is missing");
  }

  const fallbackFromTmux = (): StatusDecision => {
    if (tmux.recentActivityMs !== undefined && tmux.recentActivityMs < TMUX_ACTIVE_MS) {
      return decision("running", "fallback-active");
    }
    if (session.status === "starting") return decision("starting", "fallback-starting");
    if (session.status === "running") return decision("waiting", "fallback-waiting");
    return session.acknowledgedAt
      ? decision("idle", "fallback-idle")
      : decision("waiting", "fallback-waiting");
  };

  if (!heartbeat) return fallbackFromTmux();
  if (heartbeat.state === "error") return decision("error", "heartbeat-error", heartbeat.message ?? "Pi session reported an error");
  if (heartbeat.state === "shutdown") return decision("stopped", "heartbeat-shutdown");

  const stale = now - heartbeat.updatedAt > HEARTBEAT_STALE_MS;
  if (stale) return fallbackFromTmux();
  if (heartbeat.state === "running" || heartbeat.state === "starting") return decision("running", "heartbeat-active");

  const lastAgentEnd = heartbeat.stateSince;
  if (!session.acknowledgedAt || session.acknowledgedAt < lastAgentEnd) return decision("waiting", "heartbeat-unread");
  return decision("idle", "heartbeat-read");
}

function statusEvidence(input: StatusInput, reason: RuntimeStatusReason): RuntimeStatusEvidence {
  const { session, tmux, heartbeat, now } = input;
  const stale = heartbeat ? now - heartbeat.updatedAt > HEARTBEAT_STALE_MS : false;
  const heartbeatEvidence: RuntimeStatusEvidence["heartbeat"] = heartbeat ? {
    freshness: stale ? "stale" : "fresh",
    state: heartbeat.state,
    updatedAt: heartbeat.updatedAt,
    stateSince: heartbeat.stateSince,
    ...(heartbeat.message ? { message: heartbeat.message } : {}),
  } : { freshness: "missing" };
  const readState = reason === "heartbeat-unread" || (reason === "fallback-waiting" && session.status !== "running" && session.acknowledgedAt === undefined)
    ? "unread"
    : (reason === "heartbeat-read" || reason === "fallback-idle")
      ? "read"
      : "not-applicable";
  return {
    observedAt: now,
    reason,
    tmux: tmux.exists
      ? { state: "present" }
      : tmux.error ? { state: "unknown", error: tmux.error } : { state: "missing" },
    heartbeat: heartbeatEvidence,
    acknowledgement: {
      state: readState,
      ...(session.acknowledgedAt !== undefined ? { acknowledgedAt: session.acknowledgedAt } : {}),
    },
    workflow: workflowEvidence(session.workflow, heartbeat, now),
  };
}

function workflowEvidence(sessionWorkflow: WorkflowSnapshot | undefined, heartbeat: Heartbeat | undefined, now: number): RuntimeStatusEvidence["workflow"] {
  const heartbeatFresh = Boolean(heartbeat && heartbeat.state !== "shutdown" && now - heartbeat.updatedAt <= HEARTBEAT_STALE_MS);
  const workflow = heartbeatFresh ? heartbeat?.workflow : sessionWorkflow;
  const source = heartbeatFresh && heartbeat?.workflow ? "fresh" : !heartbeatFresh && sessionWorkflow ? "retained" : "absent";
  if (!workflow || source === "absent") return { source: "absent" };
  const active = workflow.steps[workflow.activeIndex];
  return {
    source,
    activeIndex: workflow.activeIndex,
    stepCount: workflow.steps.length,
    ...(active ? { stepLabel: active.label ?? active.id } : {}),
  };
}

export function applyComputedStatus(session: ManagedSession, computed: ComputedStatus, now = Date.now(), heartbeat?: Heartbeat): ManagedSession {
  return updateSession(session, {
    status: computed.status,
    error: computed.error,
    sessionFile: heartbeat?.piSessionFile ?? session.sessionFile,
    piSessionId: heartbeat?.piSessionId ?? session.piSessionId,
    lastActivityAt: latestActivityAt(session.lastActivityAt, heartbeat?.stateSince),
    kind: heartbeat?.kind ?? session.kind,
    parentId: heartbeat?.parentId ?? session.parentId,
    agentName: heartbeat?.agentName ?? session.agentName,
    taskPreview: heartbeat?.taskPreview ?? session.taskPreview,
    resultPath: heartbeat?.resultPath ?? session.resultPath,
    activeTheme: isFreshHeartbeat(heartbeat, now) ? heartbeat.activeTheme : undefined,
    workflow: isFreshHeartbeat(heartbeat, now) ? retainedWorkflow(heartbeat.workflow) : session.workflow,
  }, now);
}

export function markAcknowledged(session: ManagedSession, now = Date.now(), allowIdleRequest = false): ManagedSession {
  if (session.status !== "waiting" && !(allowIdleRequest && session.status === "idle")) return session;
  return updateSession(session, {
    acknowledgedAt: now,
    status: session.status === "waiting" ? "idle" : session.status,
  }, now);
}

function updateSession(session: ManagedSession, changes: Partial<ManagedSession>, now: number): ManagedSession {
  const next = { ...session, ...changes };
  if (sessionStateKey(session) === sessionStateKey(next)) return session;
  return { ...next, updatedAt: nextUpdatedAt(session.updatedAt, now) };
}

function sessionStateKey(session: ManagedSession): string {
  const { updatedAt: _updatedAt, ...state } = session;
  return JSON.stringify(state);
}

function latestActivityAt(current: number | undefined, heartbeatStateSince: number | undefined): number | undefined {
  if (heartbeatStateSince === undefined) return current;
  return Math.max(current ?? heartbeatStateSince, heartbeatStateSince);
}

export function isFreshHeartbeat(heartbeat: Heartbeat | undefined, now: number): heartbeat is Heartbeat {
  return Boolean(heartbeat && heartbeat.state !== "shutdown" && now - heartbeat.updatedAt <= HEARTBEAT_STALE_MS);
}

function retainedWorkflow(workflow: Heartbeat["workflow"]): ManagedSession["workflow"] {
  if (!workflow) return undefined;
  const { activeMode: _activeMode, ...snapshot } = workflow;
  return snapshot;
}
