import { loadRegistry, saveRegistry } from "../core/registry.js";
import { applyComputedStatus, computeStatus, markAcknowledged, readHeartbeat } from "../core/status.js";
import { capturePane, sessionExists } from "../core/tmux.js";
import type { SessionsRegistry, ManagedSession } from "../core/types.js";

export interface SessionsSnapshot {
  registry: SessionsRegistry;
  selectedId?: string;
  preview: string;
  filter?: string;
}

export class SessionsController {
  private registry: SessionsRegistry;
  private selectedId: string | undefined;
  private preview = "";
  private filter: string | undefined;

  constructor(registry: SessionsRegistry = { version: 1, sessions: [] }) {
    this.registry = registry;
    this.selectedId = registry.sessions[0]?.id;
  }

  async refresh(now = Date.now()): Promise<void> {
    this.registry = await loadRegistry();
    this.selectedId = keepSelection(this.registry.sessions, this.selectedId);
    const sessions: ManagedSession[] = [];
    for (const session of this.registry.sessions) {
      const exists = await sessionExists(session.tmuxSession);
      const heartbeat = await readHeartbeat(session.id);
      const computed = computeStatus({ session, tmux: { exists }, heartbeat, now });
      const updated = applyComputedStatus(session, computed, now, heartbeat);
      sessions.push(updated);
    }
    this.registry = { ...this.registry, sessions };
    await saveRegistry(this.registry);
  }

  async refreshPreview(lines = 160): Promise<void> {
    const selected = this.selected();
    if (!selected || selected.status === "stopped" || selected.status === "error") {
      this.preview = "";
      return;
    }
    this.preview = await capturePane(selected.tmuxSession, lines);
  }

  snapshot(): SessionsSnapshot {
    return { registry: this.registry, selectedId: this.selectedId, preview: this.preview, filter: this.filter };
  }

  async save(): Promise<void> {
    await saveRegistry(this.registry);
  }

  move(delta: number): void {
    const sessions = visibleSessions(this.registry.sessions, this.filter);
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
    this.selectedId = keepSelection(visibleSessions(this.registry.sessions, this.filter), this.selectedId);
  }

  acknowledgeSelected(now = Date.now()): void {
    const selected = this.selected();
    if (!selected) return;
    this.registry = {
      ...this.registry,
      sessions: this.registry.sessions.map((session) => session.id === selected.id ? markAcknowledged(session, now) : session),
    };
    void saveRegistry(this.registry);
  }

  removeSession(id: string): void {
    const before = visibleSessions(this.registry.sessions, this.filter);
    const oldIndex = before.findIndex((session) => session.id === id);
    const wasSelected = this.selectedId === id;
    this.registry = { ...this.registry, sessions: this.registry.sessions.filter((session) => session.id !== id) };
    const after = visibleSessions(this.registry.sessions, this.filter);
    this.selectedId = wasSelected ? after[Math.min(oldIndex, after.length - 1)]?.id : keepSelection(after, this.selectedId);
    if (wasSelected) this.preview = "";
  }

  selected(): ManagedSession | undefined {
    if (!this.selectedId) return undefined;
    return visibleSessions(this.registry.sessions, this.filter).find((session) => session.id === this.selectedId);
  }
}

function keepSelection(sessions: ManagedSession[], selectedId: string | undefined): string | undefined {
  if (!sessions.length) return undefined;
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId;
  return sessions[0]?.id;
}

function visibleSessions(sessions: ManagedSession[], filter: string | undefined): ManagedSession[] {
  if (!filter) return sessions;
  const value = filter.toLowerCase();
  return sessions.filter((session) => [session.title, session.group, basename(session.cwd), session.status].some((text) => text.toLowerCase().includes(value)));
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
