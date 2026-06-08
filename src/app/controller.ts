import { loadRegistry, normalizeGroup, renameGroup as renameRegistryGroup, saveRegistry, updateRegistry } from "../core/registry.js";
import { assignGroupOrder, nextOrderInGroup, orderedSessions } from "../core/session-order.js";
import { orderedSessionRows, isSubagentSession, sessionCascadeIds } from "../core/session-tree.js";
import { readPiSessionName } from "../core/pi-session-name.js";
import { readSessionMetadata } from "../core/session-metadata.js";
import { applyComputedStatus, computeStatus, markAcknowledged, readHeartbeat } from "../core/status.js";
import { capturePane, sessionExists } from "../core/tmux.js";
import type { SessionsRegistry, ManagedSession, RuntimeSession, SessionMetadata } from "../core/types.js";

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
  private sessionMetadata = new Map<string, SessionMetadata>();
  private selectedId: string | undefined;
  private preview = "";
  private filter: string | undefined;

  constructor(registry: SessionsRegistry = { version: 1, sessions: [] }) {
    this.registry = registry;
    this.selectedId = visibleSessions(registry.sessions, undefined)[0]?.id;
  }

  async refresh(now = Date.now()): Promise<void> {
    this.registry = await loadRegistry();
    this.selectedId = keepSelection(this.registry.sessions, this.selectedId);
    const sessions: ManagedSession[] = [];
    const prunedIds = new Set<string>();
    for (const session of this.registry.sessions) {
      const exists = await sessionExists(session.tmuxSession);
      if (isSubagentSession(session) && !exists) {
        prunedIds.add(session.id);
        this.sessionMetadata.delete(session.id);
        continue;
      }
      const heartbeat = await readHeartbeat(session.id);
      const sessionMetadata = await readSessionMetadata(session.id);
      if (sessionMetadata) this.sessionMetadata.set(session.id, sessionMetadata);
      else this.sessionMetadata.delete(session.id);
      const computed = computeStatus({ session, tmux: { exists }, heartbeat, now });
      const updated = applyComputedStatus(session, computed, now, heartbeat);
      sessions.push(updated);
    }
    const updatedById = new Map(sessions.map((session) => [session.id, session]));
    this.registry = await updateRegistry((latest) => ({
      ...latest,
      sessions: latest.sessions.flatMap((session) => {
        if (prunedIds.has(session.id)) return [];
        return [updatedById.get(session.id) ?? session];
      }),
    }));
    this.selectedId = keepSelection(this.registry.sessions, this.selectedId);
  }

  async refreshPreview(lines = 160): Promise<void> {
    const selected = this.selected();
    if (!selected || selected.status === "stopped" || selected.status === "error") {
      this.preview = "";
      return;
    }
    this.preview = await capturePane(selected.tmuxSession, lines, { preserveStyles: true });
  }

  snapshot(): SessionsSnapshot {
    return { registry: this.registry, sessions: this.sessionsWithMetadata(), selectedId: this.selectedId, preview: this.preview, filter: this.filter };
  }

  async save(): Promise<void> {
    await saveRegistry(this.registry);
  }

  move(delta: number): void {
    const sessions = this.visibleSessions();
    if (!sessions.length) {
      this.selectedId = undefined;
      return;
    }
    const index = Math.max(0, sessions.findIndex((session) => session.id === this.selectedId));
    const next = (index + delta + sessions.length) % sessions.length;
    this.selectedId = sessions[next]?.id;
  }

  setFilter(filter: string | undefined): void {
    this.filter = filter?.trim() || undefined;
    this.selectedId = keepSelection(this.visibleSessions(), this.selectedId);
  }

  async acknowledgeSelected(now = Date.now()): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    this.registry = {
      ...this.registry,
      sessions: this.registry.sessions.map((session) => session.id === selected.id ? markAcknowledged(session, now) : session),
    };
    await saveRegistry(this.registry);
  }

  async moveSessionToGroup(id: string, group: string, now = Date.now()): Promise<void> {
    const normalized = normalizeGroup(group);
    const selected = this.registry.sessions.find((session) => session.id === id);
    const order = selected && selected.group !== normalized ? nextOrderInGroup(this.registry.sessions, normalized) : selected?.order;
    this.registry = {
      ...this.registry,
      sessions: this.registry.sessions.map((session) => {
        if (session.id === id) return { ...session, group: normalized, order, updatedAt: now };
        if (selected && !isSubagentSession(selected) && session.parentId === id) return { ...session, group: normalized, updatedAt: now };
        return session;
      }),
    };
    await saveRegistry(this.registry);
  }

  async reorderSelected(delta: -1 | 1): Promise<void> {
    if (this.filter) return;
    const selected = this.selected();
    if (!selected || isSubagentSession(selected)) return;
    const group = orderedSessions(this.registry.sessions).filter((session) => session.group === selected.group && !isSubagentSession(session));
    const index = group.findIndex((session) => session.id === selected.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= group.length) return;
    const ids = group.map((session) => session.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    this.registry = { ...this.registry, sessions: assignGroupOrder(this.registry.sessions, ids, selected.group) };
    await saveRegistry(this.registry);
  }

  async renameSession(id: string, title: string, now = Date.now()): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) throw new Error("title is required");
    this.registry = {
      ...this.registry,
      sessions: this.registry.sessions.map((session) => session.id === id ? { ...session, title: trimmed, updatedAt: now } : session),
    };
    await saveRegistry(this.registry);
  }

  async syncPiName(id: string, now = Date.now()): Promise<SyncPiNameResult> {
    const selected = this.registry.sessions.find((session) => session.id === id);
    if (!selected?.sessionFile) return { status: "unavailable" };
    let name: string | undefined;
    try {
      name = await readPiSessionName(selected.sessionFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "unavailable" };
      throw error;
    }
    if (!name) return { status: "unnamed" };
    this.registry = {
      ...this.registry,
      sessions: this.registry.sessions.map((session) => session.id === id ? { ...session, title: name, updatedAt: now } : session),
    };
    await saveRegistry(this.registry);
    return { status: "synced", name };
  }

  async renameGroup(from: string, to: string): Promise<void> {
    this.registry = renameRegistryGroup(this.registry, from, to);
    await saveRegistry(this.registry);
  }

  removeSession(id: string): void {
    const before = this.visibleSessions();
    const oldIndex = before.findIndex((session) => session.id === id);
    const wasSelected = this.selectedId === id;
    const ids = sessionCascadeIds(this.registry.sessions, id);
    this.registry = { ...this.registry, sessions: this.registry.sessions.filter((session) => !ids.has(session.id)) };
    const after = this.visibleSessions();
    this.selectedId = wasSelected ? after[Math.min(oldIndex, after.length - 1)]?.id : keepSelection(after, this.selectedId);
    if (wasSelected) this.preview = "";
  }

  selectSession(id: string): boolean {
    if (!this.visibleSessions().some((session) => session.id === id)) return false;
    this.selectedId = id;
    return true;
  }

  selected(): RuntimeSession | undefined {
    if (!this.selectedId) return undefined;
    return this.visibleSessions().find((session) => session.id === this.selectedId);
  }

  private visibleSessions(): RuntimeSession[] {
    return visibleSessions(this.sessionsWithMetadata(), this.filter);
  }

  private sessionsWithMetadata(): RuntimeSession[] {
    return this.registry.sessions.map((session) => {
      const metadata = this.sessionMetadata.get(session.id);
      return metadata ? { ...session, sessionMetadata: metadata } : session;
    });
  }
}

function keepSelection(sessions: RuntimeSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function visibleSessions(sessions: RuntimeSession[], filter: string | undefined): RuntimeSession[] {
  return orderedSessionRows(sessions, filter);
}
