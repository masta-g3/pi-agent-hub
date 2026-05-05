import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPiArgs } from "../core/pi-process.js";
import { extensionPath } from "../core/extension-path.js";
import { effectiveSessionCwd, ensureMultiRepoWorkspace } from "../core/multi-repo.js";
import { sessionsStateDir } from "../core/paths.js";
import { createSessionRecord, loadRegistry, saveRegistry, upsertSession } from "../core/registry.js";
import { nextOrderInGroup } from "../core/session-order.js";
import { configureManagedSessionStatusBar, killSession, newSession, sessionExists } from "../core/tmux.js";
import { resolveSession } from "./delete-session.js";
import type { ManagedSession } from "../core/types.js";

export interface SessionInput {
  cwd: string;
  title?: string;
  group?: string;
  additionalCwds?: string[];
}

export interface ForkInput {
  title?: string;
  group?: string;
}

export async function addManagedSession(input: SessionInput): Promise<ManagedSession> {
  const registry = await loadRegistry();
  let record = createSessionRecord({ cwd: resolve(input.cwd), title: input.title, group: input.group, additionalCwds: input.additionalCwds });
  record = await ensureMultiRepoWorkspace(record);
  record.order = nextOrderInGroup(registry.sessions, record.group);
  registry.sessions.push(record);
  await saveRegistry(registry);
  await startManagedSession(record.id);
  return record;
}

export async function startManagedSession(id: string): Promise<void> {
  const registry = await loadRegistry();
  let session = findSession(registry, id);
  if (await sessionExists(session.tmuxSession)) {
    await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd });
    return;
  }
  session = await ensureMultiRepoWorkspace(session);
  await saveRegistry(upsertSession(registry, session));
  const piArgs = buildPiArgs({ extensionPath: extensionPath(), sessionFile: session.sessionFile });
  await newSession({
    name: session.tmuxSession,
    cwd: effectiveSessionCwd(session),
    command: `pi ${piArgs.map(shellQuote).join(" ")}`,
    env: { PI_SESSIONS_SESSION_ID: session.id, PI_SESSIONS_DIR: sessionsStateDir() },
  });
  await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd });
}

export async function stopManagedSession(id: string): Promise<void> {
  const registry = await loadRegistry();
  const session = findSession(registry, id);
  if (await sessionExists(session.tmuxSession)) await killSession(session.tmuxSession);
  session.status = "stopped";
  session.updatedAt = Date.now();
  await saveRegistry(registry);
}

export async function restartManagedSession(id: string): Promise<void> {
  await stopManagedSession(id);
  const registry = await loadRegistry();
  const session = findSession(registry, id);
  session.status = "starting";
  session.updatedAt = Date.now();
  await saveRegistry(registry);
  await startManagedSession(id);
}

export async function forkManagedSession(sourceId: string, input: ForkInput = {}): Promise<ManagedSession> {
  const registry = await loadRegistry();
  const source = findSession(registry, sourceId);
  const sourceFile = await savedSessionFile(source);
  let record = createSessionRecord({
    cwd: source.cwd,
    title: input.title ?? `${source.title} fork`,
    group: input.group ?? source.group,
    additionalCwds: source.additionalCwds,
  });
  record = await ensureMultiRepoWorkspace(record);
  record.order = nextOrderInGroup(registry.sessions, record.group);
  registry.sessions.push(record);
  await saveRegistry(registry);
  const piArgs = buildPiArgs({ extensionPath: extensionPath(), forkFrom: sourceFile });
  await newSession({
    name: record.tmuxSession,
    cwd: effectiveSessionCwd(record),
    command: `pi ${piArgs.map(shellQuote).join(" ")}`,
    env: { PI_SESSIONS_SESSION_ID: record.id, PI_SESSIONS_DIR: sessionsStateDir() },
  });
  await configureManagedSessionStatusBar({ name: record.tmuxSession, title: record.title, cwd: record.cwd });
  return record;
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
