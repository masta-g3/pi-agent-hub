import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { readJsonOr, writeJsonAtomic } from "./atomic-json.js";
import { multiRepoWorkspaceDir, normalizeAdditionalCwds } from "./multi-repo.js";
import { registryPath } from "./paths.js";
import type { SessionsRegistry, ManagedSession } from "./types.js";

export const emptyRegistry = (): SessionsRegistry => ({ version: 1, sessions: [] });

export async function loadRegistry(path = registryPath()): Promise<SessionsRegistry> {
  const registry = await readJsonOr<SessionsRegistry>(path, emptyRegistry());
  if (registry.version !== 1 || !Array.isArray(registry.sessions)) {
    throw new Error(`Unsupported registry format: ${path}`);
  }
  return registry;
}

export async function saveRegistry(registry: SessionsRegistry, path = registryPath()): Promise<void> {
  await writeJsonAtomic(path, registry);
}

export async function updateRegistry(
  mutate: (registry: SessionsRegistry) => SessionsRegistry | void,
  path = registryPath(),
): Promise<SessionsRegistry> {
  const registry = await loadRegistry(path);
  const next = mutate(registry) ?? registry;
  await saveRegistry(next, path);
  return next;
}

export interface NewSessionInput {
  cwd: string;
  title?: string;
  group?: string;
  additionalCwds?: string[];
  now?: number;
}

export function createSessionRecord(input: NewSessionInput): ManagedSession {
  const now = input.now ?? Date.now();
  const cwd = resolve(input.cwd);
  const id = randomUUID();
  const title = input.title?.trim() || basename(cwd) || "pi-session";
  const additionalCwds = normalizeAdditionalCwds(cwd, input.additionalCwds);
  return {
    id,
    title,
    cwd,
    ...(additionalCwds.length ? { additionalCwds, workspaceCwd: multiRepoWorkspaceDir(id) } : {}),
    group: normalizeGroup(input.group),
    tmuxSession: tmuxSessionName(id),
    status: "starting",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeGroup(group: string | undefined): string {
  const value = group?.trim() || "default";
  if (value.includes("/")) throw new Error("Group names are flat labels; '/' is not supported");
  return value;
}

export function tmuxSessionName(id: string): string {
  return `pi-sessions-${id.slice(0, 12)}`;
}

export function renameGroup(registry: SessionsRegistry, from: string, to: string): SessionsRegistry {
  const group = normalizeGroup(to);
  return {
    ...registry,
    sessions: registry.sessions.map((session) =>
      session.group === from ? { ...session, group, updatedAt: Date.now() } : session,
    ),
  };
}

export function upsertSession(registry: SessionsRegistry, session: ManagedSession): SessionsRegistry {
  const index = registry.sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return { ...registry, sessions: [...registry.sessions, session] };
  const sessions = registry.sessions.slice();
  sessions[index] = session;
  return { ...registry, sessions };
}

export function removeSession(registry: SessionsRegistry, id: string): { registry: SessionsRegistry; removed: ManagedSession } {
  const index = registry.sessions.findIndex((session) => session.id === id);
  if (index === -1) throw new Error(`Unknown session: ${id}`);
  const sessions = registry.sessions.slice();
  const [removed] = sessions.splice(index, 1);
  if (!removed) throw new Error(`Unknown session: ${id}`);
  return { registry: { ...registry, sessions }, removed };
}
