import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { startSessionInteraction } from "./session-interaction.js";
import { forkResetReady } from "./fork-compact.js";
import { join } from "node:path";
import { FORK_COMPACT_ENV, KIND_ENV, PARENT_ID_ENV, SESSION_ID_ENV, STATE_ENV, WORKTREE_GUIDANCE_ENV } from "../core/names.js";
import { WORKTREE_GUIDANCE_MAX_LENGTH } from "../core/worktree-context.js";
import { sessionsStateDir } from "../core/paths.js";
import { loadThemeCommand } from "../core/theme-command.js";
import { loadNameCommand, NAME_COMMAND_TIMEOUT_MS } from "../core/name-command.js";
import { colorFromAnsi } from "../core/theme-color.js";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS } from "../core/status.js";
import { parseWorkflowEntry } from "../core/heartbeat.js";
import { registerMcpTools } from "../mcp/register-tools.js";
import { parseSessionContext } from "../core/session-context.js";
import { writeJsonAtomic } from "../core/atomic-json.js";
import type { ActiveThemeSnapshot, ActiveThemeToken, Heartbeat, HeartbeatOperation, WorkflowRuntimeSnapshot } from "../core/types.js";

type PiTheme = {
  name?: string;
  sourcePath?: string;
  getFgAnsi?: (token: string) => string;
};

type PiContext = {
  cwd: string;
  hasUI?: boolean;
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  compact: (options?: { customInstructions?: string; onComplete?: () => void; onError?: (error: Error) => void }) => void;
  ui?: {
    theme?: PiTheme;
    getEditorText?: () => string;
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
const COMMAND_INTERVAL_MS = 1_000;
const FORK_COMPACT_INSTRUCTIONS = "This session branches from the prior conversation. Another agent will continue that prior work. Preserve product decisions and unresolved context from the discussion that code and docs cannot show. Stop pursuing the prior task and wait for a new task from the user, which may be related or unrelated.";
const FORK_RESET_TIMEOUT_MS = 5_000;
const FORK_RESET_POLL_MS = 50;
const FORK_ATTEMPT_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

export default function piAgentHubExtension(pi: ExtensionAPI, dependencies: {
  startInteraction?: typeof startSessionInteraction;
  registerMcp?: typeof registerMcpTools;
} = {}) {
  const globalState = globalThis as PiAgentHubGlobal;
  if (globalState[EXTENSION_KEY]) return;
  globalState[EXTENSION_KEY] = true;

  const extensionStartedAt = Date.now();
  let currentState: Heartbeat["state"] = "starting";
  let stateSince = extensionStartedAt;
  const rawForkAttempt = process.env[FORK_COMPACT_ENV];
  const forkAttempt = rawForkAttempt && FORK_ATTEMPT_PATTERN.test(rawForkAttempt) ? rawForkAttempt : undefined;
  let forkCompactPending = rawForkAttempt !== undefined;
  let forkCompactOperation: HeartbeatOperation | undefined;
  let startupGeneration = 0;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let commandTimer: ReturnType<typeof setInterval> | undefined;
  let startupHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let startupCompactionTimer: ReturnType<typeof setTimeout> | undefined;
  let settledHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let compactionSnapshot: { state: Heartbeat["state"]; stateSince: number } | undefined;
  let compactionWatchdog: ReturnType<typeof setTimeout> | undefined;
  let lifecycleRevision = 0;
  let promptSnapshot: { state: Heartbeat["state"]; stateSince: number; ownedRevision: number } | undefined;
  let heartbeatWrite: Promise<void> = Promise.resolve();
  let lastThemeRevision: string | undefined;
  let lastNameRevision: string | undefined;
  let acceptingNameCommands = false;
  let mcpCleanup: (() => Promise<void>) | undefined;
  let interaction: Awaited<ReturnType<typeof startSessionInteraction>> | undefined;

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

  async function applyNameCommand(ctx: PiContext): Promise<void> {
    const id = process.env[SESSION_ID_ENV];
    if (!id || process.env.PI_TMUX_SUBAGENTS_JOB_ID || !acceptingNameCommands) return;
    try {
      const command = await loadNameCommand(id);
      if (!acceptingNameCommands || !command || command.revision === lastNameRevision
        || command.piSessionId !== ctx.sessionManager?.getSessionId?.()
        || command.updatedAt <= extensionStartedAt || command.updatedAt > Date.now()
        || Date.now() - command.updatedAt >= NAME_COMMAND_TIMEOUT_MS) return;
      lastNameRevision = command.revision;
      if (sessionContextSnapshot(ctx)?.ticket) return;
      pi.setSessionName(command.name);
      await heartbeat(currentState, ctx);
    } catch {
      // The caller requires heartbeat confirmation and reports a timeout on failure.
    }
  }

  async function applyThemeAndHeartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    await applyThemeCommand(ctx);
    await heartbeat(state, ctx, message);
  }

  async function publishLifecycle(state: Heartbeat["state"], ctx: PiContext, message?: string) {
    lifecycleRevision += 1;
    interaction?.lifecycleChanged();
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
        ...(state !== "shutdown" && interaction ? { interaction: { version: 1 as const, instanceId: interaction.target.instanceId } } : {}),
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
        context: sessionContextSnapshot(ctx),
        workflow: workflowSnapshot(ctx),
        ...(forkCompactOperation ? { operation: forkCompactOperation } : {}),
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
    const generation = ++startupGeneration;
    const managedId = process.env[SESSION_ID_ENV];
    const piSessionId = piCtx.sessionManager?.getSessionId?.();
    const active = () => startupGeneration === generation && process.env[SESSION_ID_ENV] === managedId
      && piCtx.sessionManager?.getSessionId?.() === piSessionId;
    promptSnapshot = undefined;

    const startInteraction = async () => {
      await interaction?.close();
      if (!active()) return;
      interaction = undefined;
      if (managedId && piSessionId && !process.env.PI_TMUX_SUBAGENTS_JOB_ID && process.env[KIND_ENV] !== "subagent"
        && piCtx.sessionManager?.getBranch && piCtx.isIdle && piCtx.hasPendingMessages && piCtx.ui?.getEditorText && pi.events) {
        const started = await (dependencies.startInteraction ?? startSessionInteraction)({
          managedId, piSessionId, events: pi.events,
          getPiSessionId: () => piCtx.sessionManager?.getSessionId?.(),
          getBranch: () => piCtx.sessionManager!.getBranch!() ?? [],
          isIdle: () => piCtx.isIdle!(), hasPendingMessages: () => piCtx.hasPendingMessages!(),
          getEditorText: () => piCtx.ui!.getEditorText!(),
          uiPromptOpen: () => Boolean(promptSnapshot) || Boolean(forkCompactOperation),
          sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
        });
        if (!active()) await started.close();
        else interaction = started;
      }
    };
    const startMcp = async () => {
      const cleanup = await (dependencies.registerMcp ?? registerMcpTools)(pi, piCtx.cwd);
      if (!active()) await cleanup();
      else mcpCleanup = cleanup;
    };
    const startHeartbeat = async () => {
      await publishLifecycle("waiting", piCtx);
      if (!active()) return;
      heartbeatTimer = setInterval(() => void heartbeat(currentState, piCtx), HEARTBEAT_INTERVAL_MS);
      acceptingNameCommands = true;
      commandTimer = setInterval(() => {
        void applyNameCommand(piCtx);
        void applyThemeCommand(piCtx).then((applied) => applied ? heartbeat(currentState, piCtx) : undefined);
      }, COMMAND_INTERVAL_MS);
      startupHeartbeatTimers = STARTUP_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void applyThemeAndHeartbeat(currentState, piCtx), delay));
    };

    if (!forkCompactPending) {
      await startInteraction();
      if (!active()) return;
      await startHeartbeat();
      if (active()) await startMcp();
      return;
    }
    delete process.env[FORK_COMPACT_ENV];
    forkCompactPending = false;
    if (forkAttempt) forkCompactOperation = { kind: "fork-compact", phase: "running", id: forkAttempt };
    const fail = async (error: Error) => {
      if (active()) await failForkCompaction(piCtx, error);
    };
    const pending = () => active() && forkCompactOperation?.phase === "running";
    // Pi awaits startup handlers in order. Neither the reset gate nor service
    // initialization may hold up the producer's later session_start handler.
    startupCompactionTimer = setTimeout(() => {
      startupCompactionTimer = undefined;
      if (!active()) return;
      void startHeartbeat().catch(fail);
      void startInteraction().catch(fail);
      void startMcp().catch(fail);
      if (!forkAttempt) {
        void fail(new Error("Invalid fork reset token. Update Hub and retry from the original session."));
        return;
      }
      const deadline = Date.now() + FORK_RESET_TIMEOUT_MS;
      const check = () => {
        startupCompactionTimer = undefined;
        if (!pending()) return;
        try {
          if (forkResetReady(piCtx.sessionManager?.getBranch?.() ?? [], forkAttempt)) {
            piCtx.compact({
              customInstructions: FORK_COMPACT_INSTRUCTIONS,
              onComplete: () => completeForkCompaction(piCtx, pending),
              onError: fail,
            });
          } else if (Date.now() >= deadline) {
            void fail(new Error("Ticket reset was not confirmed. Enable or update Rules, then retry from the original session."));
          } else startupCompactionTimer = setTimeout(check, FORK_RESET_POLL_MS);
        } catch (error) {
          void fail(error instanceof Error ? error : new Error(String(error)));
        }
      };
      check();
    }, 0);
  });

  pi.on("session_tree", () => { interaction?.branchChanged(); });

  pi.on("session_info_changed", async (_event, ctx) => applyThemeAndHeartbeat(currentState, ctx as PiContext));
  const clearCompaction = () => {
    if (compactionWatchdog) clearTimeout(compactionWatchdog);
    compactionWatchdog = undefined;
    compactionSnapshot = undefined;
  };

  const restoreCompaction = async (ctx: PiContext) => {
    const snapshot = compactionSnapshot;
    clearCompaction();
    if (snapshot) {
      lifecycleRevision += 1;
      await heartbeat(snapshot.state, ctx, undefined, snapshot.stateSince);
    }
  };

  const completeForkCompaction = async (ctx: PiContext, pending: () => boolean) => {
    if (!pending()) return;
    await restoreCompaction(ctx);
    if (!pending() || !forkCompactOperation) return;
    if (!forkResetReady(ctx.sessionManager?.getBranch?.() ?? [], forkCompactOperation.id)) {
      await failForkCompaction(ctx, new Error("Ticket or workflow changed during compaction. Clear it and retry from the original session."));
      return;
    }
    forkCompactOperation = { ...forkCompactOperation, phase: "complete" };
    await heartbeat(currentState, ctx);
    forkCompactOperation = undefined;
  };

  const failForkCompaction = async (ctx: PiContext, error: Error) => {
    clearCompaction();
    if (forkCompactOperation) forkCompactOperation = { ...forkCompactOperation, phase: "error" };
    await publishLifecycle("error", ctx, `Fork compaction failed: ${error.message}`);
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
      clearCompaction();
      lifecycleRevision += 1;
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
    startupGeneration += 1;
    acceptingNameCommands = false;
    try {
      await interaction?.close();
      interaction = undefined;
      clearCompaction();
      promptSnapshot = undefined;
      lifecycleRevision += 1;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (commandTimer) clearInterval(commandTimer);
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

function workflowSnapshot(ctx: PiContext): WorkflowRuntimeSnapshot | undefined {
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== WORKFLOW_RUNTIME_ENTRY) continue;
      return parseWorkflowEntry(entry.data);
    }
  } catch {}
  return undefined;
}

function sessionContextSnapshot(ctx: PiContext) {
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== SESSION_CONTEXT_ENTRY) continue;
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
