import { assertWorktreesClean, assertWorktreesReady, finishOwnedWorktrees, isWorktreeSession, PartialWorktreeFailure, remainingWorktreeSession, removeOwnedWorktrees, sessionWorktrees, type FinishedWorktree } from "../core/worktree.js";
import { registryPath } from "../core/paths.js";
import { loadRegistry, saveRegistry, upsertSession } from "../core/registry.js";
import { sessionCascadeIds, isSubagentSession } from "../core/session-tree.js";
import { killSession, sessionExists } from "../core/tmux.js";
import { removeSessions, resolveSession } from "./delete-session.js";

export interface FinishWorktreeSessionOptions {
  env?: NodeJS.ProcessEnv;
}

export interface FinishedWorktreeSession extends FinishedWorktree {
  id: string;
  title: string;
  count?: number;
}

export interface DiscardedWorktreeSession {
  id: string;
  title: string;
  branch: string;
  worktreePath: string;
  count?: number;
}

export async function finishWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<FinishedWorktreeSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  if (isSubagentSession(session)) throw new Error("Cannot finish subagent row");
  if (!isWorktreeSession(session) || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");

  await assertWorktreesReady(session, env);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  try {
    const finished = await finishOwnedWorktrees({ session, env });
    await removeSessions(registry, sessions, path, env);
    const primary = sessionWorktrees(session)[0]!;
    return { id: session.id, title: session.title, branch: primary.branch, baseBranch: primary.baseBranch, worktreePath: primary.path, branchDeleted: true, count: finished.finished.length };
  } catch (error) {
    if (error instanceof PartialWorktreeFailure) {
      await saveRegistry(upsertSession(registry, remainingWorktreeSession(session, error.finished)), path);
    }
    throw error;
  }
}

export async function discardWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<DiscardedWorktreeSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  if (isSubagentSession(session)) throw new Error("Cannot discard subagent row");
  if (!isWorktreeSession(session) || session.worktreeOwnedByHub !== true) throw new Error("Selected session is not a hub-owned worktree");

  await assertWorktreesClean(session, env, "Worktree has uncommitted changes; commit or stash before discarding");
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  const worktrees = sessionWorktrees(session);
  try {
    const removed = await removeOwnedWorktrees(session, env);
    await removeSessions(registry, sessions, path, env);
    const primary = worktrees[0]!;
    return { id: session.id, title: session.title, branch: primary.branch, worktreePath: primary.path, count: removed.length };
  } catch (error) {
    if (error instanceof PartialWorktreeFailure) {
      await saveRegistry(upsertSession(registry, remainingWorktreeSession(session, error.finished)), path);
    }
    throw error;
  }
}
