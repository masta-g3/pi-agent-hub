import { createSessionTreeIndex } from "../core/session-tree.js";
import type { TmuxClient } from "../core/tmux.js";
import type { RuntimeSession, SessionAttentionKind } from "../core/types.js";

export const ATTENTION_DELIVERY_MS = 6_000;
const MAX_SEEN_REQUESTS = 512;

export interface AttentionDeliveryEntry {
  key: string;
  sessionId: string;
  tmuxSession: string;
  requestId: string;
  kind: SessionAttentionKind;
  text: string;
  title: string;
  ownerTitle?: string;
  announcedAt: number;
  expiresAt: number;
}

export interface AttentionDeliveryState {
  seen: ReadonlyMap<string, number>;
  active: readonly AttentionDeliveryEntry[];
}

export interface AttentionDeliveryObservation {
  state: AttentionDeliveryState;
  active: readonly AttentionDeliveryEntry[];
  fresh: readonly AttentionDeliveryEntry[];
}

export interface AttentionDeliveryRoute {
  deliveries: readonly { client: TmuxClient; entries: readonly AttentionDeliveryEntry[] }[];
  bellEligible: boolean;
}

interface Candidate extends Omit<AttentionDeliveryEntry, "announcedAt" | "expiresAt"> {
  acknowledgedAt?: number;
}

export function createAttentionDeliveryState(sessions: readonly RuntimeSession[], now = Date.now()): AttentionDeliveryState {
  const candidates = deliveryCandidates(sessions);
  return { seen: trimSeen(new Map(candidates.map((candidate) => [candidate.key, now]))), active: [] };
}

export function observeAttentionDelivery(
  previous: AttentionDeliveryState,
  sessions: readonly RuntimeSession[],
  now = Date.now(),
): AttentionDeliveryObservation {
  const candidates = deliveryCandidates(sessions);
  const current = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const liveSessionIds = new Set(sessions.map((session) => session.id));
  const seen = new Map([...previous.seen].filter(([key]) => liveSessionIds.has(sessionIdFromKey(key))));
  const active: AttentionDeliveryEntry[] = [];

  for (const entry of previous.active) {
    const candidate = current.get(entry.key);
    if (!candidate || now >= entry.expiresAt || (candidate.acknowledgedAt ?? -1) >= entry.announcedAt) continue;
    active.push({
      ...deliveryPresentation(candidate),
      announcedAt: entry.announcedAt,
      expiresAt: entry.expiresAt,
    });
  }

  const fresh: AttentionDeliveryEntry[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue;
    seen.set(candidate.key, now);
    const entry: AttentionDeliveryEntry = {
      ...deliveryPresentation(candidate),
      announcedAt: now,
      expiresAt: now + ATTENTION_DELIVERY_MS,
    };
    active.push(entry);
    fresh.push(entry);
  }

  active.sort(compareNewestRequest);
  fresh.sort(compareNewestRequest);
  const state = { seen: trimSeen(seen), active };
  return { state, active, fresh };
}

export function activeAttentionRequest(state: AttentionDeliveryState, sessionId: string): AttentionDeliveryEntry | undefined {
  return state.active.find((entry) => entry.sessionId === sessionId);
}

export function routeAttentionDeliveries(
  entries: readonly AttentionDeliveryEntry[],
  clients: readonly TmuxClient[],
  context: {
    dashboardSession: string;
    dashboardPaneId?: string;
    pins: readonly { sessionId: string; paneId: string }[];
  },
): AttentionDeliveryRoute {
  const pins = new Map(context.pins.map((pin) => [pin.paneId, pin.sessionId]));
  let suppressed = false;
  const deliveries = clients.flatMap((client) => {
    const eligible = entries.filter((entry) => {
      const focusedOnDashboard = client.session === context.dashboardSession && client.paneId === context.dashboardPaneId;
      const focusedOnSession = client.session === entry.tmuxSession;
      const focusedOnPin = client.session === context.dashboardSession && pins.get(client.paneId) === entry.sessionId;
      const isSuppressed = focusedOnDashboard || focusedOnSession || focusedOnPin;
      suppressed ||= isSuppressed;
      return !isSuppressed;
    });
    return eligible.length ? [{ client, entries: eligible }] : [];
  });
  return { deliveries, bellEligible: deliveries.length > 0 && !suppressed };
}

function deliveryCandidates(sessions: readonly RuntimeSession[]): Candidate[] {
  const tree = createSessionTreeIndex([...sessions]);
  const candidates: Candidate[] = [];
  for (const session of sessions) {
    const attention = session.context?.attention;
    if ((session.status !== "waiting" && session.status !== "idle") || !attention?.requestId) continue;
    const row = tree.get(session.id);
    const owner = row ? tree.trace(row).owner : undefined;
    candidates.push({
      key: requestKey(session.id, attention.requestId),
      sessionId: session.id,
      tmuxSession: session.tmuxSession,
      requestId: attention.requestId,
      kind: attention.kind,
      text: attention.text,
      title: session.title,
      ...(owner && owner.id !== session.id ? { ownerTitle: owner.title } : {}),
      ...(session.acknowledgedAt === undefined ? {} : { acknowledgedAt: session.acknowledgedAt }),
    });
  }
  return candidates;
}

function compareNewestRequest(left: AttentionDeliveryEntry, right: AttentionDeliveryEntry): number {
  return right.announcedAt - left.announcedAt || right.key.localeCompare(left.key);
}

function deliveryPresentation(candidate: Candidate): Omit<AttentionDeliveryEntry, "announcedAt" | "expiresAt"> {
  const { acknowledgedAt: _acknowledgedAt, ...presentation } = candidate;
  return presentation;
}

function requestKey(sessionId: string, requestId: string): string {
  return `${sessionId}\0${requestId}`;
}

function sessionIdFromKey(key: string): string {
  return key.slice(0, key.indexOf("\0"));
}

function trimSeen(seen: Map<string, number>): ReadonlyMap<string, number> {
  if (seen.size <= MAX_SEEN_REQUESTS) return seen;
  const oldest = [...seen].sort((left, right) => left[1] - right[1]).slice(0, seen.size - MAX_SEEN_REQUESTS);
  for (const [key] of oldest) seen.delete(key);
  return seen;
}
