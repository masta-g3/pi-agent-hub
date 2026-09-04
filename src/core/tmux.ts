import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { isErrno, readJsonOr, withFileLock, writeJsonAtomic } from "./atomic-json.js";
import { tmuxChromeFromTheme, type ChromeThemeTokens, type TmuxChrome } from "./chrome.js";
import { MANAGED_SESSION_PREFIX } from "./names.js";
import { sessionsStateDir } from "./paths.js";
import { plainTerminalText } from "./terminal-text.js";
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

export type TmuxPresence = "present" | "missing" | "unknown";

export interface TmuxPresenceResult {
  presence: TmuxPresence;
  error?: string;
}

export async function listSessions(exec: TmuxExec = realTmuxExec): Promise<Set<string>> {
  const result = await exec.exec("tmux", ["list-sessions", "-F", "#{session_name}"]);
  return new Set(result.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean));
}

export async function sessionPresenceSnapshot(
  names: readonly string[],
  exec: TmuxExec = realTmuxExec,
): Promise<Map<string, TmuxPresenceResult>> {
  try {
    const listed = await listSessions(exec);
    return new Map(names.map((name) => [name, { presence: listed.has(name) ? "present" : "missing" }]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const presence: TmuxPresence = /no server running|no server/i.test(message) ? "missing" : "unknown";
    return new Map(names.map((name) => [name, { presence, ...(presence === "unknown" ? { error: message } : {}) }]));
  }
}

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
  title?: string;
}

export async function listWindowPanes(pane: string, exec: TmuxExec = realTmuxExec): Promise<WindowPane[]> {
  const format = "#{pane_id}\t#{pane_tty}\t#{pane_active}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{window_width}\t#{window_height}\t#{@pi_hub_slot}\t#{pane_title}";
  const result = await exec.exec("tmux", ["list-panes", "-t", pane, "-F", format]);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    // The first ten fields have fixed meaning. Rejoin the rest because pane
    // titles may contain tabs (and spaces must never be collapsed).
    const fields = line.includes("\t") ? line.split("\t") : line.trim().split(/\s+/);
    const [id, tty, active, ...rest] = fields;
    const geometryText = rest.slice(0, 6);
    const geometry = geometryText.map(Number);
    if (!id || !tty || geometry.length !== 6 || geometry.some((value) => !Number.isFinite(value))) return [];
    const [left, top, width, height, windowWidth, windowHeight] = geometry as [number, number, number, number, number, number];
    const slot = Number(rest[6]);
    const title = rest.slice(7).join("\t");
    return [{ id, tty, active: active === "1", left, top, width, height, windowWidth, windowHeight,
      ...(Number.isInteger(slot) && slot >= 1 && slot <= 4 ? { slot } : {}),
      ...(rest.length >= 8 ? { title } : {}),
    }];
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

export interface TmuxClient {
  name: string;
  tty: string;
  session: string;
  paneId: string;
  flags: string[];
}

const TMUX_CLIENT_FORMAT = "#{client_name}\t#{client_tty}\t#{client_session}\t#{pane_id}\t#{client_flags}";

export async function listTmuxClients(exec: TmuxExec = realTmuxExec): Promise<TmuxClient[]> {
  const result = await exec.exec("tmux", ["list-clients", "-F", TMUX_CLIENT_FORMAT]);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const [name, tty, session, paneId, flags] = line.split("\t");
    if (!name || !tty || !session || !paneId || flags === undefined) return [];
    return [{ name, tty, session, paneId, flags: flags.split(",").filter(Boolean) }];
  });
}

export async function displayClientMessage(client: string, message: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  const literal = plainTerminalText(message).replace(/#/gu, "##");
  if (!literal) return;
  await exec.exec("tmux", ["display-message", "-d", "6000", "-c", client, literal]);
}

export async function clientSessionsByTty(exec: TmuxExec = realTmuxExec): Promise<Map<string, string>> {
  return new Map((await listTmuxClients(exec)).map((client) => [client.tty, client.session]));
}

export async function clientSessionByTty(tty: string, exec: TmuxExec = realTmuxExec): Promise<string | undefined> {
  return (await clientSessionsByTty(exec)).get(tty);
}

export async function sendTextToSession(name: string, text: string, exec: TmuxExec = realTmuxExec): Promise<void> {
  const buffer = `pi-agent-hub-send-${process.pid}`;
  await exec.exec("tmux", ["set-buffer", "-b", buffer, "--", text]);
  await exec.exec("tmux", ["paste-buffer", "-d", "-b", buffer, "-t", name]);
  await exec.exec("tmux", ["send-keys", "-t", name, "Enter"]);
}

type TmuxStatusOption = readonly [key: string, value: string];

function statusBarArgs(options: {
  name: string;
  chrome: TmuxChrome;
  visible?: boolean;
  sideOptions: readonly TmuxStatusOption[];
}): string[] {
  const setOption = (key: string, value: string): string[] => [";", "set-option", "-t", options.name, key, value];
  return [
    "set-option", "-t", options.name, "status", options.visible === false ? "off" : "on",
    ...setOption("status-style", options.chrome.statusStyle),
    ...options.sideOptions.flatMap(([key, value]) => setOption(key, value)),
    ...setOption("window-status-style", options.chrome.windowStatusStyle),
    ...setOption("window-status-current-style", options.chrome.windowStatusCurrentStyle),
    ...setOption("window-status-format", " #I:#W#F "),
    ...setOption("window-status-current-format", " #I:#W#F "),
  ];
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
  await exec.exec("tmux", statusBarArgs({
    name: options.name,
    chrome,
    visible: options.visible,
    sideOptions: [
      ["status-right", statusRight],
      ["status-right-length", "100"],
      ["status-left", ""],
      ["status-left-length", "120"],
    ],
  }));
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
  await exec.exec("tmux", statusBarArgs({
    name: options.name,
    chrome,
    visible: options.visible,
    sideOptions: [
      ["status-left", ""],
      ["status-right", statusRight],
      ["status-right-length", "100"],
    ],
  }));
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
  const returnKeys = [returnKey];
  const keyBindings: SavedKeyBinding[] = [];
  for (const key of returnKeys) {
    await writeFile(restorePath, await currentKeyBinding(key, exec), "utf8");
    keyBindings.push({ key, restorePath });
  }
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
    for (const key of returnKeys) {
      await exec.exec("tmux", ["bind-key", "-n", key, "run-shell", returnBindingScript({
        controlSession,
        activePath,
        managedPrefix,
        keyBindings,
        returnSession: options.returnSession,
        action: {
          path: actionPath,
          json: JSON.stringify({ action: "return", key: "ctrl-q" }),
        },
      })]);
    }
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
  const active = await readJsonOr<ActiveReturnBinding | undefined>(activePath, undefined);
  if (active === undefined) return { active: false };
  return { ...active, active: true, stale: !isProcessAlive(active.ownerPid) };
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
  const active = await readJsonOr<ActiveSidebarReturnBinding | undefined>(join(stateDir, "active.json"), undefined);
  if (active === undefined) return { active: false };
  return { ...active, keys: active.keys ?? [active.returnKey], active: true, stale: !isProcessAlive(active.ownerPid) };
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
    const keys = [...new Set([returnKey, "M-1", "M-2", "M-3", "M-4", "M-Left", "M-Right", "M-Up", "M-Down"])];
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
    const bindIntent = (key: string, delivered = key) => exec.exec("tmux", [
      "bind-key", "-n", key,
      "if-shell", "-F", dashboardGuard,
      `send-keys -t ${shellQuote(options.sidebarPane)} ${delivered}`,
      `send-keys ${key}`,
    ]);
    try {
      await bindIntent(returnKey);
      for (const slot of [1, 2, 3, 4]) await bindIntent(`M-${slot}`, `Escape '${slot}'`);
      const arrows = { Left: "D", Right: "C", Up: "A", Down: "B" } as const;
      for (const [direction, suffix] of Object.entries(arrows)) {
        await bindIntent(`M-${direction}`, `Escape '[1;3${suffix}'`);
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
  const active = await readJsonOr<ActiveSidebarReturnBinding | undefined>(activePath, undefined);
  if (active === undefined) return;
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
  const active = await readJsonOr<ActiveReturnBinding | undefined>(activePath, undefined);
  if (active === undefined) return;

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
