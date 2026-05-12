import { unlink } from "node:fs/promises";
import { removeMultiRepoWorkspace } from "../core/multi-repo.js";
import { heartbeatPath, registryPath } from "../core/paths.js";
import { loadRegistry, saveRegistry } from "../core/registry.js";
import { sessionCascadeIds } from "../core/session-tree.js";
import { killSession, sessionExists } from "../core/tmux.js";
import type { SessionsRegistry, ManagedSession } from "../core/types.js";

export interface DeleteManagedSessionOptions {
  env?: NodeJS.ProcessEnv;
}

export interface DeletedSession {
  id: string;
  title: string;
}

export interface DeletedSubagentSessions extends DeletedSession {
  count: number;
}

export async function deleteManagedSession(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  await removeSessions(registry, sessions, path, env);
  return { id: session.id, title: session.title };
}

export async function deleteManagedSubagentSessions(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSubagentSessions> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  ids.delete(session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  await removeSessions(registry, sessions, path, env);
  return { id: session.id, title: session.title, count: sessions.length };
}

export function resolveSession(registry: SessionsRegistry, id: string | undefined): ManagedSession {
  if (!id) throw new Error("Missing session id");
  const session = registry.sessions.find((item) => item.id === id || item.id.startsWith(id));
  if (!session) throw new Error(`Unknown session: ${id}`);
  return session;
}

async function removeSessions(registry: SessionsRegistry, sessions: ManagedSession[], path: string, env: NodeJS.ProcessEnv): Promise<void> {
  const ids = new Set(sessions.map((session) => session.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  for (const item of sessions) await removeMultiRepoWorkspace(item, env);
  await saveRegistry({ ...registry, sessions: registry.sessions.filter((item) => !ids.has(item.id)) }, path);
  for (const item of sessions) {
    await unlink(heartbeatPath(item.id, env)).catch((error: unknown) => {
      if (!isNotFound(error)) throw error;
    });
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
