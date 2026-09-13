import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { FORK_COMPACT_ENV, KIND_ENV, PARENT_ID_ENV, SESSION_ID_ENV, STATE_ENV, WORKTREE_GUIDANCE_ENV } from "../core/names.js";
import { WORKTREE_GUIDANCE_MAX_LENGTH } from "../core/worktree-context.js";
import { sessionsStateDir } from "../core/paths.js";
import { loadThemeCommand } from "../core/theme-command.js";
import { loadNameCommand, NAME_COMMAND_TIMEOUT_MS } from "../core/name-command.js";
import { colorFromAnsi } from "../core/theme-color.js";
import { HEARTBEAT_INTERVAL_MS } from "../core/status.js";
import { parseWorkflowRuntime } from "../core/heartbeat.js";
import { registerMcpTools } from "../mcp/register-tools.js";
import { parseSessionContext } from "../core/session-context.js";
import { writeJsonAtomic } from "../core/atomic-json.js";
import type { ActiveThemeSnapshot, ActiveThemeToken, ForkPreparation, Heartbeat, HeartbeatOperation } from "../core/types.js";
import { FORK_PREPARATION_ENTRY, RESET_CONFIRMATION_ERROR, RESET_CONFIRMATION_TIMEOUT_MS, WORKFLOW_RESET_CAPABILITY, WORKFLOW_RESET_ENTRY, isNoWorkCompactionError, parseForkAttempt, parsePreparationCheckpoint, resetReceiptMatches } from "./fork-preparation.js";

type PiTheme = {
  name?: string;
  sourcePath?: string;
  getFgAnsi?: (token: string) => string;
};

type PiContext = {
  cwd: string;
  hasUI?: boolean;
  compact: (options?: { customInstructions?: string; onComplete?: (result: unknown) => void; onError?: (error: Error) => void }) => void;
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
const COMPACTION_COMPLETE_DISPLAY_MS = 5_000;

export default function piAgentHubExtension(pi: ExtensionAPI) {
  const globalState = globalThis as PiAgentHubGlobal;
  if (globalState[EXTENSION_KEY]) return;
  globalState[EXTENSION_KEY] = true;

  const extensionStartedAt = Date.now();
  let forkMarkerPending = process.env[FORK_COMPACT_ENV] !== undefined;
  let forkAttemptId = parseForkAttempt(process.env[FORK_COMPACT_ENV]);
  let currentState: Heartbeat["state"] = "starting";
  let stateSince = extensionStartedAt;
  let forkPreparation: ForkPreparation | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let themeCommandTimer: ReturnType<typeof setInterval> | undefined;
  let nameCommandTimer: ReturnType<typeof setInterval> | undefined;
  let startupHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let startupCompactionTimer: ReturnType<typeof setTimeout> | undefined;
  let settledHeartbeatTimers: ReturnType<typeof setTimeout>[] = [];
  let compactionSnapshot: { state: Heartbeat["state"]; stateSince: number; ownedRevision: number } | undefined;
  let compactOperation: HeartbeatOperation | undefined;
  let compactionCompleteTimer: ReturnType<typeof setTimeout> | undefined;
  let lifecycleRevision = 0;
  let promptSnapshot: { state: Heartbeat["state"]; stateSince: number; ownedRevision: number } | undefined;
  let heartbeatWrite: Promise<void> = Promise.resolve();
  let lastThemeRevision: string | undefined;
  let lastNameRevision: string | undefined;
  let acceptingNameCommands = false;
  let mcpCleanup: (() => Promise<void>) | undefined;
  let shuttingDown = false;
  const finalizers = new Set<Promise<void>>();

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
    await applyThemeAndHeartbeat(state, ctx, message);
  }

  async function heartbeat(state: Heartbeat["state"], ctx: PiContext, message?: string, stateSinceOverride?: number) {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const id = process.env[SESSION_ID_ENV];
    if (!id) return;
    if (state !== currentState || stateSinceOverride !== undefined) {
      currentState = state;
      stateSince = stateSinceOverride ?? Date.now();
    }
    const file = join(process.env[STATE_ENV] ?? sessionsStateDir(), "heartbeats", `${id}.json`);
    const snapshot = {
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
      // The registry keeps failed-attempt metadata hidden until the user releases its gate.
      ...(!forkPreparation || forkPreparation.phase === "ready" || forkPreparation.phase === "error" ? {
        context: sessionContextSnapshot(ctx),
        ...workflowRuntime(ctx),
      } : {}),
      ...(compactOperation ? { operation: { ...compactOperation } } : {}),
      ...(forkPreparation ? { forkPreparation: { ...forkPreparation } } : {}),
    } satisfies Heartbeat;
    const write = heartbeatWrite.then(() => writeJsonAtomic(file, snapshot));
    heartbeatWrite = write.catch(() => undefined);
    await write;
  }

  const entries = (ctx: PiContext) => ctx.sessionManager?.getBranch?.() ?? [];
  const customData = (entry: unknown, customType: string): unknown | undefined => {
    const item = entry as { type?: string; customType?: string; data?: unknown } | undefined;
    return item?.type === "custom" && item.customType === customType ? item.data : undefined;
  };

  function matchingCheckpoint(ctx: PiContext): ForkPreparation | undefined {
    const managedSessionId = process.env[SESSION_ID_ENV];
    const piSessionId = ctx.sessionManager?.getSessionId?.();
    if (!managedSessionId || !piSessionId) return undefined;
    const branch = entries(ctx);
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const checkpoint = parsePreparationCheckpoint(customData(branch[index], FORK_PREPARATION_ENTRY));
      if (checkpoint?.managedSessionId === managedSessionId && checkpoint.piSessionId === piSessionId) return checkpoint.preparation;
    }
    return undefined;
  }

  function persistPreparation(ctx: PiContext, preparation: ForkPreparation): void {
    const managedSessionId = process.env[SESSION_ID_ENV];
    const piSessionId = ctx.sessionManager?.getSessionId?.();
    if (!managedSessionId || !piSessionId) throw new Error("Fork preparation identity is unavailable");
    pi.appendEntry(FORK_PREPARATION_ENTRY, { version: 1, managedSessionId, piSessionId, preparation });
    forkPreparation = preparation;
  }

  const isCustomEntry = (entry: unknown, customType: string): boolean => {
    const item = entry as { type?: string; customType?: string } | undefined;
    return item?.type === "custom" && item.customType === customType;
  };

  const hasProducerEntries = (ctx: PiContext) => entries(ctx).some((entry) =>
    isCustomEntry(entry, WORKFLOW_RUNTIME_ENTRY) || isCustomEntry(entry, SESSION_CONTEXT_ENTRY));

  const hasResetReceipt = (ctx: PiContext, attemptId: string) => entries(ctx).some((entry) =>
    resetReceiptMatches(customData(entry, WORKFLOW_RESET_ENTRY), attemptId));

  async function awaitResetReceipt(ctx: PiContext, attemptId: string): Promise<void> {
    const capability = Boolean((globalThis as Record<symbol, unknown>)[WORKFLOW_RESET_CAPABILITY]);
    if (!capability && !hasProducerEntries(ctx)) return;
    const deadline = Date.now() + RESET_CONFIRMATION_TIMEOUT_MS;
    while (!shuttingDown && Date.now() < deadline) {
      if (hasResetReceipt(ctx, attemptId)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(RESET_CONFIRMATION_ERROR);
  }

  function trackFinalizer(work: () => Promise<void>): void {
    if (shuttingDown) return;
    const promise = work().catch(() => undefined).finally(() => finalizers.delete(promise));
    finalizers.add(promise);
  }

  async function finalizePreparation(ctx: PiContext, attemptId: string, outcome: "compacted" | "not-needed" | Error): Promise<void> {
    if (shuttingDown || forkPreparation?.id !== attemptId || forkPreparation.phase === "ready" || forkPreparation.phase === "error") return;
    const result: ForkPreparation = outcome instanceof Error
      ? { id: attemptId, phase: "error", launchConfirmed: true, error: boundedError(outcome.message) }
      : { id: attemptId, phase: "ready", launchConfirmed: true, outcome };
    try {
      persistPreparation(ctx, result);
      await heartbeat(currentState, ctx);
    } catch (error) {
      const failed = { id: attemptId, phase: "error" as const, launchConfirmed: true, error: boundedError(errorMessage(error)) };
      forkPreparation = failed;
      try {
        persistPreparation(ctx, failed);
        await heartbeat(currentState, ctx);
      } catch {}
    }
  }

  async function coordinateForkPreparation(ctx: PiContext, attemptId: string): Promise<void> {
    try {
      await awaitResetReceipt(ctx, attemptId);
      if (shuttingDown || forkPreparation?.id !== attemptId) return;
      persistPreparation(ctx, { id: attemptId, phase: "compacting", launchConfirmed: true });
      await heartbeat(currentState, ctx);
      if (shuttingDown || forkPreparation?.id !== attemptId) return;
      ctx.compact({
        customInstructions: FORK_COMPACT_INSTRUCTIONS,
        onComplete: () => trackFinalizer(() => finalizePreparation(ctx, attemptId, "compacted")),
        onError: (error) => trackFinalizer(() => finalizePreparation(ctx, attemptId, isNoWorkCompactionError(error) ? "not-needed" : error)),
      });
    } catch (error) {
      await finalizePreparation(ctx, attemptId, error instanceof Error ? error : new Error(String(error)));
    }
  }

  pi.on("before_agent_start", async (event) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const guidance = process.env[WORKTREE_GUIDANCE_ENV]?.trim();
    if (!guidance || guidance.length > WORKTREE_GUIDANCE_MAX_LENGTH) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    const piCtx = ctx as PiContext;
    const startupAttemptId = forkAttemptId;
    if (forkMarkerPending) delete process.env[FORK_COMPACT_ENV];
    forkMarkerPending = false;
    forkAttemptId = undefined;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (themeCommandTimer) clearInterval(themeCommandTimer);
    if (nameCommandTimer) clearInterval(nameCommandTimer);
    for (const timer of startupHeartbeatTimers) clearTimeout(timer);
    startupHeartbeatTimers = [];
    if (startupCompactionTimer) clearTimeout(startupCompactionTimer);
    startupCompactionTimer = undefined;
    for (const timer of settledHeartbeatTimers) clearTimeout(timer);
    settledHeartbeatTimers = [];
    clearCompaction();
    if (startupAttemptId) {
      forkPreparation = { id: startupAttemptId, phase: "preparing", launchConfirmed: true };
    } else {
      const restored = matchingCheckpoint(piCtx);
      if (restored && (restored.phase === "preparing" || restored.phase === "compacting")) {
        try {
          persistPreparation(piCtx, { id: restored.id, phase: "error", launchConfirmed: true, error: "Fork preparation was interrupted; retry preparation" });
        } catch {
          forkPreparation = { id: restored.id, phase: "error", launchConfirmed: true, error: "Fork preparation was interrupted; retry preparation" };
        }
      } else {
        forkPreparation = restored;
      }
    }
    await publishLifecycle("waiting", piCtx);
    heartbeatTimer = setInterval(() => void heartbeat(currentState, piCtx), HEARTBEAT_INTERVAL_MS);
    acceptingNameCommands = true;
    nameCommandTimer = setInterval(() => void applyNameCommand(piCtx), THEME_COMMAND_INTERVAL_MS);
    themeCommandTimer = setInterval(() => void applyThemeCommand(piCtx).then((applied) => applied ? heartbeat(currentState, piCtx) : undefined), THEME_COMMAND_INTERVAL_MS);
    startupHeartbeatTimers = STARTUP_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void applyThemeAndHeartbeat(currentState, piCtx), delay));
    if (startupAttemptId) startupCompactionTimer = setTimeout(() => void coordinateForkPreparation(piCtx, startupAttemptId).catch(() => undefined), 0);
    mcpCleanup = await registerMcpTools(pi, piCtx.cwd);
  });

  pi.on("session_info_changed", async (_event, ctx) => {
    await applyNameCommand(ctx as PiContext);
    await applyThemeAndHeartbeat(currentState, ctx as PiContext);
  });
  function clearCompaction() {
    if (compactionCompleteTimer) clearTimeout(compactionCompleteTimer);
    compactionCompleteTimer = undefined;
    compactionSnapshot = undefined;
    compactOperation = undefined;
  }

  async function finishCompaction(ctx: PiContext, phase: "complete" | "error" | "cancelled", error?: string, willRetry = false) {
    const snapshot = compactionSnapshot;
    if (!snapshot || compactOperation?.phase !== "running") return;
    const operation = { kind: "compact" as const, phase, id: compactOperation.id, ...(error ? { error: boundedError(error) } : {}) };
    compactOperation = operation;
    if (phase === "complete") {
      compactionCompleteTimer = setTimeout(() => {
        if (shuttingDown || compactOperation !== operation) return;
        clearCompaction();
        void heartbeat(currentState, ctx).catch(() => undefined);
      }, COMPACTION_COMPLETE_DISPLAY_MS);
    }
    if (willRetry) {
      lifecycleRevision += 1;
      await heartbeat("running", ctx, undefined, snapshot.stateSince);
    } else if (lifecycleRevision === snapshot.ownedRevision) {
      lifecycleRevision += 1;
      await heartbeat(snapshot.state, ctx, undefined, snapshot.stateSince);
    } else {
      lifecycleRevision += 1;
      await heartbeat(currentState, ctx);
    }
  }

  pi.on("agent_start", async (_event, ctx) => {
    clearCompaction();
    for (const timer of settledHeartbeatTimers) clearTimeout(timer);
    settledHeartbeatTimers = [];
    await publishLifecycle("running", ctx as PiContext);
  });
  pi.on("agent_end", async (_event, ctx) => {
    await publishLifecycle("waiting", ctx as PiContext);
  });
  pi.on("agent_settled", async (_event, ctx) => {
    await publishLifecycle("waiting", ctx as PiContext);
    for (const timer of settledHeartbeatTimers) clearTimeout(timer);
    settledHeartbeatTimers = SETTLED_HEARTBEAT_DELAYS_MS.map((delay) => setTimeout(() => void heartbeat(currentState, ctx as PiContext), delay));
  });
  pi.on("session_before_compact", async (_event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    clearCompaction();
    const ownedRevision = ++lifecycleRevision;
    compactionSnapshot = { state: currentState, stateSince, ownedRevision };
    compactOperation = { kind: "compact", phase: "running", id: Date.now().toString(36).slice(-FORK_COMPACT_OPERATION_ID_LENGTH) };
    await heartbeat("running", ctx as PiContext, undefined, stateSince);
  });
  pi.on("session_compact", async (event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    await finishCompaction(ctx as PiContext, "complete", undefined, event.willRetry);
  });
  pi.on("session_compact_failed", async (event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    await finishCompaction(ctx as PiContext, event.aborted ? "cancelled" : "error", event.errorMessage, event.willRetry);
  });
  pi.on("ui_prompt_start", async (_event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID || promptSnapshot) return;
    lifecycleRevision += 1;
    promptSnapshot = { state: currentState, stateSince, ownedRevision: lifecycleRevision };
    await heartbeat("waiting", ctx as PiContext);
  });
  pi.on("ui_prompt_end", async (_event, ctx) => {
    if (process.env.PI_TMUX_SUBAGENTS_JOB_ID) return;
    const snapshot = promptSnapshot;
    promptSnapshot = undefined;
    if (!snapshot || lifecycleRevision !== snapshot.ownedRevision) return;
    lifecycleRevision += 1;
    await heartbeat(snapshot.state, ctx as PiContext, undefined, snapshot.stateSince);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    acceptingNameCommands = false;
    try {
      shuttingDown = true;
      if (compactionCompleteTimer) clearTimeout(compactionCompleteTimer);
      promptSnapshot = undefined;
      lifecycleRevision += 1;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (themeCommandTimer) clearInterval(themeCommandTimer);
      if (nameCommandTimer) clearInterval(nameCommandTimer);
      for (const timer of startupHeartbeatTimers) clearTimeout(timer);
      startupHeartbeatTimers = [];
      if (startupCompactionTimer) clearTimeout(startupCompactionTimer);
      startupCompactionTimer = undefined;
      for (const timer of settledHeartbeatTimers) clearTimeout(timer);
      settledHeartbeatTimers = [];
      await Promise.all([...finalizers]);
      if (forkPreparation && (forkPreparation.phase === "preparing" || forkPreparation.phase === "compacting")) {
        const interrupted = { id: forkPreparation.id, phase: "error" as const, launchConfirmed: true, error: "Fork preparation was interrupted; retry preparation" };
        try { persistPreparation(ctx as PiContext, interrupted); } catch { forkPreparation = interrupted; }
      }
      await mcpCleanup?.();
      await heartbeat("shutdown", ctx as PiContext);
      await heartbeatWrite;
    } finally {
      delete globalState[EXTENSION_KEY];
    }
  });
}

function boundedError(value: string): string { return value.trim().slice(0, 500) || "Fork preparation failed"; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function workflowRuntime(ctx: PiContext): Pick<Heartbeat, "workflow" | "activeMode"> | undefined {
  try {
    const entries = ctx.sessionManager?.getBranch?.();
    if (!entries) return undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
      if (entry?.type !== "custom" || entry.customType !== WORKFLOW_RUNTIME_ENTRY) continue;
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
