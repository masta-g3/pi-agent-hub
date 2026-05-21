import { finishOwnedWorktree, hasUncommittedChanges, isWorktreeSession, removeOwnedWorktree, type FinishedWorktree } from "../core/worktree.js";
import { registryPath } from "../core/paths.js";
import { loadRegistry } from "../core/registry.js";
import { sessionCascadeIds, isSubagentSession } from "../core/session-tree.js";
import { killSession, sessionExists } from "../core/tmux.js";
import { removeSessions, resolveSession } from "./delete-session.js";

export interface FinishWorktreeSessionOptions {
  env?: NodeJS.ProcessEnv;
}

export interface FinishedWorktreeSession extends FinishedWorktree {
  id: string;
  title: string;
}

export interface DiscardedWorktreeSession {
  id: string;
  title: string;
  branch: string;
  worktreePath: string;
}

export async function finishWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<FinishedWorktreeSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  if (isSubagentSession(session)) throw new Error("Cannot finish subagent row");
  if (!isWorktreeSession(session) || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");

  await assertFinishReady(session);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  const finished = await finishOwnedWorktree({ session, env });

  await removeSessions(registry, sessions, path, env);
  return { id: session.id, title: session.title, ...finished };
}

export async function discardWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<DiscardedWorktreeSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  if (isSubagentSession(session)) throw new Error("Cannot discard subagent row");
  if (!isWorktreeSession(session) || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");

  await assertWorktreeClean(session);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  await removeOwnedWorktree(session, env);

  await removeSessions(registry, sessions, path, env);
  return { id: session.id, title: session.title, branch: session.worktreeBranch!, worktreePath: session.worktreePath! };
}

async function assertFinishReady(session: ManagedWorktreeSession): Promise<void> {
  await assertWorktreeClean(session);
  if (await hasUncommittedChanges(session.worktreeRepoRoot!)) throw new Error("Base repo has uncommitted changes; clean it before finishing");
}

async function assertWorktreeClean(session: ManagedWorktreeSession): Promise<void> {
  if (await hasUncommittedChanges(session.worktreePath!)) throw new Error("Worktree has uncommitted changes; commit or stash before finishing");
}

type ManagedWorktreeSession = Parameters<typeof finishOwnedWorktree>[0]["session"];
