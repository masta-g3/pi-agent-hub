import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { tmuxChromeFromTheme, type ChromeThemeTokens } from "./chrome.js";
import { MANAGED_SESSION_PREFIX } from "./names.js";
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

export type TmuxPresence = "present" | "missing" | "unknown";

export async function sessionPresence(name: string, exec: TmuxExec = realTmuxExec): Promise<TmuxPresence> {
  try {
    await exec.exec("tmux", ["has-session", "-t", name]);
    return "present";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /can't find session|no server running/i.test(message) ? "missing" : "unknown";
  }
}

export async function sessionExists(name: string, exec: TmuxExec = realTmuxExec): Promise<boolean> {
  return await sessionPresence(name, exec) === "present";
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

export interface CapturePaneOptions {
  preserveStyles?: boolean;
}

export async function capturePane(name: string, lines = 160, optionsOrExec: CapturePaneOptions | TmuxExec = {}, exec: TmuxExec = realTmuxExec): Promise<string> {
  const options = "exec" in optionsOrExec ? {} : optionsOrExec;
  const runner = "exec" in optionsOrExec ? optionsOrExec : exec;
  const args = ["capture-pane", "-p"];
  if (options.preserveStyles) args.push("-e");
  args.push("-t", name, "-S", `-${lines}`);
  const result = await runner.exec("tmux", args);
  return result.stdout;
}

export async function sendTextToSession(name: string, text: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  const buffer = `pi-agent-hub-send-${process.pid}`;
  await exec.exec("tmux", ["set-buffer", "-b", buffer, "--", text]);
  await exec.exec("tmux", ["paste-buffer", "-d", "-b", buffer, "-t", name]);
  await exec.exec("tmux", ["send-keys", "-t", name, "Enter"]);
}

export async function configureManagedSessionStatusBar(options: {
  name: string;
  title: string;
  cwd: string;
  theme?: ChromeThemeTokens;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const chrome = tmuxChromeFromTheme(options.theme);
  const statusRight = `#[fg=${chrome.hintColor}]ctrl+q return · alt+r rename#[default] │ 📁 ${tmuxFormatText(options.title)} | ${tmuxFormatText(projectDisplayName(options.cwd))} `;
  await exec.exec("tmux", [
    "set-option", "-t", options.name, "status", "on",
    ";", "set-option", "-t", options.name, "status-style", chrome.statusStyle,
    ";", "set-option", "-t", options.name, "status-right", statusRight,
    ";", "set-option", "-t", options.name, "status-right-length", "100",
    ";", "set-option", "-t", options.name, "status-left", "",
    ";", "set-option", "-t", options.name, "status-left-length", "120",
    ";", "set-option", "-t", options.name, "window-status-style", chrome.windowStatusStyle,
    ";", "set-option", "-t", options.name, "window-status-current-style", chrome.windowStatusCurrentStyle,
    ";", "set-option", "-t", options.name, "window-status-format", " #I:#W#F ",
    ";", "set-option", "-t", options.name, "window-status-current-format", " #I:#W#F ",
  ]);
}

export async function configureDashboardStatusBar(options: {
  name: string;
  cwd: string;
  theme?: ChromeThemeTokens;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const chrome = tmuxChromeFromTheme(options.theme);
  const statusRight = `#[fg=${chrome.hintColor}]dashboard#[default] │ 📁 ${tmuxFormatText(projectDisplayName(options.cwd))} `;
  await exec.exec("tmux", [
    "set-option", "-t", options.name, "status", "on",
    ";", "set-option", "-t", options.name, "status-style", chrome.statusStyle,
    ";", "set-option", "-t", options.name, "status-left", "",
    ";", "set-option", "-t", options.name, "status-right", statusRight,
    ";", "set-option", "-t", options.name, "status-right-length", "100",
    ";", "set-option", "-t", options.name, "window-status-style", chrome.windowStatusStyle,
    ";", "set-option", "-t", options.name, "window-status-current-style", chrome.windowStatusCurrentStyle,
    ";", "set-option", "-t", options.name, "window-status-format", " #I:#W#F ",
    ";", "set-option", "-t", options.name, "window-status-current-format", " #I:#W#F ",
  ]);
}

export interface SwitchClientOptions {
  targetSession: string;
  returnKey?: string;
  managedPrefix?: string;
  stateDir?: string;
  renameKey?: string;
  actionPath?: string;
  returnSession?: {
    name: string;
    cwd: string;
    command: string;
    env?: Record<string, string>;
  };
}

interface SavedKeyBinding {
  key: string;
  restorePath: string;
}

interface ActiveReturnBinding {
  ownerPid: number;
  controlSession: string;
  targetSession: string;
  returnKey: string;
  restorePath: string;
  keyBindings?: SavedKeyBinding[];
}

export type SwitchReturnBindingStatus =
  | { active: false }
  | (ActiveReturnBinding & { active: true; stale: boolean });

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
  const managedPrefix = options.managedPrefix ?? MANAGED_SESSION_PREFIX;
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "return-key");
  const activePath = join(stateDir, "active.json");
  const restorePath = join(stateDir, "previous.tmux");
  const actionPath = options.actionPath ?? join(stateDir, "dashboard-action.json");

  await mkdir(stateDir, { recursive: true });
  await restoreSwitchReturnBinding({ stateDir, refuseLiveForeignOwner: true }, exec);

  const controlSession = await currentTmuxSession(exec);
  const controlClient = await currentTmuxClient(exec);
  const previousBinding = await currentKeyBinding(returnKey, exec);
  await writeFile(restorePath, previousBinding, "utf8");
  const keyBindings: SavedKeyBinding[] = [{ key: returnKey, restorePath }];
  if (options.renameKey) {
    const renameRestorePath = join(stateDir, "rename.previous.tmux");
    const previousRenameBinding = await currentKeyBinding(options.renameKey, exec);
    await writeFile(renameRestorePath, previousRenameBinding, "utf8");
    keyBindings.push({ key: options.renameKey, restorePath: renameRestorePath });
  }

  const active: ActiveReturnBinding = {
    ownerPid: process.pid,
    controlSession,
    targetSession: options.targetSession,
    returnKey,
    restorePath,
    keyBindings,
  };
  await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, "utf8");

  try {
    await exec.exec("tmux", ["bind-key", "-n", returnKey, "run-shell", returnBindingScript({
      controlSession,
      activePath,
      managedPrefix,
      keyBindings,
      returnSession: options.returnSession,
    })]);
    if (options.renameKey) {
      await exec.exec("tmux", ["bind-key", "-n", options.renameKey, "run-shell", returnBindingScript({
        controlSession,
        activePath,
        managedPrefix,
        keyBindings,
        returnSession: options.returnSession,
        action: {
          path: actionPath,
          json: JSON.stringify({ action: "rename", tmuxSession: options.targetSession }),
        },
      })]);
    }
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

export async function inspectSwitchReturnBinding(options: { stateDir?: string } = {}): Promise<SwitchReturnBindingStatus> {
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "return-key");
  const activePath = join(stateDir, "active.json");
  try {
    const active = JSON.parse(await readFile(activePath, "utf8")) as ActiveReturnBinding;
    return { ...active, active: true, stale: !isProcessAlive(active.ownerPid) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { active: false };
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

  const keyBindings = active.keyBindings ?? [{ key: active.returnKey, restorePath: active.restorePath }];
  for (const binding of keyBindings) {
    try {
      await exec.exec("tmux", ["unbind-key", "-T", "root", binding.key]);
    } catch (error) {
      if (!errorMessage(error).includes("unknown key")) throw error;
    }
  }
  for (const binding of keyBindings) {
    let previous = "";
    try {
      previous = await readFile(binding.restorePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous.trim()) await exec.exec("tmux", ["source-file", binding.restorePath]);
    await rm(binding.restorePath, { force: true });
  }
  await rm(activePath, { force: true });
}

function returnBindingScript(input: {
  controlSession: string;
  activePath: string;
  managedPrefix: string;
  keyBindings: SavedKeyBinding[];
  returnSession?: {
    name: string;
    cwd: string;
    command: string;
    env?: Record<string, string>;
  };
  action?: {
    path: string;
    json: string;
  };
}): string {
  const prefixPattern = shellCasePrefix(input.managedPrefix);
  const restorePaths = input.keyBindings.map((binding) => binding.restorePath);
  const restore = [
    ...input.keyBindings.map((binding) => `tmux unbind-key -T root ${shellQuote(binding.key)} 2>/dev/null || true`),
    ...restorePaths.map((path) => `test -s ${shellQuote(path)} && tmux source-file ${shellQuote(path)}`),
    `rm -f ${[...restorePaths, input.activePath].map(shellQuote).join(" ")}`,
  ].join("; ");
  const action = input.action ? `printf %s ${shellQuote(input.action.json)} > ${shellQuote(input.action.path)}; ` : "";
  const returnCommand = input.returnSession ? commandWithEnv(input.returnSession.command, input.returnSession.env) : "";
  const ensureReturnSession = input.returnSession?.name === input.controlSession
    ? `tmux has-session -t ${shellQuote(input.controlSession)} 2>/dev/null || tmux new-session -d -s ${shellQuote(input.controlSession)} -c ${shellQuote(input.returnSession.cwd)} ${shellQuote(returnCommand)} 2>/dev/null || true; `
    : "";
  return `S=$(tmux display-message -p '#{session_name}'); case "$S" in ${prefixPattern}*) `
    + `${ensureReturnSession}if tmux switch-client -t ${shellQuote(input.controlSession)} 2>/dev/null; then ${action}${restore}; fi;; esac`;
}

function commandWithEnv(command: string, env: Record<string, string> | undefined): string {
  const assignments = Object.entries(env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`);
  return [...assignments, command].join(" ");
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

function projectDisplayName(cwd: string): string {
  return basename(cwd) || "~";
}

function tmuxFormatText(value: string): string {
  return value.replaceAll("#", "##");
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
