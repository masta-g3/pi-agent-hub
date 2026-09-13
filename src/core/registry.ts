import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { loadStore, updateStore, type JsonStore } from "./atomic-json.js";
import { multiRepoWorkspaceDir, normalizeAdditionalCwds } from "./multi-repo.js";
import { MANAGED_SESSION_PREFIX } from "./names.js";
import { registryPath } from "./paths.js";
import { nextUpdatedAt } from "./session-version.js";
import { parseForkPreparation } from "./fork-preparation.js";
import type { SessionsRegistry, ManagedSession } from "./types.js";

export const emptyRegistry = (): SessionsRegistry => ({ version: 1, sessions: [] });

function registryStore(path: string): JsonStore<SessionsRegistry> {
  return {
    path,
    empty: emptyRegistry,
    parse: (registry) => {
      if (registry.version !== 1 || !Array.isArray(registry.sessions)) {
        throw new Error(`Unsupported registry format: ${path}`);
      }
      return {
        ...registry,
        sessions: registry.sessions.map((session) => {
          if (!session || typeof session !== "object") return session;
          const { forkPreparation: rawPreparation, ...rest } = session as ManagedSession;
          const forkPreparation = parseForkPreparation(rawPreparation);
          if (rawPreparation !== undefined && !forkPreparation) throw new Error(`Invalid fork preparation for session ${session.id}`);
          return { ...rest, ...(forkPreparation ? { forkPreparation } : {}) };
        }),
      } as SessionsRegistry;
    },
    snapshot: (registry) => JSON.stringify(registry),
  };
}

export async function loadRegistry(path = registryPath()): Promise<SessionsRegistry> {
  return loadStore(registryStore(path));
}

export async function updateRegistry(
  mutate: (registry: SessionsRegistry) => SessionsRegistry | void,
  path = registryPath(),
): Promise<SessionsRegistry> {
  return updateStore(registryStore(path), mutate);
}

export interface NewSessionInput {
  cwd: string;
  group?: string;
  additionalCwds?: string[];
  now?: number;
}

export function createSessionRecord(input: NewSessionInput): ManagedSession {
  const now = input.now ?? Date.now();
  const cwd = resolve(input.cwd);
  const id = randomUUID();
  const title = provisionalSessionTitle(cwd);
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

export function provisionalSessionTitle(cwd: string): string {
  return `New · ${basename(resolve(cwd)) || "pi-session"}`;
}

export function availableSessionTitle(base: string, sessions: readonly Pick<ManagedSession, "title">[]): string {
  const titles = new Set(sessions.map((session) => session.title));
  let title = base;
  for (let suffix = 2; titles.has(title); suffix += 1) title = `${base} · ${suffix}`;
  return title;
}

export function normalizeGroup(group: string | undefined): string {
  const value = group?.trim() || "default";
  if (value.includes("/")) throw new Error("Group names are flat labels; '/' is not supported");
  return value;
}

export function tmuxSessionName(id: string): string {
  return `${MANAGED_SESSION_PREFIX}${id.slice(0, 12)}`;
}

export function renameGroup(registry: SessionsRegistry, from: string, to: string, now = Date.now()): SessionsRegistry {
  const group = normalizeGroup(to);
  if (group === from) return registry;
  return {
    ...registry,
    sessions: registry.sessions.map((session) =>
      session.group === from ? { ...session, group, updatedAt: nextUpdatedAt(session.updatedAt, now) } : session,
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
