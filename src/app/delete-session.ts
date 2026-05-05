import { unlink } from "node:fs/promises";
import { removeMultiRepoWorkspace } from "../core/multi-repo.js";
import { heartbeatPath, registryPath } from "../core/paths.js";
import { loadRegistry, removeSession, saveRegistry } from "../core/registry.js";
import { killSession, sessionExists } from "../core/tmux.js";
import type { SessionsRegistry, ManagedSession } from "../core/types.js";

export interface DeleteManagedSessionOptions {
  env?: NodeJS.ProcessEnv;
}

export interface DeletedSession {
  id: string;
  title: string;
}

export async function deleteManagedSession(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  if (await sessionExists(session.tmuxSession)) await killSession(session.tmuxSession);
  await removeMultiRepoWorkspace(session, env);
  const result = removeSession(registry, session.id);
  await saveRegistry(result.registry, path);
  await unlink(heartbeatPath(session.id, env)).catch((error: unknown) => {
    if (!isNotFound(error)) throw error;
  });
  return { id: session.id, title: session.title };
}

export function resolveSession(registry: SessionsRegistry, id: string | undefined): ManagedSession {
  if (!id) throw new Error("Missing session id");
  const session = registry.sessions.find((item) => item.id === id || item.id.startsWith(id));
  if (!session) throw new Error(`Unknown session: ${id}`);
  return session;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
