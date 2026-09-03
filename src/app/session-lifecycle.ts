import { constants } from "node:fs";
import { access, rm, unlink } from "node:fs/promises";
import { FORK_COMPACT_ENV, PRIMARY_CWD_ENV, SESSION_ID_ENV, STATE_ENV, SUBAGENT_PROMPT_APPEND_ENV, WORKTREE_GUIDANCE_ENV } from "../core/names.js";
import { resolve } from "node:path";
import { effectiveSessionPrelude } from "../core/config.js";
import { buildPiArgs } from "../core/pi-process.js";
import { extensionPath } from "../core/extension-path.js";
import { isErrno } from "../core/atomic-json.js";
import { effectiveSessionCwd, ensureMultiRepoWorkspace, removeMultiRepoWorkspace } from "../core/multi-repo.js";
import { heartbeatPath, registryPath, sessionsStateDir } from "../core/paths.js";
import { readHeartbeat } from "../core/heartbeat.js";
import { assertWorktreesClean, assertWorktreesReady, createOwnedWorktrees, finishOwnedWorktrees, isWorktreeSession, PartialWorktreeFailure, remainingWorktreeSession, removeOwnedWorktrees, sessionWorktrees, type FinishedWorktree } from "../core/worktree.js";
import { renderWorktreeGuidance } from "../core/worktree-context.js";
import { recordRepoUsage } from "../core/repo-history.js";
import { createSessionRecord, loadRegistry, provisionalSessionTitle, updateRegistry, upsertSession } from "../core/registry.js";
import { nextUpdatedAt } from "../core/session-version.js";
import { nextOrderInGroup } from "../core/session-order.js";
import { isSubagentSession, sessionCascadeIds } from "../core/session-tree.js";
import { configureManagedSessionStatusBar, killSession, newSession, sessionExists, shellQuote } from "../core/tmux.js";
import { loadManagedSessionTheme } from "../tui/theme.js";
import type { ManagedSession, ManagedWorktree } from "../core/types.js";

export interface SessionInput {
  cwd: string;
  group?: string;
  additionalCwds?: string[];
  worktree?: { branch: string };
}

export interface ForkInput {
  group?: string;
  compact?: boolean;
}

const FORK_COMPACT_TIMEOUT_MS = 15_000;
const FORK_COMPACT_POLL_MS = 50;

async function addManagedSessionImpl(input: SessionInput): Promise<ManagedSession> {
  const originalCwd = resolve(input.cwd);
  const originalAdditionalCwds = input.additionalCwds ?? [];
  let record = createSessionRecord({ cwd: originalCwd, group: input.group, additionalCwds: input.additionalCwds });
  try {
    if (input.worktree) {
      const created = await createOwnedWorktrees({ cwds: [record.cwd, ...(record.additionalCwds ?? [])], sessionId: record.id, branch: input.worktree.branch });
      const primary = created.primary;
      record = {
        ...record,
        cwd: created.cwd,
        additionalCwds: created.additionalCwds,
        worktreePath: primary.worktreePath,
        worktreeRepoRoot: primary.worktreeRepoRoot,
        worktreeBranch: primary.worktreeBranch,
        worktreeBaseBranch: primary.worktreeBaseBranch,
        worktreeOwnedByHub: true,
        worktrees: created.worktrees,
      };
      record = await ensureMultiRepoWorkspace(record);
    } else {
      record = await ensureMultiRepoWorkspace(record);
    }
    await updateRegistry((registry) => {
      record.order = nextOrderInGroup(registry.sessions, record.group);
      return { ...registry, sessions: [...registry.sessions, record] };
    });
    await startManagedSessionImpl(record.id);
  } catch (error) {
    const rollbackError = await rollbackStartedRecord(record).catch((cleanupError: unknown) => cleanupError);
    if (rollbackError) throw new Error(`${errorMessage(error)}; rollback failed: ${errorMessage(rollbackError)}`);
    throw error;
  }
  try {
    const historyCwds = input.worktree ? [originalCwd, ...originalAdditionalCwds] : [record.cwd, ...(record.additionalCwds ?? [])];
    await recordRepoUsage(historyCwds);
  } catch {
    // Repo history is a convenience cache; session creation already succeeded.
  }
  return record;
}

async function startManagedSessionImpl(
  id: string,
  materializeWorkspace: (session: ManagedSession) => Promise<ManagedSession> = ensureMultiRepoWorkspace,
): Promise<void> {
  const registry = await loadRegistry();
  let session = findSession(registry, id);
  if (isSubagentSession(session)) throw new Error(`Cannot start subagent row: ${session.title}`);
  if (await sessionExists(session.tmuxSession)) {
    await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: await loadManagedSessionTheme(session) });
    return;
  }
  const prepared = await materializeWorkspace(session);
  const committed = await updateRegistry((latest) => {
    const current = latest.sessions.find((item) => item.id === session.id);
    if (!current || isSubagentSession(current) || !sameWorkspaceIdentity(current, session)) {
      throw new Error("Session changed while starting; retry");
    }
    if (sameWorkspaceIdentity(current, prepared) && current.workspaceCwd === prepared.workspaceCwd) return latest;
    return upsertSession(latest, {
      ...current,
      cwd: prepared.cwd,
      additionalCwds: prepared.additionalCwds,
      workspaceCwd: prepared.workspaceCwd,
      updatedAt: nextUpdatedAt(current.updatedAt),
    });
  });
  session = findSession(committed, session.id);
  const piArgs = buildPiArgs({ extensionPath: extensionPath(), sessionFile: session.sessionFile });
  const worktreeGuidance = renderWorktreeGuidance(session);
  await newSession({
    name: session.tmuxSession,
    cwd: effectiveSessionCwd(session),
    command: managedPiCommand({ piArgs, prelude: await effectiveSessionPrelude() }),
    env: {
      [SESSION_ID_ENV]: session.id,
      [STATE_ENV]: sessionsStateDir(),
      [PRIMARY_CWD_ENV]: session.cwd,
      ...(worktreeGuidance ? {
        [WORKTREE_GUIDANCE_ENV]: worktreeGuidance,
        [SUBAGENT_PROMPT_APPEND_ENV]: worktreeGuidance,
      } : {}),
    },
  });
  await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: await loadManagedSessionTheme(session) });
}

async function stopManagedSessionImpl(id: string): Promise<void> {
  const registry = await loadRegistry();
  const session = findSession(registry, id);
  if (isSubagentSession(session)) throw new Error(`Cannot stop subagent row: ${session.title}`);
  if (await sessionExists(session.tmuxSession)) await killSession(session.tmuxSession);
  await updateRegistry((latest) => {
    const latestSession = findSession(latest, id);
    if (isSubagentSession(latestSession)) throw new Error(`Cannot stop subagent row: ${latestSession.title}`);
    if (latestSession.status === "stopped") return latest;
    return { ...latest, sessions: latest.sessions.map((item) => item.id === latestSession.id ? { ...item, status: "stopped", updatedAt: nextUpdatedAt(item.updatedAt) } : item) };
  });
}

async function restartManagedSessionImpl(id: string): Promise<void> {
  await stopManagedSessionImpl(id);
  await updateRegistry((registry) => {
    const session = findSession(registry, id);
    if (session.status === "starting") return registry;
    return { ...registry, sessions: registry.sessions.map((item) => item.id === session.id ? { ...item, status: "starting", updatedAt: nextUpdatedAt(item.updatedAt) } : item) };
  });
  await startManagedSessionImpl(id);
}

async function restartManagedSessionFreshImpl(id: string): Promise<void> {
  await stopManagedSessionImpl(id);
  await rm(heartbeatPath(id), { force: true });
  await updateRegistry((registry) => {
    const session = findSession(registry, id);
    return {
      ...registry,
      sessions: registry.sessions.map((item) => item.id === session.id ? {
        ...item,
        title: provisionalSessionTitle(session.worktrees?.find((worktree) => worktree.role === "primary")?.repoRoot ?? session.worktreeRepoRoot ?? session.cwd),
        status: "starting",
        sessionFile: undefined,
        piSessionId: undefined,
        acknowledgedAt: undefined,
        error: undefined,
        activeTheme: undefined,
        updatedAt: nextUpdatedAt(item.updatedAt),
      } : item),
    };
  });
  await startManagedSessionImpl(id);
}

async function forkManagedSessionImpl(sourceId: string, input: ForkInput = {}): Promise<ManagedSession> {
  const registry = await loadRegistry();
  const source = findSession(registry, sourceId);
  if (isSubagentSession(source)) throw new Error(`Cannot fork subagent row: ${source.title}`);
  if (isWorktreeSession(source)) throw new Error("Cannot fork worktree sessions in v1");
  const sourceFile = await savedSessionFile(source);
  let record = createSessionRecord({
    cwd: source.cwd,
    group: input.group ?? source.group,
    additionalCwds: source.additionalCwds,
  });
  record = await ensureMultiRepoWorkspace(record);
  await updateRegistry((latest) => {
    const latestSource = findSession(latest, sourceId);
    if (isSubagentSession(latestSource)) throw new Error(`Cannot fork subagent row: ${latestSource.title}`);
    record.order = nextOrderInGroup(latest.sessions, record.group);
    return { ...latest, sessions: [...latest.sessions, record] };
  });
  const piArgs = buildPiArgs({ extensionPath: extensionPath(), forkFrom: sourceFile });
  await newSession({
    name: record.tmuxSession,
    cwd: effectiveSessionCwd(record),
    command: managedPiCommand({ piArgs, prelude: await effectiveSessionPrelude() }),
    env: {
      [SESSION_ID_ENV]: record.id,
      [STATE_ENV]: sessionsStateDir(),
      [PRIMARY_CWD_ENV]: record.cwd,
      ...(input.compact ? { [FORK_COMPACT_ENV]: "1" } : {}),
    },
  });
  await configureManagedSessionStatusBar({ name: record.tmuxSession, title: record.title, cwd: record.cwd, theme: await loadManagedSessionTheme(record) });
  if (input.compact) await waitForForkCompaction(record.id);
  return record;
}

async function waitForForkCompaction(sessionId: string): Promise<void> {
  const deadline = Date.now() + FORK_COMPACT_TIMEOUT_MS;
  let phase: string | undefined;
  while (Date.now() < deadline) {
    const heartbeat = await readHeartbeat(sessionId);
    const operation = heartbeat?.operation;
    phase = operation?.phase;
    if (operation?.kind === "fork-compact") {
      if (operation.phase === "error") throw new Error(`fork compaction failed for ${sessionId}`);
      if (operation.phase === "complete") return;
    }
    await new Promise((resolve) => setTimeout(resolve, FORK_COMPACT_POLL_MS));
  }
  throw new Error(`fork compaction timed out for ${sessionId} (last phase: ${phase ?? "none"})`);
}

async function rollbackStartedRecord(record: ManagedSession): Promise<void> {
  const errors: unknown[] = [];
  try {
    if (await sessionExists(record.tmuxSession)) await killSession(record.tmuxSession);
  } catch (error) {
    errors.push(error);
  }
  try {
    await updateRegistry((registry) => ({ ...registry, sessions: registry.sessions.filter((session) => session.id !== record.id) }));
  } catch (error) {
    errors.push(error);
  }
  try {
    await removeMultiRepoWorkspace(record);
  } catch (error) {
    errors.push(error);
  }
  if (isWorktreeSession(record) && record.worktreeOwnedByHub) {
    try {
      await removeOwnedWorktrees(record);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new Error(errors.map(errorMessage).join("; "));
}

async function savedSessionFile(source: ManagedSession): Promise<string> {
  if (!source.sessionFile) throw new Error(`Cannot fork ${source.title}: Pi session history is not saved yet`);
  try {
    await access(source.sessionFile, constants.R_OK);
    return source.sessionFile;
  } catch {
    throw new Error(`Cannot fork ${source.title}: Pi session history is not saved yet`);
  }
}

function findSession(registry: Parameters<typeof resolveSession>[0], id: string | undefined) {
  return resolveSession(registry, id) as ReturnType<typeof resolveSession> & { sessionFile?: string; status: string; updatedAt: number };
}

function sameWorkspaceIdentity(a: ManagedSession, b: ManagedSession): boolean {
  return a.tmuxSession === b.tmuxSession
    && a.cwd === b.cwd
    && equalStrings(a.additionalCwds, b.additionalCwds)
    && a.worktreeOwnedByHub === b.worktreeOwnedByHub
    && a.worktreePath === b.worktreePath
    && a.worktreeRepoRoot === b.worktreeRepoRoot
    && a.worktreeBranch === b.worktreeBranch
    && a.worktreeBaseBranch === b.worktreeBaseBranch
    && equalWorktrees(a.worktrees, b.worktrees);
}

function equalStrings(a: string[] | undefined, b: string[] | undefined): boolean {
  return (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((value, index) => value === b?.[index]);
}

function equalWorktrees(a: ManagedWorktree[] | undefined, b: ManagedWorktree[] | undefined): boolean {
  return (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((worktree, index) => {
    const other = b?.[index];
    return other !== undefined
      && worktree.path === other.path
      && worktree.repoRoot === other.repoRoot
      && worktree.branch === other.branch
      && worktree.baseBranch === other.baseBranch
      && worktree.role === other.role;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

async function deleteManagedSessionImpl(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSession> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  await removeSessions(sessions, path, env);
  return { id: session.id, title: session.title };
}

async function deleteManagedSubagentSessionsImpl(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSubagentSessions> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const registry = await loadRegistry(path);
  const session = resolveSession(registry, id);
  const ids = sessionCascadeIds(registry.sessions, session.id);
  ids.delete(session.id);
  const sessions = registry.sessions.filter((item) => ids.has(item.id));
  await removeSessions(sessions, path, env);
  return { id: session.id, title: session.title, count: sessions.length };
}

export function resolveSession(registry: import("../core/types.js").SessionsRegistry, id: string | undefined): ManagedSession {
  if (!id) throw new Error("Missing session id");
  const session = registry.sessions.find((item) => item.id === id || item.id.startsWith(id));
  if (!session) throw new Error(`Unknown session: ${id}`);
  return session;
}

export async function removeSessions(sessions: ManagedSession[], path: string, env: NodeJS.ProcessEnv): Promise<void> {
  const ids = new Set(sessions.map((session) => session.id));
  for (const item of sessions) if (await sessionExists(item.tmuxSession)) await killSession(item.tmuxSession);
  for (const item of sessions) await removeMultiRepoWorkspace(item, env);
  await updateRegistry((latest) => ({ ...latest, sessions: latest.sessions.filter((item) => !ids.has(item.id)) }), path);
  for (const item of sessions) {
    await unlink(heartbeatPath(item.id, env)).catch((error: unknown) => {
      if (!isErrno(error, "ENOENT")) throw error;
    });
  }
}

async function finishWorktreeSessionImpl(id: string, options: FinishWorktreeSessionOptions = {}): Promise<FinishedWorktreeSession> {
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
    await removeSessions(sessions, path, env);
    const primary = sessionWorktrees(session)[0]!;
    return { id: session.id, title: session.title, branch: primary.branch, baseBranch: primary.baseBranch, worktreePath: primary.path, branchDeleted: true, count: finished.finished.length };
  } catch (error) {
    if (error instanceof PartialWorktreeFailure) {
      await updateRegistry((latest) => {
        const current = latest.sessions.find((item) => item.id === session.id);
        return current ? upsertSession(latest, remainingWorktreeSession(current, error.finished)) : latest;
      }, path);
    }
    throw error;
  }
}

async function discardWorktreeSessionImpl(id: string, options: FinishWorktreeSessionOptions = {}): Promise<DiscardedWorktreeSession> {
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
    await removeSessions(sessions, path, env);
    const primary = worktrees[0]!;
    return { id: session.id, title: session.title, branch: primary.branch, worktreePath: primary.path, count: removed.length };
  } catch (error) {
    if (error instanceof PartialWorktreeFailure) {
      await updateRegistry((latest) => {
        const current = latest.sessions.find((item) => item.id === session.id);
        return current ? upsertSession(latest, remainingWorktreeSession(current, error.finished)) : latest;
      }, path);
    }
    throw error;
  }
}

export function managedPiCommand(input: { piArgs: string[]; prelude?: string; shell?: string }): string {
  const piCommand = `pi ${input.piArgs.map(shellQuote).join(" ")}`;
  const prelude = input.prelude?.trim();
  if (!prelude) return piCommand;
  const shell = input.shell || process.env.SHELL || "/bin/sh";
  const script = [
    prelude,
    "__pi_agent_hub_prelude_status=$?",
    "if [ $__pi_agent_hub_prelude_status -ne 0 ]; then exit $__pi_agent_hub_prelude_status; fi",
    `exec ${piCommand}`,
  ].join("\n");
  return `${shellQuote(shell)} -lc ${shellQuote(script)}`;
}

export async function addManagedSession(input: SessionInput): Promise<ManagedSession> {
  return withLifecycleContext("add managed session", input.cwd, () => addManagedSessionImpl(input));
}

export async function startManagedSession(
  id: string,
  materializeWorkspace: (session: ManagedSession) => Promise<ManagedSession> = ensureMultiRepoWorkspace,
): Promise<void> {
  return withLifecycleContext("start managed session", id, () => startManagedSessionImpl(id, materializeWorkspace));
}

export async function stopManagedSession(id: string): Promise<void> {
  return withLifecycleContext("stop managed session", id, () => stopManagedSessionImpl(id));
}

export async function restartManagedSession(id: string): Promise<void> {
  return withLifecycleContext("restart managed session", id, () => restartManagedSessionImpl(id));
}

export async function restartManagedSessionFresh(id: string): Promise<void> {
  return withLifecycleContext("restart managed session fresh", id, () => restartManagedSessionFreshImpl(id));
}

export async function forkManagedSession(sourceId: string, input: ForkInput = {}): Promise<ManagedSession> {
  return withLifecycleContext("fork managed session", sourceId, () => forkManagedSessionImpl(sourceId, input));
}

export async function deleteManagedSession(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSession> {
  return withLifecycleContext("delete managed session", id, () => deleteManagedSessionImpl(id, options));
}

export async function deleteManagedSubagentSessions(id: string, options: DeleteManagedSessionOptions = {}): Promise<DeletedSubagentSessions> {
  return withLifecycleContext("delete managed subagents", id, () => deleteManagedSubagentSessionsImpl(id, options));
}

export async function finishWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<FinishedWorktreeSession> {
  return withLifecycleContext("finish worktree session", id, () => finishWorktreeSessionImpl(id, options));
}

export async function discardWorktreeSession(id: string, options: FinishWorktreeSessionOptions = {}): Promise<DiscardedWorktreeSession> {
  return withLifecycleContext("discard worktree session", id, () => discardWorktreeSessionImpl(id, options));
}

async function withLifecycleContext<T>(operation: string, target: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw contextualizeLifecycleError(operation, target, error);
  }
}

function contextualizeLifecycleError(operation: string, target: string, error: unknown): Error {
  const message = `${operation} ${target}: ${errorMessage(error)}`;
  if (error instanceof PartialWorktreeFailure) return new PartialWorktreeFailure(message, error.finished, error.remaining);
  return new Error(message, { cause: error });
}
