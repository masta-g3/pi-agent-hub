import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isErrno } from "../core/atomic-json.js";
import { CLI_COMMAND, STATE_ENV } from "../core/names.js";
import { agentDir, sessionsStateDir } from "../core/paths.js";
import { newSession, realTmuxExec, sessionExists, shellQuote, type TmuxExec } from "../core/tmux.js";
import { pidAlive, readWebStatuses, type WebStatus } from "../core/web-status.js";
import { dashboardEnv } from "./dashboard.js";

/** Not `pi-agent-hub-…`: that prefix marks managed Pi sessions for pins and the return key. */
export const WEB_TMUX_SESSION = `${CLI_COMMAND}-web`;

/** The compiled CLI beside this module (`dist/src/cli.js`), the file `pi-hub` runs. */
export const CLI_FILE = fileURLToPath(new URL("../cli.js", import.meta.url));

interface WaitOptions {
  pollMs?: number;
  timeoutMs?: number;
}

const POLL_MS = 100;
const TIMEOUT_MS = 5_000;

/**
 * Start `pi-hub web` in its own tmux session, so it outlives the dashboard, and wait until it publishes a verified
 * record. A server already running is returned as is.
 */
export async function startWebInbox(deps: WaitOptions & {
  exec?: TmuxExec;
  env?: NodeJS.ProcessEnv;
  cliPath?: string;
  nodePath?: string;
  read?: () => Promise<WebStatus[]>;
} = {}): Promise<WebStatus> {
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? realTmuxExec;
  const read = deps.read ?? (() => readWebStatuses(env));
  const running = (await read())[0];
  if (running) return running;
  const manual = `${CLI_COMMAND} web`;
  // `=` makes tmux match the name exactly; a bare name would also match `pi-hub-web-test`.
  if (await sessionExists(`=${WEB_TMUX_SESSION}`, exec)) {
    throw new Error(`tmux session ${WEB_TMUX_SESSION} exists; attach to it to check the server (tmux attach -t ${WEB_TMUX_SESSION})`);
  }
  await newSession({
    name: WEB_TMUX_SESSION,
    cwd: homedir(),
    command: `${shellQuote(deps.nodePath ?? process.execPath)} ${shellQuote(deps.cliPath ?? CLI_FILE)} web`,
    // Resolved here, so the server reads this dashboard's state even when a configured dir is relative.
    env: { ...dashboardEnv(env), PI_CODING_AGENT_DIR: agentDir(env), [STATE_ENV]: sessionsStateDir(env) },
  }, exec);
  const started = await poll(async () => (await read())[0], deps);
  if (!started) throw new Error(`phone inbox did not start; check tmux attach -t ${WEB_TMUX_SESSION}, or run ${manual}`);
  return started;
}

/** Send SIGTERM to every verified server and wait for each to exit. Returns how many it stopped. */
export async function stopWebInbox(deps: WaitOptions & {
  env?: NodeJS.ProcessEnv;
  read?: () => Promise<WebStatus[]>;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  alive?: (pid: number) => boolean;
} = {}): Promise<number> {
  const read = deps.read ?? (() => readWebStatuses(deps.env ?? process.env));
  const kill = deps.kill ?? ((pid, signal) => { process.kill(pid, signal); });
  const alive = deps.alive ?? pidAlive;
  const running = await read();
  const failures: string[] = [];
  const signalled: number[] = [];
  for (const status of running) {
    try {
      kill(status.pid, "SIGTERM");
      signalled.push(status.pid);
    } catch (error) {
      // ESRCH: it exited between the check and the signal, which is what Stop wants.
      if (!isErrno(error, "ESRCH")) failures.push(`pid ${status.pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // One deadline for all: they were signalled together, so they exit together.
  const exited = await poll(async () => signalled.every((pid) => !alive(pid)) || undefined, deps);
  if (!exited) for (const pid of signalled.filter(alive)) failures.push(`pid ${pid} did not exit`);
  if (failures.length) throw new Error(`phone inbox: ${failures.join("; ")}`);
  return running.length;
}

async function poll<T>(check: () => Promise<T | undefined>, options: WaitOptions): Promise<T | undefined> {
  const deadline = Date.now() + (options.timeoutMs ?? TIMEOUT_MS);
  while (true) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) return undefined;
    await new Promise((done) => setTimeout(done, options.pollMs ?? POLL_MS));
  }
}
