import { loadRegistry } from "../core/registry.js";
import { applyComputedStatus, computeStatus, isFreshHeartbeat } from "../core/status.js";
import { isForkPreparationPending, reconcileForkPreparation } from "../core/fork-preparation.js";
import type { ManagedSession, RuntimeSession, SessionsRegistry } from "../core/types.js";
import { buildRenderModel, type RenderSession } from "../tui/render-model.js";
import { statusEvidenceFields, type StatusEvidenceField } from "../tui/status-evidence.js";
import { observeSessions, type SessionObservation } from "./session-observation.js";

export interface ExplainSessionDeps {
  load?: () => Promise<SessionsRegistry>;
  observe?: (sessions: readonly ManagedSession[]) => Promise<Map<string, SessionObservation>>;
  now?: () => number;
}

export async function explainSession(query: string, deps: ExplainSessionDeps = {}): Promise<string> {
  const registry = await (deps.load ?? loadRegistry)();
  const selected = resolveSessionId(registry.sessions, query);
  const now = deps.now?.() ?? Date.now();
  const observations = await (deps.observe ?? observeSessions)(registry.sessions);
  const runtime = registry.sessions.map((session) => observedRuntimeSession(session, observations.get(session.id), now));
  const rendered = buildRenderModel({ sessions: runtime, selectedId: selected.id, width: 120, now }).selected;
  if (!rendered) throw new Error(`Session disappeared during inspection: ${selected.id}`);
  return formatSessionExplanation(rendered, now);
}

export function resolveSessionId(sessions: readonly ManagedSession[], query: string): ManagedSession {
  const value = query.trim();
  if (!value) throw new Error("Usage: pi-hub explain <session-id-or-prefix>");
  const exact = sessions.find((session) => session.id === value);
  if (exact) return exact;
  const matches = sessions.filter((session) => session.id.startsWith(value));
  if (matches.length === 1) return matches[0]!;
  if (!matches.length) throw new Error(`Session not found: ${value}`);
  const choices = matches.slice(0, 5).map((session) => `${session.id} (${session.title})`).join(", ");
  const more = matches.length > 5 ? `, +${matches.length - 5} more` : "";
  throw new Error(`Ambiguous session prefix ${JSON.stringify(value)}: ${choices}${more}`);
}

export function formatSessionExplanation(session: RenderSession, now: number): string {
  const fields = statusEvidenceFields(session, now);
  const lines = [`${session.id}\t${session.title}`];
  for (const field of fields) lines.push(formatField(field));
  return lines.join("\n");
}

function formatField(field: StatusEvidenceField): string {
  const label = field.label.padEnd(10);
  if (field.kind === "result") {
    return `${label}${field.marker} ${field.status} · ${field.tier.toUpperCase().replace("-", " ")} · ${field.reason}`;
  }
  return `${label}${field.marker} ${field.value}`;
}

function observedRuntimeSession(session: ManagedSession, observation: SessionObservation | undefined, now: number): RuntimeSession {
  if (!observation) return session;
  const forkPreparation = reconcileForkPreparation(session, observation.heartbeat, observation.presence, now);
  const observedSession = forkPreparation === session.forkPreparation ? session : { ...session, forkPreparation };
  const suppressPreparationMetadata = Boolean(forkPreparation && forkPreparation.phase !== "ready");
  const statusHeartbeat = suppressPreparationMetadata && observation.heartbeat
    ? { ...observation.heartbeat, workflow: undefined, activeMode: undefined, context: undefined, piSessionName: undefined }
    : observation.heartbeat;
  const computed = computeStatus({
    session: observedSession,
    tmux: { exists: observation.presence === "present", error: observation.error },
    heartbeat: statusHeartbeat,
    now,
  });
  const applied = applyComputedStatus(observedSession, computed, now, statusHeartbeat);
  const updated = suppressPreparationMetadata ? { ...applied, workflow: undefined } : applied;
  const context = suppressPreparationMetadata ? undefined : observation.heartbeat?.context;
  const activeMode = !suppressPreparationMetadata && observation.presence === "present" && isFreshHeartbeat(observation.heartbeat, now)
    ? observation.heartbeat.activeMode ?? observation.heartbeat.workflow?.activeMode
    : undefined;
  const piName = !suppressPreparationMetadata && isFreshHeartbeat(observation.heartbeat, now) ? observation.heartbeat.piSessionName?.trim() : undefined;
  const operation = observation.presence === "present" && isFreshHeartbeat(observation.heartbeat, now) ? observation.heartbeat.operation : undefined;
  const matchingPreparation = observation.heartbeat?.forkPreparation?.id === forkPreparation?.id;
  const preparationStatusUnknown = isForkPreparationPending(forkPreparation)
    && (observation.presence === "unknown" || Boolean(forkPreparation?.launchConfirmed && (!matchingPreparation || !isFreshHeartbeat(observation.heartbeat, now))));
  return {
    ...updated,
    ...(piName ? { title: piName } : {}),
    ...(context ? { context } : {}),
    ...(activeMode ? { activeMode } : {}),
    ...(operation ? { operation } : {}),
    ...(preparationStatusUnknown ? { preparationStatusUnknown: true } : {}),
    workflow: updated.workflow,
    statusEvidence: computed.evidence,
  };
}
