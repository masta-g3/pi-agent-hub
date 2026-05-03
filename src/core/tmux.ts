import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { sessionsStateDir } from "./paths.js";
import type { CommandResult } from "./types.js";

const execFileAsync = promisify(execFile);

export interface TmuxExec {
  exec(command: string, args: string[]): Promise<CommandResult>;
}

export const realTmuxExec: TmuxExec = {
  async exec(command, args) {
    try {
      const result = await execFileAsync(command, args, { encoding: "utf8" });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (typeof error === "object" && error !== null && "stdout" in error && "stderr" in error) {
        const failed = error as { stdout: string; stderr: string; message: string };
        throw new Error(`${command} ${args.join(" ")} failed: ${failed.stderr || failed.message}`);
      }
      throw error;
    }
  },
};

export async function hasTmux(exec: TmuxExec = realTmuxExec): Promise<boolean> {
  try {
    await exec.exec("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export async function sessionExists(name: string, exec: TmuxExec = realTmuxExec): Promise<boolean> {
  try {
    await exec.exec("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

export async function newSession(options: {
  name: string;
  cwd: string;
  command: string;
  env?: Record<string, string>;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const assignments = Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`);
  const command = [...assignments, options.command].join(" ");
  await exec.exec("tmux", ["new-session", "-d", "-s", options.name, "-c", options.cwd, command]);
}

export async function killSession(name: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["kill-session", "-t", name]);
}

export async function capturePane(name: string, lines = 160, exec: TmuxExec = realTmuxExec): Promise<string> {
  const result = await exec.exec("tmux", ["capture-pane", "-p", "-t", name, "-S", `-${lines}`]);
  return result.stdout;
}

export interface SwitchClientOptions {
  targetSession: string;
  returnKey?: string;
  managedPrefix?: string;
  stateDir?: string;
}

interface ActiveReturnBinding {
  ownerPid: number;
  controlSession: string;
  targetSession: string;
  returnKey: string;
  restorePath: string;
}

export async function currentTmuxSession(exec: TmuxExec = realTmuxExec): Promise<string> {
  const result = await exec.exec("tmux", ["display-message", "-p", "#{session_name}"]);
  const session = result.stdout.trim();
  if (!session) throw new Error("tmux current session is empty");
  return session;
}

export async function currentTmuxClient(exec: TmuxExec = realTmuxExec): Promise<string> {
  const result = await exec.exec("tmux", ["display-message", "-p", "#{client_name}"]);
  const client = result.stdout.trim();
  if (!client) throw new Error("tmux current client is empty");
  return client;
}

export async function switchClientWithReturn(
  options: SwitchClientOptions,
  exec: TmuxExec = realTmuxExec,
): Promise<void> {
  const returnKey = options.returnKey ?? "C-q";
  const managedPrefix = options.managedPrefix ?? "pi-sessions-";
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "return-key");
  const activePath = join(stateDir, "active.json");
  const restorePath = join(stateDir, "previous.tmux");

  await mkdir(stateDir, { recursive: true });
  await restoreSwitchReturnBinding({ stateDir, refuseLiveForeignOwner: true }, exec);

  const controlSession = await currentTmuxSession(exec);
  const controlClient = await currentTmuxClient(exec);
  const previousBinding = await currentKeyBinding(returnKey, exec);
  await writeFile(restorePath, previousBinding, "utf8");

  const active: ActiveReturnBinding = {
    ownerPid: process.pid,
    controlSession,
    targetSession: options.targetSession,
    returnKey,
    restorePath,
  };
  await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, "utf8");

  try {
    await exec.exec("tmux", ["bind-key", "-n", returnKey, "run-shell", returnBindingScript({
      controlSession,
      restorePath,
      activePath,
      managedPrefix,
      returnKey,
    })]);
    await exec.exec("tmux", ["switch-client", "-c", controlClient, "-t", options.targetSession]);
  } catch (error) {
    try {
      await restoreSwitchReturnBinding({ stateDir, onlyOwnerPid: process.pid }, exec);
    } catch (restoreError) {
      throw new Error(`${errorMessage(error)}; restore failed: ${errorMessage(restoreError)}`);
    }
    throw error;
  }
}

async function currentKeyBinding(returnKey: string, exec: TmuxExec): Promise<string> {
  try {
    const result = await exec.exec("tmux", ["list-keys", "-T", "root", returnKey]);
    return result.stdout.trim() ? result.stdout : "";
  } catch (error) {
    if (errorMessage(error).includes("unknown key")) return "";
    throw error;
  }
}

export async function restoreSwitchReturnBinding(
  options: { stateDir?: string; onlyOwnerPid?: number; refuseLiveForeignOwner?: boolean } = {},
  exec: TmuxExec = realTmuxExec,
): Promise<void> {
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "return-key");
  const activePath = join(stateDir, "active.json");
  let active: ActiveReturnBinding;
  try {
    active = JSON.parse(await readFile(activePath, "utf8")) as ActiveReturnBinding;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (options.onlyOwnerPid !== undefined && active.ownerPid !== options.onlyOwnerPid) return;
  if (options.refuseLiveForeignOwner && active.ownerPid !== process.pid && isProcessAlive(active.ownerPid)) {
    throw new Error(`tmux return binding is already active for pid ${active.ownerPid}`);
  }

  await exec.exec("tmux", ["unbind-key", "-T", "root", active.returnKey]);
  let previous = "";
  try {
    previous = await readFile(active.restorePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous.trim()) await exec.exec("tmux", ["source-file", active.restorePath]);
  await rm(activePath, { force: true });
  await rm(active.restorePath, { force: true });
}

function returnBindingScript(input: {
  controlSession: string;
  restorePath: string;
  activePath: string;
  managedPrefix: string;
  returnKey: string;
}): string {
  const prefixPattern = shellCasePrefix(input.managedPrefix);
  return `S=$(tmux display-message -p '#{session_name}'); case "$S" in ${prefixPattern}*) ` + [
    `tmux switch-client -t ${shellQuote(input.controlSession)} 2>/dev/null || true`,
    `tmux unbind-key -T root ${shellQuote(input.returnKey)} 2>/dev/null || true`,
    `test -s ${shellQuote(input.restorePath)} && tmux source-file ${shellQuote(input.restorePath)}`,
    `rm -f ${shellQuote(input.restorePath)} ${shellQuote(input.activePath)}`,
  ].join("; ") + ";; esac";
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function shellCasePrefix(value: string): string {
  return value.replace(/[\\[\]?*]/g, "\\$&");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
