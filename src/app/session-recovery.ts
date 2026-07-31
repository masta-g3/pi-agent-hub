import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isErrno, readJsonOr, withFileLock, writeJsonAtomic } from "../core/atomic-json.js";
import { registryPath, tmuxServerStatePath } from "../core/paths.js";
import { loadRegistry, updateRegistry } from "../core/registry.js";
import { sessionSection } from "../core/session-bucket.js";
import { isSubagentSession } from "../core/session-tree.js";
import { sessionPresence, tmuxServerIdentity, type TmuxPresence, type TmuxServerIdentity } from "../core/tmux.js";
import type { ManagedSession } from "../core/types.js";
import { startManagedSession } from "./session-commands.js";

export interface RecoveredSession {
  id: string;
  title: string;
}

export interface FailedRecovery extends RecoveredSession {
  error: string;
}

export interface SkippedRecovery extends RecoveredSession {
  reason: string;
}

export interface SessionRecoveryReport {
  recovered: RecoveredSession[];
  failed: FailedRecovery[];
  skipped: SkippedRecovery[];
}

export type AutomaticRecoveryResult =
  | { status: "unavailable"; error: string }
  | { status: "baseline"; current: TmuxServerIdentity }
  | { status: "unchanged"; current: TmuxServerIdentity }
  | { status: "restarted"; previous: TmuxServerIdentity; current: TmuxServerIdentity; report: SessionRecoveryReport };

export interface SessionRecoveryDeps {
  presence?: (name: string) => Promise<TmuxPresence>;
  start?: (id: string) => Promise<void>;
}

interface TmuxServerState {
  version: 1;
  identity: TmuxServerIdentity;
}

export function recoverableSessions(sessions: readonly ManagedSession[]): ManagedSession[] {
  return sessions.filter((session) => !isSubagentSession(session) && sessionSection(session) === "active" && session.status !== "stopped");
}

export async function recoverMissingManagedSessions(options: {
  env?: NodeJS.ProcessEnv;
  deps?: SessionRecoveryDeps;
} = {}): Promise<SessionRecoveryReport> {
  const env = options.env ?? process.env;
  const path = registryPath(env);
  const presence = options.deps?.presence ?? sessionPresence;
  const start = options.deps?.start ?? startManagedSession;
  const report: SessionRecoveryReport = { recovered: [], failed: [], skipped: [] };
  const registry = await loadRegistry(path);

  for (const session of recoverableSessions(registry.sessions)) {
    const currentPresence = await presence(session.tmuxSession);
    if (currentPresence === "present") {
      report.skipped.push({ id: session.id, title: session.title, reason: "already running" });
      continue;
    }
    if (currentPresence === "unknown") {
      report.skipped.push({ id: session.id, title: session.title, reason: "tmux presence is unknown" });
      continue;
    }

    try {
      await validateRecoveryInputs(session);
      const claimed = await markRecoveryStarting(session.id, path);
      if (!claimed) {
        report.skipped.push({ id: session.id, title: session.title, reason: "session is no longer eligible" });
        continue;
      }
      await start(session.id);
      report.recovered.push({ id: session.id, title: session.title });
    } catch (error) {
      const message = `recovery failed: ${errorMessage(error)}`;
      await markRecoveryFailed(session.id, message, path);
      report.failed.push({ id: session.id, title: session.title, error: message });
    }
  }

  return report;
}

export async function automaticRecoveryAfterTmuxRestart(options: {
  env?: NodeJS.ProcessEnv;
  identity?: () => Promise<TmuxServerIdentity>;
  deps?: SessionRecoveryDeps;
} = {}): Promise<AutomaticRecoveryResult> {
  const env = options.env ?? process.env;
  let current: TmuxServerIdentity;
  try {
    current = await (options.identity ?? tmuxServerIdentity)();
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }

  try {
    const observation = await observeTmuxServerIdentity(current, tmuxServerStatePath(env));
    if (!observation.previous) return { status: "baseline", current };
    if (!observation.changed) return { status: "unchanged", current };

    const report = await recoverMissingManagedSessions({ env, deps: options.deps });
    return { status: "restarted", previous: observation.previous, current, report };
  } catch (error) {
    return { status: "unavailable", error: errorMessage(error) };
  }
}

export function automaticRecoveryMessage(result: AutomaticRecoveryResult): string | undefined {
  if (result.status !== "restarted") return undefined;
  const recovered = result.report.recovered.length;
  const failed = result.report.failed.length;
  if (!recovered && !failed) return undefined;
  if (failed) return `tmux restarted: recovered ${recovered} session${recovered === 1 ? "" : "s"}; ${failed} failed`;
  return `tmux restarted: recovered ${recovered} session${recovered === 1 ? "" : "s"}`;
}

export async function observeTmuxServerIdentity(
  current: TmuxServerIdentity,
  path = tmuxServerStatePath(),
): Promise<{ previous?: TmuxServerIdentity; changed: boolean }> {
  return withFileLock(path, async () => {
    const state = await readJsonOr<TmuxServerState | undefined>(path, undefined);
    const previous = validTmuxServerState(state) ? state.identity : undefined;
    await writeJsonAtomic(path, { version: 1, identity: current } satisfies TmuxServerState);
    return { previous, changed: Boolean(previous && !sameTmuxServer(previous, current)) };
  });
}

async function validateRecoveryInputs(session: ManagedSession): Promise<void> {
  await requireDirectory(session.cwd, "cwd");
  for (const cwd of session.additionalCwds ?? []) await requireDirectory(cwd, "additional cwd");
  if (!session.sessionFile) return;
  try {
    await access(session.sessionFile, constants.R_OK);
  } catch {
    throw new Error(`Pi session history is unavailable: ${session.sessionFile}`);
  }
}

async function requireDirectory(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new Error(`${label} is unavailable: ${path}`);
    throw error;
  }
}

async function markRecoveryStarting(id: string, path: string): Promise<boolean> {
  let claimed = false;
  await updateRegistry((registry) => ({
    ...registry,
    sessions: registry.sessions.map((session) => {
      if (session.id !== id || !recoverableSessions([session]).length) return session;
      claimed = true;
      return { ...session, status: "starting", error: undefined, recoveryError: undefined, updatedAt: Date.now() };
    }),
  }), path);
  return claimed;
}

async function markRecoveryFailed(id: string, message: string, path: string): Promise<void> {
  await updateRegistry((registry) => ({
    ...registry,
    sessions: registry.sessions.map((session) => {
      if (session.id !== id || session.status === "stopped" || isSubagentSession(session) || sessionSection(session) !== "active") return session;
      return { ...session, status: "error", error: message, recoveryError: message, updatedAt: Date.now() };
    }),
  }), path);
}

function validTmuxServerState(state: TmuxServerState | undefined): state is TmuxServerState {
  return Boolean(state && state.version === 1 && validTmuxServerIdentity(state.identity));
}

function validTmuxServerIdentity(identity: TmuxServerIdentity | undefined): identity is TmuxServerIdentity {
  return Boolean(identity && Number.isInteger(identity.pid) && identity.pid > 0
    && Number.isInteger(identity.startedAt) && identity.startedAt > 0 && identity.socketPath);
}

function sameTmuxServer(a: TmuxServerIdentity, b: TmuxServerIdentity): boolean {
  return a.pid === b.pid && a.startedAt === b.startedAt && a.socketPath === b.socketPath;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
