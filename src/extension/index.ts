import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KIND_ENV, PARENT_ID_ENV, SESSION_ID_ENV, STATE_ENV } from "../core/names.js";
import { sessionsStateDir } from "../core/paths.js";
import { HEARTBEAT_INTERVAL_MS } from "../core/status.js";
import { registerMcpTools } from "../mcp/register-tools.js";
import type { ActiveThemeSnapshot, ActiveThemeToken, Heartbeat } from "../core/types.js";

type PiTheme = {
  name?: string;
  sourcePath?: string;
  getFgAnsi?: (token: string) => string;
};

type PiContext = {
  cwd: string;
  hasUI?: boolean;
  ui?: {
    theme?: PiTheme;
  };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
  };
};

const EXTENSION_KEY = Symbol.for("pi-agent-hub.extension.loaded");
type PiAgentHubGlobal = typeof globalThis & { [EXTENSION_KEY]?: true };

const THEME_TOKENS: Exclude<ActiveThemeToken, "statusLineBg">[] = ["accent", "success", "warning", "error", "muted", "dim", "text", "border"];
const STARTUP_HEARTBEAT_DELAYS_MS = [250, 1_000, 3_000];

export default function piAgentHubExtension(pi: ExtensionAPI) {
  const globalState = globalThis as PiAgentHubGlobal;
  if (globalState[EXTENSION_KEY]) return;
  globalState[EXTENSION_KEY] = true;

  let currentState: Heartbeat["state"] = "starting";
  let stateSince = Date.now();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let startupHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let mcpCleanup: (() => Promise<void>) | undefined;

  async function heartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    const id = process.env[SESSION_ID_ENV];
    if (!id) return;
    if (state !== currentState) {
      currentState = state;
      stateSince = Date.now();
    }
    const file = join(process.env[STATE_ENV] ?? sessionsStateDir(), "heartbeats", `${id}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify({
      managedSessionId: id,
      cwd: ctx.cwd,
      piSessionFile: ctx.sessionManager?.getSessionFile?.(),
      piSessionId: ctx.sessionManager?.getSessionId?.(),
      state,
      stateSince,
      message,
      updatedAt: Date.now(),
      kind: process.env[KIND_ENV] as "subagent" | undefined,
      parentId: process.env[PARENT_ID_ENV],
      agentName: process.env.PI_SUBAGENT_AGENT,
      taskPreview: process.env.PI_SUBAGENT_TASK_PREVIEW,
      resultPath: process.env.PI_SUBAGENT_RESULT_PATH,
      activeTheme: activeTheme(ctx),
    } satisfies Heartbeat, null, 2)}\n`, "utf8");
  }

  pi.on("session_start", async (_event, ctx) => {
    await heartbeat("waiting", ctx as PiContext);
    heartbeatTimer = setInterval(() => void heartbeat(currentState, ctx as PiContext), HEARTBEAT_INTERVAL_MS);
    startupHeartbeatTimers = STARTUP_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void heartbeat(currentState, ctx as PiContext), delay));
    mcpCleanup = await registerMcpTools(pi, (ctx as PiContext).cwd);
  });

  pi.on("agent_start", async (_event, ctx) => heartbeat("running", ctx as PiContext));
  pi.on("agent_end", async (_event, ctx) => heartbeat("waiting", ctx as PiContext));
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const timer of startupHeartbeatTimers) clearTimeout(timer);
      startupHeartbeatTimers = [];
      await mcpCleanup?.();
      await heartbeat("shutdown", ctx as PiContext);
    } finally {
      delete globalState[EXTENSION_KEY];
    }
  });
}

function activeTheme(ctx: PiContext): ActiveThemeSnapshot | undefined {
  if (ctx.hasUI === false) return undefined;
  let theme: PiTheme | undefined;
  try {
    theme = ctx.ui?.theme;
  } catch {
    return undefined;
  }
  if (!theme) return undefined;
  const tokens = activeThemeTokens(theme);
  const snapshot: ActiveThemeSnapshot = {
    name: theme.name,
    sourcePath: theme.sourcePath,
    tokens: Object.keys(tokens).length ? tokens : undefined,
  };
  return snapshot.name || snapshot.sourcePath || snapshot.tokens ? snapshot : undefined;
}

function activeThemeTokens(theme: PiTheme): NonNullable<ActiveThemeSnapshot["tokens"]> {
  const tokens: NonNullable<ActiveThemeSnapshot["tokens"]> = {};
  for (const token of THEME_TOKENS) {
    const value = themeToken(theme, token);
    if (value !== undefined) tokens[token] = value;
  }
  return tokens;
}

function themeToken(theme: PiTheme, token: Exclude<ActiveThemeToken, "statusLineBg">): string | number | undefined {
  try {
    const ansi = theme.getFgAnsi?.(token);
    return ansi ? colorFromAnsi(ansi) : undefined;
  } catch {
    return undefined;
  }
}

function colorFromAnsi(ansi: string): string | number | undefined {
  if (/\u001b\[39m/.test(ansi)) return "";
  const truecolor = /\u001b\[38;2;(\d+);(\d+);(\d+)m/.exec(ansi);
  if (truecolor) {
    const rgb = truecolor.slice(1, 4).map((part) => Number(part));
    if (rgb.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  const indexed = /\u001b\[38;5;(\d+)m/.exec(ansi);
  if (indexed) {
    const value = Number(indexed[1]);
    if (Number.isInteger(value) && value >= 0 && value <= 255) return value;
  }
  return undefined;
}
