import { unlink } from "node:fs/promises";
import { isErrno } from "../core/atomic-json.js";
import { removeMultiRepoWorkspace } from "../core/multi-repo.js";
import { heartbeatPath } from "../core/paths.js";
import { loadRegistry, normalizeGroup, renameGroup as renameRegistryGroup, updateRegistry } from "../core/registry.js";
import { nextUpdatedAt } from "../core/session-version.js";
import { ARCHIVE_PRUNE_AFTER_MS, moveToBucket, restoreBucket, sessionSection } from "../core/session-bucket.js";
import { assignGroupOrder, compareSessionPriority, nextOrderInGroup, orderedSessions } from "../core/session-order.js";
import { createSessionTreeIndex, orderedSessionRows, isSubagentSession, sessionCascadeIds } from "../core/session-tree.js";
import { readPiSessionName } from "../core/pi-session-name.js";
import { applyComputedStatus, computeStatus, isFreshHeartbeat, markAcknowledged } from "../core/status.js";
import { capturePane, sessionPresence, sessionPresenceSnapshot, type TmuxPresence, type TmuxPresenceResult } from "../core/tmux.js";
import type { SessionsRegistry, ManagedSession, RuntimeSession, PiAgentHubContextV1, RuntimeStatusEvidence, SessionBucket, WorkflowModeDisplay } from "../core/types.js";
import { observeSessions, type SessionObservation } from "./session-observation.js";

export interface SessionsSnapshot {
  registry: SessionsRegistry;
  sessions: RuntimeSession[];
  selectedId?: string;
  preview: string;
  filter?: string;
}

export type SyncPiNameResult =
  | { status: "synced"; name: string }
  | { status: "unavailable" }
  | { status: "unnamed" };

export class SessionsController {
  private registry: SessionsRegistry;
  private sessionContexts = new Map<string, PiAgentHubContextV1>();
  private workflowModes = new Map<string, WorkflowModeDisplay>();
  private statusEvidence = new Map<string, { fingerprint: string; evidence: RuntimeStatusEvidence }>();
  private selectedId: string | undefined;
  private preview = "";
  private previewRequest = 0;
  private filter: string | undefined;

  constructor(
    registry: SessionsRegistry = { version: 1, sessions: [] },
    private capture: typeof capturePane = capturePane,
    private presence: typeof sessionPresence = sessionPresence,
    private presenceSnapshot: (names: readonly string[]) => Promise<Map<string, TmuxPresenceResult>> = (names) => sessionPresenceSnapshot(names),
  ) {
    this.registry = registry;
    this.selectedId = visibleSessions(registry.sessions, undefined)[0]?.id;
  }

  async refresh(now = Date.now()): Promise<void> {
    this.registry = await loadRegistry();
    this.repairSelection();
    const observations = await observeSessions(this.registry.sessions, this.presence === sessionPresence
      ? { presenceSnapshot: this.presenceSnapshot }
      : { presence: this.presence });

    let prunedSessions: ManagedSession[] = [];
    const appliedObservationIds = new Set<string>();
    const observedEvidence = new Map<string, { fingerprint: string; evidence: RuntimeStatusEvidence }>();
    this.registry = await updateRegistry((latest) => {
      const presenceById = new Map<string, TmuxPresence>();
      const prunedIds = new Set<string>();
      for (const session of latest.sessions) {
        const observation = matchingObservation(session, observations);
        if (!observation) continue;
        presenceById.set(session.id, observation.presence);
        if (isSubagentSession(session) && observation.presence === "missing") prunedIds.add(session.id);
      }
      for (const id of expiredArchivedCascadeIds(latest.sessions, now, presenceById)) prunedIds.add(id);
      prunedSessions = latest.sessions.filter((session) => prunedIds.has(session.id));
      return {
        ...latest,
        sessions: latest.sessions.flatMap((session) => {
          if (prunedIds.has(session.id)) return [];
          const observation = matchingObservation(session, observations);
          if (!observation) return [session];
          appliedObservationIds.add(session.id);
          const computed = computeStatus({ session, tmux: { exists: observation.presence === "present", error: observation.error }, heartbeat: observation.heartbeat, now });
          const updated = applyComputedStatus(session, computed, now, observation.heartbeat);
          observedEvidence.set(session.id, { fingerprint: statusEvidenceFingerprint(updated), evidence: computed.evidence });
          const piName = typeof observation.heartbeat?.piSessionName === "string" ? observation.heartbeat.piSessionName.trim() : "";
          const title = piName && isFreshHeartbeat(observation.heartbeat, now) && session.updatedAt === observation.observedUpdatedAt && piName !== updated.title
            ? piName
            : undefined;
          return [{ ...updated, ...(title ? { title, updatedAt: nextUpdatedAt(updated.updatedAt, now) } : {}) }];
        }),
      };
    });

    const latestById = new Map(this.registry.sessions.map((session) => [session.id, session]));
    const nextStatusEvidence = new Map<string, { fingerprint: string; evidence: RuntimeStatusEvidence }>();
    for (const session of this.registry.sessions) {
      const candidate = observedEvidence.get(session.id) ?? this.statusEvidence.get(session.id);
      if (candidate?.fingerprint === statusEvidenceFingerprint(session)) nextStatusEvidence.set(session.id, candidate);
    }
    this.statusEvidence = nextStatusEvidence;
    for (const [id, observation] of observations) {
      const latest = latestById.get(id);
      if (appliedObservationIds.has(id)) {
        const context = observation.heartbeat?.context;
        if (context) this.sessionContexts.set(id, context);
        else this.sessionContexts.delete(id);
        const activeMode = observation.presence === "present" && isFreshHeartbeat(observation.heartbeat, now)
          ? observation.heartbeat.workflow?.activeMode
          : undefined;
        if (activeMode) this.workflowModes.set(id, activeMode);
        else this.workflowModes.delete(id);
      } else if (!latest || latest.tmuxSession !== observation.tmuxSession) {
        this.sessionContexts.delete(id);
        this.workflowModes.delete(id);
      }
    }
    for (const session of prunedSessions) await removeDashboardState(session);
    this.repairSelection();
  }

  async refreshPreview(lines = 160): Promise<void> {
    const request = ++this.previewRequest;
    const selected = this.selected();
    if (!selected || selected.status === "stopped" || selected.status === "error") {
      this.preview = "";
      return;
    }
    const preview = await this.capture(selected.tmuxSession, lines, { preserveStyles: true });
    if (request === this.previewRequest && this.selectedId === selected.id) this.preview = preview;
  }

  snapshot(): SessionsSnapshot {
    return { registry: this.registry, sessions: this.sessionsWithMetadata(), selectedId: this.selectedId, preview: this.preview, filter: this.filter };
  }

  move(delta: number): void {
    const sessions = this.visibleSessions();
    if (!sessions.length) {
      this.selectedId = undefined;
      return;
    }
    const index = Math.max(0, sessions.findIndex((session) => session.id === this.selectedId));
    const next = (index + delta + sessions.length) % sessions.length;
    const nextId = sessions[next]?.id;
    if (nextId !== this.selectedId) {
      this.selectedId = nextId;
      this.preview = "";
      this.previewRequest += 1;
    }
  }

  setFilter(filter: string | undefined): void {
    const previousId = this.selectedId;
    this.filter = filter?.trim() || undefined;
    this.selectedId = keepSelection(this.visibleSessions(), this.selectedId);
    if (this.selectedId !== previousId) {
      this.preview = "";
      this.previewRequest += 1;
    }
  }

  async acknowledgeSelected(now = Date.now()): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    await this.acknowledgeSession(selected.id, now);
  }

  async acknowledgeSession(id: string, now = Date.now()): Promise<void> {
    await this.mutateRegistry((latest) => ({
      ...latest,
      sessions: latest.sessions.map((session) => session.id === id ? markAcknowledged(session, now) : session),
    }));
  }

  async moveSessionToGroup(id: string, group: string, now = Date.now()): Promise<void> {
    const normalized = normalizeGroup(group);
    await this.mutateRegistry((latest) => {
      const selected = latest.sessions.find((session) => session.id === id);
      if (!selected || selected.group === normalized) return latest;
      const section = sessionSection(selected);
      const order = nextOrderInGroup(latest.sessions, normalized, section);
      return {
        ...latest,
        sessions: latest.sessions.map((session) => {
          if (session.id === id) return { ...session, group: normalized, order, updatedAt: nextUpdatedAt(session.updatedAt, now) };
          if (!isSubagentSession(selected) && session.parentId === id) return { ...session, group: normalized, updatedAt: nextUpdatedAt(session.updatedAt, now) };
          return session;
        }),
      };
    });
  }

  async reorderSelected(delta: -1 | 1): Promise<void> {
    if (this.filter) return;
    const selected = this.selected();
    if (!selected || isSubagentSession(selected)) return;
    if (sessionSection(selected) === "archived") return;
    await this.mutateRegistry((latest) => {
      const current = latest.sessions.find((session) => session.id === selected.id);
      if (!current || isSubagentSession(current)) return latest;
      const section = sessionSection(current);
      if (section === "archived") return latest;
      const group = orderedSessions(latest.sessions).filter((session) => session.group === current.group && sessionSection(session) === section && !isSubagentSession(session));
      const cohort = group.filter((session) => compareSessionPriority(session, current) === 0);
      const cohortIndex = cohort.findIndex((session) => session.id === current.id);
      const target = cohort[cohortIndex + delta];
      if (cohortIndex < 0 || !target) return latest;
      const ids = group.map((session) => session.id);
      const index = ids.indexOf(current.id);
      const targetIndex = ids.indexOf(target.id);
      [ids[index], ids[targetIndex]] = [ids[targetIndex]!, ids[index]!];
      return { ...latest, sessions: assignGroupOrder(latest.sessions, ids, current.group, section, Date.now()) };
    });
  }

  async moveSessionToBucket(id: string, bucket: SessionBucket, now = Date.now()): Promise<void> {
    const selected = this.registry.sessions.find((session) => session.id === id);
    if (!selected || isSubagentSession(selected)) return;
    const wasSelected = this.selectedId === id;
    const oldIndex = this.visibleSessions().findIndex((session) => session.id === id);
    await this.mutateRegistry((latest) => {
      const current = latest.sessions.find((session) => session.id === id);
      if (!current || isSubagentSession(current)) return latest;
      const ids = sessionCascadeIds(latest.sessions, id);
      return { ...latest, sessions: latest.sessions.map((session) => ids.has(session.id) ? moveToBucket(session, bucket, now) : session) };
    });
    if (wasSelected && bucket === "archived") this.selectedId = selectionAboveArchivedRow(this.visibleSessions(), oldIndex) ?? this.selectedId;
  }

  async restoreSessionBucket(id: string, now = Date.now()): Promise<void> {
    const selected = this.registry.sessions.find((session) => session.id === id);
    if (!selected || isSubagentSession(selected)) return;
    await this.mutateRegistry((latest) => {
      const current = latest.sessions.find((session) => session.id === id);
      if (!current || isSubagentSession(current)) return latest;
      const ids = sessionCascadeIds(latest.sessions, id);
      return { ...latest, sessions: latest.sessions.map((session) => ids.has(session.id) ? restoreBucket(session, now) : session) };
    });
  }

  async syncPiName(id: string, now = Date.now()): Promise<SyncPiNameResult> {
    const selected = this.registry.sessions.find((session) => session.id === id);
    if (!selected?.sessionFile) return { status: "unavailable" };
    let name: string | undefined;
    try {
      name = await readPiSessionName(selected.sessionFile);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return { status: "unavailable" };
      throw error;
    }
    if (!name) return { status: "unnamed" };
    await this.mutateRegistry((latest) => {
      const current = latest.sessions.find((session) => session.id === id);
      if (!current || current.title === name) return latest;
      return {
        ...latest,
        sessions: latest.sessions.map((session) => session.id === id ? { ...session, title: name, updatedAt: nextUpdatedAt(session.updatedAt, now) } : session),
      };
    });
    return { status: "synced", name };
  }

  async renameGroup(from: string, to: string): Promise<void> {
    await this.mutateRegistry((latest) => renameRegistryGroup(latest, from, to));
  }

  removeSession(id: string): void {
    const before = this.visibleSessions();
    const oldIndex = before.findIndex((session) => session.id === id);
    const wasSelected = this.selectedId === id;
    const ids = sessionCascadeIds(this.registry.sessions, id);
    for (const removedId of ids) {
      this.sessionContexts.delete(removedId);
      this.workflowModes.delete(removedId);
      this.statusEvidence.delete(removedId);
    }
    this.registry = { ...this.registry, sessions: this.registry.sessions.filter((session) => !ids.has(session.id)) };
    const after = this.visibleSessions();
    this.selectedId = wasSelected ? after[Math.min(oldIndex, after.length - 1)]?.id : keepSelection(after, this.selectedId);
    if (wasSelected) this.preview = "";
  }

  selectSession(id: string): boolean {
    if (!this.visibleSessions().some((session) => session.id === id)) return false;
    if (id !== this.selectedId) {
      this.selectedId = id;
      this.preview = "";
      this.previewRequest += 1;
    }
    return true;
  }

  selected(): RuntimeSession | undefined {
    if (!this.selectedId) return undefined;
    return this.visibleSessions().find((session) => session.id === this.selectedId);
  }

  private async mutateRegistry(mutate: (latest: SessionsRegistry) => SessionsRegistry): Promise<void> {
    this.registry = await updateRegistry(mutate);
    this.repairSelection();
  }

  private repairSelection(): void {
    const selectedId = keepSelection(this.visibleSessions(), this.selectedId);
    if (selectedId === this.selectedId) return;
    this.selectedId = selectedId;
    this.preview = "";
    this.previewRequest += 1;
  }

  private visibleSessions(): RuntimeSession[] {
    return visibleSessions(this.sessionsWithMetadata(), this.filter);
  }

  private sessionsWithMetadata(): RuntimeSession[] {
    return this.registry.sessions.map((session) => {
      const context = this.sessionContexts.get(session.id);
      const activeMode = this.workflowModes.get(session.id);
      const workflow = activeMode && session.workflow ? { ...session.workflow, activeMode } : session.workflow;
      const evidence = this.statusEvidence.get(session.id);
      const statusEvidence = evidence?.fingerprint === statusEvidenceFingerprint(session) ? evidence.evidence : undefined;
      return context || workflow !== session.workflow || statusEvidence
        ? { ...session, ...(context ? { context } : {}), workflow, ...(statusEvidence ? { statusEvidence } : {}) }
        : session;
    });
  }
}

function matchingObservation(
  session: ManagedSession,
  observations: ReadonlyMap<string, SessionObservation>,
): SessionObservation | undefined {
  const observation = observations.get(session.id);
  return observation?.tmuxSession === session.tmuxSession && observation.observedUpdatedAt === session.updatedAt ? observation : undefined;
}

function statusEvidenceFingerprint(session: ManagedSession): string {
  return JSON.stringify([session.tmuxSession, session.status, session.error, session.acknowledgedAt, session.workflow]);
}

function keepSelection(sessions: RuntimeSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function selectionAboveArchivedRow(sessions: RuntimeSession[], oldIndex: number): string | undefined {
  const nonArchived = sessions.filter((session) => sessionSection(session) !== "archived");
  if (!nonArchived.length) return undefined;
  const targetIndex = Math.min(Math.max(oldIndex - 1, 0), nonArchived.length - 1);
  return nonArchived[targetIndex]?.id;
}

function visibleSessions(sessions: RuntimeSession[], filter: string | undefined): RuntimeSession[] {
  return orderedSessionRows(sessions, filter);
}

function expiredArchivedCascadeIds(
  sessions: ManagedSession[],
  now: number,
  presenceById: ReadonlyMap<string, TmuxPresence>,
): Set<string> {
  const pruneIds = new Set<string>();
  const tree = createSessionTreeIndex(sessions);
  for (const session of sessions) {
    if (isSubagentSession(session) || session.bucket !== "archived" || typeof session.bucketChangedAt !== "number") continue;
    if (now - session.bucketChangedAt < ARCHIVE_PRUNE_AFTER_MS) continue;
    const descendants = tree.descendants(session.id);
    const ids = new Set([session.id, ...descendants.map((item) => item.id)]);
    const cascade = [session, ...descendants];
    if (cascade.every((item) => presenceById.get(item.id) === "missing")) for (const id of ids) pruneIds.add(id);
  }
  return pruneIds;
}

async function removeDashboardState(session: ManagedSession): Promise<void> {
  await removeMultiRepoWorkspace(session);
  await unlink(heartbeatPath(session.id)).catch((error: unknown) => {
    if (!isErrno(error, "ENOENT")) throw error;
  });
}
