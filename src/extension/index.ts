import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { basename, join } from "node:path";
import { FORK_COMPACT_ENV, KIND_ENV, PARENT_ID_ENV, PRIMARY_CWD_ENV, SESSION_ID_ENV, STATE_ENV, WORKTREE_GUIDANCE_ENV } from "../core/names.js";
import { WORKTREE_GUIDANCE_MAX_LENGTH } from "../core/worktree-context.js";
import { sessionsStateDir } from "../core/paths.js";
import { loadThemeCommand } from "../core/theme-command.js";
import { colorFromAnsi } from "../core/theme-color.js";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS } from "../core/status.js";
import { parseWorkflowRuntime } from "../core/heartbeat.js";
import { registerMcpTools } from "../mcp/register-tools.js";
import { parseSessionContext } from "../core/session-context.js";
import { writeJsonAtomic } from "../core/atomic-json.js";
import type { ActiveThemeSnapshot, ActiveThemeToken, Heartbeat, HeartbeatOperation } from "../core/types.js";

type PiTheme = {
  name?: string;
  sourcePath?: string;
  getFgAnsi?: (token: string) => string;
};

type PiContext = {
  cwd: string;
  hasUI?: boolean;
  compact: (options?: { customInstructions?: string; onComplete?: () => void; onError?: (error: Error) => void }) => void;
  ui?: {
    theme?: PiTheme;
    getTheme?: (name: string) => Theme | undefined;
    setTheme?: (theme: string | Theme) => unknown;
  };
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string | undefined;
    getBranch?: () => unknown[] | undefined;
  };
};

const EXTENSION_KEY = Symbol.for("pi-agent-hub.extension.loaded");
type PiAgentHubGlobal = typeof globalThis & { [EXTENSION_KEY]?: true };

// statusLineBg and selectedBg are background tokens Pi's getFgAnsi cannot
// capture; disk theme resolution supplies them instead.
const THEME_TOKENS: Exclude<ActiveThemeToken, "statusLineBg" | "selectedBg">[] = ["accent", "success", "warning", "error", "muted", "dim", "text", "border"];

// Soft contract with rules/extensions/workflow-runtime. Invalid or absent
// base workflow metadata hides the rail; invalid mode decoration is omitted.
const WORKFLOW_RUNTIME_ENTRY = "workflow-runtime";
const SESSION_CONTEXT_ENTRY = "pi-agent-hub-context";
const STARTUP_HEARTBEAT_DELAYS_MS = [250, 1_000, 3_000];
const SETTLED_HEARTBEAT_DELAYS_MS = [1_000, 3_000, 6_000];
const THEME_COMMAND_INTERVAL_MS = 1_000;
const FORK_COMPACT_INSTRUCTIONS = "This session branches from the prior conversation. Another agent will continue that prior work. Preserve product decisions and unresolved context from the discussion that code and docs cannot show. Stop pursuing the prior task and wait for a new task from the user, which may be related or unrelated.";
const FORK_COMPACT_OPERATION_ID_LENGTH = 16;

export default function piAgentHubExtension(pi: ExtensionAPI) {
  const globalState = globalThis as PiAgentHubGlobal;
  if (globalState[EXTENSION_KEY]) return;
  globalState[EXTENSION_KEY] = true;

  const extensionStartedAt = Date.now();
  let currentState: Heartbeat["state"] = "starting";
  let stateSince = extensionStartedAt;
  let forkCompactPending = process.env[FORK_COMPACT_ENV] === "1";
  if (forkCompactPending) delete process.env[FORK_COMPACT_ENV];
  const forkCompactOperationId = forkCompactPending ? extensionStartedAt.toString(36).slice(-FORK_COMPACT_OPERATION_ID_LENGTH) : undefined;
  let forkCompactOperation: HeartbeatOperation | undefined;
  let metadataResetAt: number | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let themeCommandTimer: ReturnType<typeof setInterval> | undefined;
  let startupHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let startupCompactionTimer: ReturnType<typeof setTimeout> | undefined;
  let settledHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let compactionSnapshot: { state: Heartbeat["state"]; stateSince: number } | undefined;
  let compactOperation: HeartbeatOperation | undefined;
  let compactionWatchdog: ReturnType<typeof setTimeout> | undefined;
  let lifecycleRevision = 0;
  let promptSnapshot: { state: Heartbeat["state"]; stateSince: number; ownedRevision: number } | undefined;
  let heartbeatWrite: Promise<void> = Promise.resolve();
  let lastThemeRevision: string | undefined;
  let mcpCleanup: (() => Promise<void>) | undefined;

  async function applyThemeCommand(ctx: PiContext): Promise<boolean> {
    if (!process.env[SESSION_ID_ENV] || process.env.PI_TMUX_SUBAGENTS_JOB_ID || ctx.hasUI === false || !ctx.ui?.getTheme || !ctx.ui.setTheme) return false;
    try {
      const command = await loadThemeCommand();
      if (!command || command.revision === lastThemeRevision) return false;
      lastThemeRevision = command.revision;
      if (command.updatedAt <= extensionStartedAt) return false;
      const theme = ctx.ui.getTheme(command.resolvedTheme);
      if (!theme) return false;
      ctx.ui.setTheme(theme);
      return true;
    } catch {
      return false;
    }
  }

  async function applyThemeAndHeartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    await applyThemeCommand(ctx);
    await heartbeat(state, ctx, message);
  }

  async function publishLifecycle(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    lifecycleRevision += 1;
    await applyThemeAndHeartbeat(state, ctx, message);
  }

  async function heartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string, stateSinceOverride?: number) {
    // pi-tmux-subagents child bootstrap owns its richer Agent Hub heartbeat.
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const id = process.env[SESSION_ID_ENV];
    if (!id) return;
    if (state !== currentState || stateSinceOverride !== undefined) {
      currentState = state;
      stateSince = stateSinceOverride ?? Date.now();
    }
    const file = join(process.env[STATE_ENV] ?? sessionsStateDir(), "heartbeats", `${id}.json`);
    const write = heartbeatWrite.then(async () => {
      await writeJsonAtomic(file, {
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
        piSessionName: normalizedName(pi.getSessionName?.()),
        context: sessionContextSnapshot(ctx, metadataResetAt),
        ...workflowRuntime(ctx, metadataResetAt),
        ...(forkCompactOperation ? { operation: forkCompactOperation } : compactOperation ? { operation: compactOperation } : {}),
      } satisfies Heartbeat);
    });
    heartbeatWrite = write.catch(() => undefined);
    await write;
  }

  pi.on("before_agent_start", async (event) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const guidance = process.env[WORKTREE_GUIDANCE_ENV]?.trim();
    if (!guidance || guidance.length > WORKTREE_GUIDANCE_MAX_LENGTH) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    const piCtx = ctx as PiContext;
    const compactFork = forkCompactPending;
    if (compactFork) {
      forkCompactPending = false;
      metadataResetAt = extensionStartedAt;
      forkCompactOperation = { kind: "fork-compact", phase: "running", id: forkCompactOperationId ?? extensionStartedAt.toString(36) };
      const resetName = basename(process.env[PRIMARY_CWD_ENV] ?? "").trim() || "pi-session";
      pi.setSessionName(resetName);
    }
    await publishLifecycle("waiting", piCtx);
    heartbeatTimer = setInterval(() => void heartbeat(currentState, piCtx), HEARTBEAT_INTERVAL_MS);
    themeCommandTimer = setInterval(() => void applyThemeCommand(piCtx).then((applied) => applied ? heartbeat(currentState, piCtx) : undefined), THEME_COMMAND_INTERVAL_MS);
    startupHeartbeatTimers = STARTUP_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void applyThemeAndHeartbeat(currentState, piCtx), delay));
    if (compactFork) {
      startupCompactionTimer = setTimeout(() => piCtx.compact({
        customInstructions: FORK_COMPACT_INSTRUCTIONS,
        onComplete: () => completeForkCompaction(piCtx),
        onError: (error) => failForkCompaction(piCtx, error),
      }), 0);
    }
    mcpCleanup = await registerMcpTools(pi, piCtx.cwd);
  });

  pi.on("session_info_changed", async (_event, ctx) => applyThemeAndHeartbeat(currentState, ctx as PiContext));
  const clearCompaction = () => {
    if (compactionWatchdog) clearTimeout(compactionWatchdog);
    compactionWatchdog = undefined;
    compactionSnapshot = undefined;
    compactOperation = undefined;
  };

  const restoreCompaction = async (ctx: PiContext) => {
    const snapshot = compactionSnapshot;
    clearCompaction();
    if (snapshot) {
      lifecycleRevision += 1;
      await heartbeat(snapshot.state, ctx, undefined, snapshot.stateSince);
    }
  };

  const completeForkCompaction = async (ctx: PiContext) => {
    await restoreCompaction(ctx);
    if (!forkCompactOperation) return;
    forkCompactOperation = { ...forkCompactOperation, phase: "complete" };
    await heartbeat(currentState, ctx);
    forkCompactOperation = undefined;
  };

  const failForkCompaction = async (ctx: PiContext, error: Error) => {
    clearCompaction();
    if (forkCompactOperation) {
      forkCompactOperation = { kind: "fork-compact", phase: "error", id: forkCompactOperation.id };
      await publishLifecycle("error", ctx, `Fork compaction failed: ${error.message}`);
    } else {
      await publishLifecycle("error", ctx, `Fork compaction failed: ${error.message}`);
    }
  };

  pi.on("agent_start", async (_event, ctx) => {
    clearCompaction();
    for (const timer of settledHeartbeatTimers) clearTimeout(timer);
    settledHeartbeatTimers = [];
    await publishLifecycle("running", ctx as PiContext);
  });
  pi.on("agent_end", async (_event, ctx) => {
    clearCompaction();
    await publishLifecycle("waiting", ctx as PiContext);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    clearCompaction();
    await publishLifecycle("waiting", ctx as PiContext);
    for (const timer of settledHeartbeatTimers) clearTimeout(timer);
    settledHeartbeatTimers = SETTLED_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void heartbeat(currentState, ctx as PiContext), delay));
  });
  pi.on("session_before_compact", async (_event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    clearCompaction();
    const snapshot = { state: currentState, stateSince };
    compactionSnapshot = snapshot;
    compactOperation = { kind: "compact", phase: "running", id: Date.now().toString(36).slice(-FORK_COMPACT_OPERATION_ID_LENGTH) };
    lifecycleRevision += 1;
    compactionWatchdog = setTimeout(() => {
      if (compactionSnapshot !== snapshot) return;
      void restoreCompaction(ctx as PiContext);
    }, HEARTBEAT_STALE_MS);
    await heartbeat("running", ctx as PiContext, undefined, snapshot.stateSince);
  });
  pi.on("session_compact", async (event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    if (event.willRetry) {
      const snapshot = compactionSnapshot;
      clearCompaction();
      lifecycleRevision += 1;
      await heartbeat("running", ctx as PiContext, undefined, snapshot?.stateSince);
      return;
    }
    await restoreCompaction(ctx as PiContext);
  });
  (pi.on as any)("ui_prompt_start", async (_event: unknown, ctx: PiContext) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID || promptSnapshot) return;
    lifecycleRevision += 1;
    promptSnapshot = { state: currentState, stateSince, ownedRevision: lifecycleRevision };
    await heartbeat("waiting", ctx as PiContext);
  });
  (pi.on as any)("ui_prompt_end", async (_event: unknown, ctx: PiContext) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const snapshot = promptSnapshot;
    promptSnapshot = undefined;
    if (!snapshot || lifecycleRevision !== snapshot.ownedRevision) return;
    lifecycleRevision += 1;
    await heartbeat(snapshot.state, ctx as PiContext, undefined, snapshot.stateSince);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      clearCompaction();
      promptSnapshot = undefined;
      lifecycleRevision += 1;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (themeCommandTimer) clearInterval(themeCommandTimer);
      for (const timer of startupHeartbeatTimers) clearTimeout(timer);
      startupHeartbeatTimers = [];
      if (startupCompactionTimer) clearTimeout(startupCompactionTimer);
      startupCompactionTimer = undefined;
      for (const timer of settledHeartbeatTimers) clearTimeout(timer);
      settledHeartbeatTimers = [];
      await mcpCleanup?.();
      await heartbeat("shutdown", ctx as PiContext);
    } finally {
      delete globalState[EXTENSION_KEY];
    }
  });
}

function workflowRuntime(ctx: PiContext, minimumEntryTime?: number): Pick<Heartbeat, "workflow" | "activeMode"> | undefined {
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== WORKFLOW_RUNTIME_ENTRY) continue;
      if (minimumEntryTime !== undefined && entryUpdatedAt(entry.data) < minimumEntryTime) continue;
      const parsed = parseWorkflowRuntime(entry.data);
      const runtime = {
        ...(parsed.workflow ? { workflow: parsed.workflow } : {}),
        ...(parsed.activeMode ? { activeMode: parsed.activeMode } : {}),
      };
      return Object.keys(runtime).length ? runtime : undefined;
    }
  } catch {}
  return undefined;
}

function entryUpdatedAt(data: unknown): number {
  if (typeof data !== "object" || data === null) return 0;
  const updatedAt = (data as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0;
}

function sessionContextSnapshot(ctx: PiContext, minimumEntryTime?: number) {
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== SESSION_CONTEXT_ENTRY) continue;
      if (minimumEntryTime !== undefined && entryUpdatedAt(entry.data) < minimumEntryTime) continue;
      return parseSessionContext(entry.data);
    }
  } catch {}
  return undefined;
}

function normalizedName(value: string | undefined): string | undefined { return value?.trim() || undefined; }

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
