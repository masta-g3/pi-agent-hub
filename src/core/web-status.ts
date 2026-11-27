import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { isErrno, readJson, writeJsonAtomic } from "./atomic-json.js";
import { sessionsStateDir } from "./paths.js";

/** One running `pi-hub web` process, published while it listens. */
export interface WebStatus {
  pid: number;
  port: number;
  /** Random per process; the listener returns it from `/api/instance`, which ties the port to this record. */
  instanceId: string;
  startedAt: number;
}

export interface WebStatusChecks {
  alive?: (pid: number) => boolean;
  /** The `instanceId` the listener on `port` returns, or undefined when nothing answers. */
  probe?: (port: number) => Promise<string | undefined>;
}

const PROBE_TIMEOUT_MS = 500;
const MAX_PID = 2 ** 31 - 1;

export function webStatusDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(sessionsStateDir(env), "web");
}

export async function writeWebStatus(status: WebStatus, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writeJsonAtomic(join(webStatusDir(env), `${status.pid}.json`), { version: 1, ...status });
}

export async function clearWebStatus(pid: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await rm(join(webStatusDir(env), `${pid}.json`), { force: true });
}

/**
 * Running servers, ordered by port. A record counts only when its pid is alive and its port returns the same
 * `instanceId`, so a reused pid or a port another program took never reads as running. A dead pid's record is removed.
 */
export async function readWebStatuses(env: NodeJS.ProcessEnv = process.env, checks: WebStatusChecks = {}): Promise<WebStatus[]> {
  const alive = checks.alive ?? pidAlive;
  const probe = checks.probe ?? probeInstance;
  let names: string[];
  try {
    names = await readdir(webStatusDir(env));
  } catch (error) {
    if (isErrno(error, "ENOENT")) return [];
    throw error;
  }
  const records = await Promise.all(names.filter((name) => /^\d+\.json$/u.test(name)).map(async (name) => {
    const status = await readRecord(join(webStatusDir(env), name));
    // The pid must name its own file: a record can never prune or point at another server's pid.
    if (!status || `${status.pid}.json` !== name) return undefined;
    if (!alive(status.pid)) {
      await clearWebStatus(status.pid, env);
      return undefined;
    }
    return await probe(status.port) === status.instanceId ? status : undefined;
  }));
  return records.filter((status): status is WebStatus => status !== undefined).sort((a, b) => a.port - b.port);
}

async function readRecord(path: string): Promise<WebStatus | undefined> {
  let value: unknown;
  try {
    value = await readJson<unknown>(path);
  } catch (error) {
    // A record can vanish while its server shuts down, and a torn or foreign file is not a server.
    if (isErrno(error, "ENOENT") || error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { version, pid, port, instanceId, startedAt } = value as Record<string, unknown>;
  // A pid of 0 or below would signal a process group.
  if (version !== 1 || !isInRange(pid, 1, MAX_PID) || !isInRange(port, 1, 65_535) || typeof instanceId !== "string" || !instanceId || typeof startedAt !== "number") return undefined;
  return { pid: pid as number, port: port as number, instanceId, startedAt };
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return isErrno(error, "EPERM");
  }
}

async function probeInstance(port: number): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/instance`, { redirect: "error", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch {
    // Refused, reset or timed out: no Hub server answers on this port.
    return undefined;
  }
  if (!response.ok) return undefined;
  const body = await response.json().catch(() => undefined) as { instanceId?: unknown } | undefined;
  return typeof body?.instanceId === "string" ? body.instanceId : undefined;
}
