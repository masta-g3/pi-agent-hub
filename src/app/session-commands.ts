import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { SESSION_ID_ENV, STATE_ENV } from "../core/names.js";
import { resolve } from "node:path";
import { effectiveSessionPrelude } from "../core/config.js";
import { buildPiArgs } from "../core/pi-process.js";
import { extensionPath } from "../core/extension-path.js";
import { effectiveSessionCwd, ensureMultiRepoWorkspace } from "../core/multi-repo.js";
import { sessionsStateDir } from "../core/paths.js";
import { recordRepoUsage } from "../core/repo-history.js";
import { createSessionRecord, loadRegistry, updateRegistry, upsertSession } from "../core/registry.js";
import { nextOrderInGroup } from "../core/session-order.js";
import { isSubagentSession } from "../core/session-tree.js";
import { configureManagedSessionStatusBar, killSession, newSession, sessionExists } from "../core/tmux.js";
import { loadSessionsTheme } from "../tui/theme.js";
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
  let record = createSessionRecord({ cwd: resolve(input.cwd), title: input.title, group: input.group, additionalCwds: input.additionalCwds });
  record = await ensureMultiRepoWorkspace(record);
  await updateRegistry((registry) => {
    record.order = nextOrderInGroup(registry.sessions, record.group);
    return { ...registry, sessions: [...registry.sessions, record] };
  });
  await startManagedSession(record.id);
  try {
    await recordRepoUsage([record.cwd, ...(record.additionalCwds ?? [])]);
  } catch {
    // Repo history is a convenience cache; session creation already succeeded.
  }
  return record;
}

export async function startManagedSession(id: string): Promise<void> {
  const registry = await loadRegistry();
  let session = findSession(registry, id);
  if (isSubagentSession(session)) throw new Error(`Cannot start subagent row: ${session.title}`);
  if (await sessionExists(session.tmuxSession)) {
    await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: await sessionTheme(session) });
    return;
  }
  session = await ensureMultiRepoWorkspace(session);
  await updateRegistry((latest) => upsertSession(latest, session));
  const piArgs = buildPiArgs({ extensionPath: extensionPath(), sessionFile: session.sessionFile });
  await newSession({
    name: session.tmuxSession,
    cwd: effectiveSessionCwd(session),
    command: managedPiCommand({ piArgs, prelude: await effectiveSessionPrelude() }),
    env: { [SESSION_ID_ENV]: session.id, [STATE_ENV]: sessionsStateDir() },
  });
  await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: await sessionTheme(session) });
}

export async function stopManagedSession(id: string): Promise<void> {
  const registry = await loadRegistry();
  const session = findSession(registry, id);
  if (isSubagentSession(session)) throw new Error(`Cannot stop subagent row: ${session.title}`);
  if (await sessionExists(session.tmuxSession)) await killSession(session.tmuxSession);
  await updateRegistry((latest) => {
    const latestSession = findSession(latest, id);
    if (isSubagentSession(latestSession)) throw new Error(`Cannot stop subagent row: ${latestSession.title}`);
    return { ...latest, sessions: latest.sessions.map((item) => item.id === latestSession.id ? { ...item, status: "stopped", updatedAt: Date.now() } : item) };
  });
}

export async function restartManagedSession(id: string): Promise<void> {
  await stopManagedSession(id);
  await updateRegistry((registry) => {
    const session = findSession(registry, id);
    return { ...registry, sessions: registry.sessions.map((item) => item.id === session.id ? { ...item, status: "starting", updatedAt: Date.now() } : item) };
  });
  await startManagedSession(id);
}

export async function syncManagedSessionStatusBars(): Promise<void> {
  const registry = await loadRegistry();
  for (const session of registry.sessions) {
    if (await sessionExists(session.tmuxSession)) {
      await configureManagedSessionStatusBar({ name: session.tmuxSession, title: session.title, cwd: session.cwd, theme: await sessionTheme(session) });
    }
  }
}

export async function forkManagedSession(sourceId: string, input: ForkInput = {}): Promise<ManagedSession> {
  const registry = await loadRegistry();
  const source = findSession(registry, sourceId);
  if (isSubagentSession(source)) throw new Error(`Cannot fork subagent row: ${source.title}`);
  const sourceFile = await savedSessionFile(source);
  let record = createSessionRecord({
    cwd: source.cwd,
    title: input.title ?? `${source.title} fork`,
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
    env: { [SESSION_ID_ENV]: record.id, [STATE_ENV]: sessionsStateDir() },
  });
  await configureManagedSessionStatusBar({ name: record.tmuxSession, title: record.title, cwd: record.cwd, theme: await sessionTheme(record) });
  return record;
}

async function sessionTheme(session: ManagedSession) {
  return loadSessionsTheme({ cwd: session.cwd });
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
