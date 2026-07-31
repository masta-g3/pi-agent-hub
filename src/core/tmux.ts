import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { isErrno, withFileLock, writeJsonAtomic } from "./atomic-json.js";
import { tmuxChromeFromTheme, type ChromeThemeTokens, type TmuxChrome } from "./chrome.js";
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

export function cliTuiCommand(input: { nodePath: string; cliPath: string }): string {
  return `${shellQuote(input.nodePath)} ${shellQuote(input.cliPath)} tui`;
}

export async function hasTmux(exec: TmuxExec = realTmuxExec): Promise<boolean> {
  try {
    await exec.exec("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

export interface TmuxServerIdentity {
  pid: number;
  startedAt: number;
  socketPath: string;
}

export async function tmuxServerIdentity(exec: TmuxExec = realTmuxExec): Promise<TmuxServerIdentity> {
  const result = await exec.exec("tmux", ["display-message", "-p", "#{pid}\t#{start_time}\t#{socket_path}"]);
  const [pidText, startedAtText, socketPath] = result.stdout.trimEnd().split("\t");
  const pid = Number(pidText);
  const startedAt = Number(startedAtText);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(startedAt) || startedAt <= 0 || !socketPath) {
    throw new Error("tmux server identity is invalid");
  }
  return { pid, startedAt, socketPath };
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

export async function switchClient(name: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["switch-client", "-t", name]);
}

export function attachSessionCommand(name: string): { command: "tmux"; args: ["attach-session", "-t", string] } {
  return { command: "tmux", args: ["attach-session", "-t", name] };
}

export interface WindowPane {
  id: string;
  tty: string;
  active: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  windowWidth: number;
  windowHeight: number;
  slot?: number;
}

export async function listWindowPanes(pane: string, exec: TmuxExec = realTmuxExec): Promise<WindowPane[]> {
  const format = "#{pane_id} #{pane_tty} #{pane_active} #{pane_left} #{pane_top} #{pane_width} #{pane_height} #{window_width} #{window_height} #{@pi_hub_slot}";
  const result = await exec.exec("tmux", ["list-panes", "-t", pane, "-F", format]);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    const fields = line.split(" ");
    const [id, tty, active, ...rest] = fields;
    const geometryText = rest.slice(0, 6);
    const geometry = geometryText.map(Number);
    if (!id || !tty || geometry.length !== 6 || geometry.some((value) => !Number.isFinite(value))) return [];
    const [left, top, width, height, windowWidth, windowHeight] = geometry as [number, number, number, number, number, number];
    const slot = Number(rest[6]);
    return [{ id, tty, active: active === "1", left, top, width, height, windowWidth, windowHeight, ...(Number.isInteger(slot) && slot >= 1 && slot <= 4 ? { slot } : {}) }];
  });
}

export async function splitWindowAttach(options: { pane: string; target: string; size: number }, exec: TmuxExec = realTmuxExec): Promise<string> {
  return splitPaneAttach({ pane: options.pane, target: options.target, direction: "horizontal", size: options.size }, exec);
}

export async function splitPaneAttach(options: {
  pane: string;
  target: string;
  direction: "horizontal" | "vertical";
  size?: number;
}, exec: TmuxExec = realTmuxExec): Promise<string> {
  const direction = options.direction === "horizontal" ? "-h" : "-v";
  const size = options.size === undefined ? [] : ["-l", String(options.size)];
  const result = await exec.exec("tmux", [
    "split-window", "-d", direction, ...size, "-P", "-F", "#{pane_id}", "-t", options.pane,
    `env -u TMUX tmux attach-session -t ${shellQuote(options.target)}`,
  ]);
  const paneId = result.stdout.trim();
  if (!paneId) throw new Error("tmux did not report the new pane id");
  return paneId;
}

export async function switchClientTo(options: { clientTty: string; target: string }, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["switch-client", "-c", options.clientTty, "-t", options.target]);
}

export async function presizeSessionWindow(options: { target: string; width: number; height: number }, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["resize-window", "-t", options.target, "-x", String(options.width), "-y", String(options.height)]);
}

export async function resetSessionWindowSize(target: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["set-option", "-w", "-t", target, "window-size", "latest"]);
}

export async function killPane(paneId: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["kill-pane", "-t", paneId]);
}

export async function resizePaneWidth(paneId: string, width: number, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["resize-pane", "-t", paneId, "-x", String(width)]);
}

export async function selectPane(paneId: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["select-pane", "-t", paneId]);
}

export async function setPaneTitle(paneId: string, title: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["select-pane", "-t", paneId, "-T", title]);
}

export async function setPaneSlot(paneId: string, slot: number, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["set-option", "-p", "-t", paneId, "@pi_hub_slot", String(slot)]);
}

export async function setWindowPaneBorderStatus(paneId: string, visible: boolean, chrome?: TmuxChrome, exec: TmuxExec = realTmuxExec): Promise<void> {
  if (visible) {
    await exec.exec("tmux", ["set-option", "-w", "-t", paneId, "pane-border-format", chrome?.paneBorderFormat ?? " #{pane_title} "]);
    if (chrome) {
      await exec.exec("tmux", ["set-option", "-w", "-t", paneId, "pane-border-style", chrome.paneBorderStyle]);
      await exec.exec("tmux", ["set-option", "-w", "-t", paneId, "pane-active-border-style", chrome.paneActiveBorderStyle]);
    }
    await exec.exec("tmux", ["set-option", "-w", "-t", paneId, "pane-border-status", "top"]);
    return;
  }
  await exec.exec("tmux", ["set-option", "-w", "-t", paneId, "pane-border-status", "off"]);
  await exec.exec("tmux", ["set-option", "-w", "-u", "-t", paneId, "pane-border-format"]);
  await exec.exec("tmux", ["set-option", "-w", "-u", "-t", paneId, "pane-border-style"]);
  await exec.exec("tmux", ["set-option", "-w", "-u", "-t", paneId, "pane-active-border-style"]);
}

export async function clientSessionsByTty(exec: TmuxExec = realTmuxExec): Promise<Map<string, string>> {
  const result = await exec.exec("tmux", ["list-clients", "-F", "#{client_tty} #{client_session}"]);
  const sessions = new Map<string, string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator === -1) continue;
    sessions.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return sessions;
}

export async function clientSessionByTty(tty: string, exec: TmuxExec = realTmuxExec): Promise<string | undefined> {
  return (await clientSessionsByTty(exec)).get(tty);
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
  visible?: boolean;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const chrome = tmuxChromeFromTheme(options.theme);
  const statusRight = `#[fg=${chrome.hintColor}]ctrl+q return · alt+r rename#[default] │ 📁 ${tmuxFormatText(options.title)} | ${tmuxFormatText(projectDisplayName(options.cwd))} `;
  await exec.exec("tmux", [
    "set-option", "-t", options.name, "status", options.visible === false ? "off" : "on",
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

export async function setSessionStatusBarVisible(options: {
  name: string;
  visible: boolean;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  await exec.exec("tmux", ["set-option", "-t", options.name, "status", options.visible ? "on" : "off"]);
}

export async function setDashboardMouse(options: {
  name: string;
  enabled: boolean;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  if (options.enabled) await exec.exec("tmux", ["set-option", "-t", options.name, "mouse", "on"]);
  else await exec.exec("tmux", ["set-option", "-u", "-t", options.name, "mouse"]);
}

export async function configureDashboardStatusBar(options: {
  name: string;
  cwd: string;
  theme?: ChromeThemeTokens;
  visible?: boolean;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const chrome = tmuxChromeFromTheme(options.theme);
  const statusRight = `#[fg=${chrome.hintColor}]dashboard#[default] │ 📁 ${tmuxFormatText(projectDisplayName(options.cwd))} `;
  await exec.exec("tmux", [
    "set-option", "-t", options.name, "status", options.visible === false ? "off" : "on",
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

export async function clientSize(client: string, exec: TmuxExec = realTmuxExec): Promise<{ width: number; height: number }> {
  const result = await exec.exec("tmux", ["display-message", "-p", "-c", client, "#{client_width} #{client_height}"]);
  const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error("tmux client size is invalid");
  return { width: width!, height: height! };
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

  let targetPresized = false;
  let switched = false;
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
    try {
      const size = await clientSize(controlClient, exec);
      await presizeSessionWindow({ target: options.targetSession, width: size.width, height: size.height - 1 }, exec);
      targetPresized = true;
    } catch {
      // Pre-sizing is optional; switching must still work if tmux cannot report or apply the target geometry.
    }
    await exec.exec("tmux", ["switch-client", "-c", controlClient, "-t", options.targetSession]);
    switched = true;
    if (targetPresized) await resetSessionWindowSize(options.targetSession, exec);
  } catch (error) {
    if (targetPresized && !switched) await resetSessionWindowSize(options.targetSession, exec).catch(() => {});
    if (!switched) {
      try {
        await restoreSwitchReturnBinding({ stateDir, onlyOwnerPid: process.pid }, exec);
      } catch (restoreError) {
        throw new Error(`${errorMessage(error)}; restore failed: ${errorMessage(restoreError)}`);
      }
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
    if (isErrno(error, "ENOENT")) return { active: false };
    throw error;
  }
}

export async function currentKeyBinding(returnKey: string, exec: TmuxExec = realTmuxExec): Promise<string> {
  try {
    const result = await exec.exec("tmux", ["list-keys", "-T", "root", returnKey]);
    return result.stdout.trim() ? result.stdout : "";
  } catch (error) {
    if (errorMessage(error).includes("unknown key")) return "";
    throw error;
  }
}

interface ActiveSidebarReturnBinding {
  ownerPid: number;
  dashboardSession: string;
  sidebarPane: string;
  returnKey: string;
  keys?: string[];
  restorePath: string;
}

export type SidebarReturnBindingStatus =
  | { active: false }
  | (ActiveSidebarReturnBinding & { active: true; stale: boolean });

export async function inspectSidebarReturnBinding(options: { stateDir?: string } = {}): Promise<SidebarReturnBindingStatus> {
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "sidebar-return");
  try {
    const active = JSON.parse(await readFile(join(stateDir, "active.json"), "utf8")) as ActiveSidebarReturnBinding;
    return { ...active, keys: active.keys ?? [active.returnKey], active: true, stale: !isProcessAlive(active.ownerPid) };
  } catch (error) {
    if (isErrno(error, "ENOENT")) return { active: false };
    throw error;
  }
}

export async function installSidebarReturnBinding(options: {
  dashboardSession: string;
  sidebarPane: string;
  stateDir?: string;
  returnKey?: string;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "sidebar-return");
  const activePath = join(stateDir, "active.json");
  await withFileLock(activePath, async () => {
    const restorePath = join(stateDir, "previous.tmux");
    const returnKey = options.returnKey ?? "C-q";
    const keys = [...new Set([returnKey, "M-q", "M-1", "M-2", "M-3", "M-4"])];
    await removeSidebarReturnBindingUnlocked({ stateDir, refuseLiveForeignOwner: true }, exec);
    const previous = await Promise.all(keys.map((key) => currentKeyBinding(key, exec)));
    await writeFile(restorePath, previous.filter(Boolean).join("\n"), "utf8");
    await writeJsonAtomic(activePath, {
      ownerPid: process.pid,
      dashboardSession: options.dashboardSession,
      sidebarPane: options.sidebarPane,
      returnKey,
      keys,
      restorePath,
    } satisfies ActiveSidebarReturnBinding);

    const dashboardGuard = `#{==:#{session_name},${options.dashboardSession}}`;
    const focusSidebar = `select-pane -t ${shellQuote(options.sidebarPane)}`;
    try {
      await exec.exec("tmux", ["bind-key", "-n", returnKey, "if-shell", "-F", dashboardGuard, focusSidebar, `send-keys ${returnKey}`]);
      if (returnKey !== "M-q") {
        await exec.exec("tmux", ["bind-key", "-n", "M-q", "if-shell", "-F", dashboardGuard, focusSidebar, "send-keys Escape q"]);
      }
      for (const slot of [1, 2, 3, 4]) {
        const script = `P=$(tmux list-panes -t ${shellQuote(options.dashboardSession)} -F '##{pane_id} ##{@pi_hub_slot}' | awk -v s=${slot} '$2==s{print $1; exit}'); if [ -n "$P" ]; then tmux select-pane -t "$P"; fi`;
        await exec.exec("tmux", [
          "bind-key", "-n", `M-${slot}`,
          "if-shell", "-F", dashboardGuard,
          `run-shell ${shellQuote(script)}`,
          `send-keys Escape ${slot}`,
        ]);
      }
    } catch (error) {
      await removeSidebarReturnBindingUnlocked({ stateDir, onlyOwnerPid: process.pid }, exec);
      throw error;
    }
  });
}

export async function removeSidebarReturnBinding(
  options: { stateDir?: string; onlyOwnerPid?: number; refuseLiveForeignOwner?: boolean } = {},
  exec: TmuxExec = realTmuxExec,
): Promise<void> {
  const stateDir = options.stateDir ?? join(sessionsStateDir(), "sidebar-return");
  await withFileLock(join(stateDir, "active.json"), () => removeSidebarReturnBindingUnlocked({ ...options, stateDir }, exec));
}

async function removeSidebarReturnBindingUnlocked(
  options: { stateDir: string; onlyOwnerPid?: number; refuseLiveForeignOwner?: boolean },
  exec: TmuxExec,
): Promise<void> {
  const activePath = join(options.stateDir, "active.json");
  let active: ActiveSidebarReturnBinding;
  try {
    active = JSON.parse(await readFile(activePath, "utf8")) as ActiveSidebarReturnBinding;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  if (options.onlyOwnerPid !== undefined && active.ownerPid !== options.onlyOwnerPid) return;
  if (options.refuseLiveForeignOwner && active.ownerPid !== process.pid && isProcessAlive(active.ownerPid)) {
    throw new Error(`tmux sidebar return binding is already active for pid ${active.ownerPid}`);
  }
  for (const key of active.keys ?? [active.returnKey]) {
    try {
      await exec.exec("tmux", ["unbind-key", "-T", "root", key]);
    } catch (error) {
      if (!errorMessage(error).includes("unknown key")) throw error;
    }
  }
  let previous = "";
  try {
    previous = await readFile(active.restorePath, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  if (previous.trim()) await exec.exec("tmux", ["source-file", active.restorePath]);
  await rm(active.restorePath, { force: true });
  await rm(activePath, { force: true });
}

export async function reconcileSidebarReturnBinding(options: {
  desired: boolean;
  dashboardSession: string;
  sidebarPane: string;
  stateDir?: string;
  switchStateDir?: string;
}, exec: TmuxExec = realTmuxExec): Promise<void> {
  const switchBinding = await inspectSwitchReturnBinding({ stateDir: options.switchStateDir });
  if (switchBinding.active && !switchBinding.stale) return;
  if (switchBinding.active) {
    await restoreSwitchReturnBinding({ stateDir: options.switchStateDir, onlyOwnerPid: switchBinding.ownerPid }, exec);
    if ((await inspectSwitchReturnBinding({ stateDir: options.switchStateDir })).active) return;
  }

  const sidebarBinding = await inspectSidebarReturnBinding({ stateDir: options.stateDir });
  if (options.desired) {
    if (sidebarBinding.active && !sidebarBinding.stale) return;
    await installSidebarReturnBinding({
      dashboardSession: options.dashboardSession,
      sidebarPane: options.sidebarPane,
      stateDir: options.stateDir,
    }, exec);
    return;
  }
  if (sidebarBinding.active && (sidebarBinding.stale || sidebarBinding.ownerPid === process.pid)) {
    await removeSidebarReturnBinding({ stateDir: options.stateDir, onlyOwnerPid: sidebarBinding.ownerPid }, exec);
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
    if (isErrno(error, "ENOENT")) return;
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
      if (!isErrno(error, "ENOENT")) throw error;
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
    return isErrno(error, "EPERM");
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

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
