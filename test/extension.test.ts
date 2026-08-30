import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import piAgentHubExtension from "../src/extension/index.js";
import { FORK_COMPACT_ENV, PRIMARY_CWD_ENV, SESSION_ID_ENV, STATE_ENV, WORKTREE_GUIDANCE_ENV } from "../src/core/names.js";
import { WORKTREE_GUIDANCE_MAX_LENGTH } from "../src/core/worktree-context.js";
import { heartbeatPath } from "../src/core/paths.js";
import { HEARTBEAT_STALE_MS } from "../src/core/status.js";
import { publishThemeCommand } from "../src/core/theme-command.js";
import type { Heartbeat } from "../src/core/types.js";

const EXTENSION_KEY = Symbol.for("pi-agent-hub.extension.loaded");

test("piAgentHubExtension registers handlers once per active process", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const events: string[] = [];
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      events.push(name);
      handlers.set(name, handler);
    },
  };

  piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
  piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);

  assert.deepEqual(events, ["before_agent_start", "session_start", "session_info_changed", "agent_start", "agent_end", "agent_settled", "session_before_compact", "session_compact", "ui_prompt_start", "ui_prompt_end", "session_shutdown"]);

  await handlers.get("session_shutdown")?.({}, { cwd: "/repo" });
  piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);

  assert.deepEqual(events, [
    "before_agent_start", "session_start", "session_info_changed", "agent_start", "agent_end", "agent_settled", "session_before_compact", "session_compact", "ui_prompt_start", "ui_prompt_end", "session_shutdown",
    "before_agent_start", "session_start", "session_info_changed", "agent_start", "agent_end", "agent_settled", "session_before_compact", "session_compact", "ui_prompt_start", "ui_prompt_end", "session_shutdown",
  ]);
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
});

test("compact fork startup resets the native name and compacts without custom instructions", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-fork-compact-"));
  const previous = {
    sessionId: process.env[SESSION_ID_ENV],
    stateDir: process.env[STATE_ENV],
    primaryCwd: process.env[PRIMARY_CWD_ENV],
    forkCompact: process.env[FORK_COMPACT_ENV],
  };
  process.env[SESSION_ID_ENV] = "fork-compact";
  process.env[STATE_ENV] = root;
  process.env[PRIMARY_CWD_ENV] = "/repos/example-api";
  process.env[FORK_COMPACT_ENV] = "1";
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const names: string[] = [];
  const compactions: unknown[] = [];
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
    setSessionName(name: string) { names.push(name); },
    getSessionName() { return names.at(-1); },
  };
  const ctx = {
    cwd: root,
    hasUI: false,
    compact(options: unknown) { compactions.push(options); },
    sessionManager: {
      getBranch: () => [
        { type: "custom", customType: "pi-agent-hub-context", timestamp: 1, data: { version: 1, updatedAt: 1, ticket: { id: "old-001" } } },
        { type: "custom", customType: "workflow-runtime", timestamp: 1, data: { steps: [{ id: "execute", short: "EX", label: "Execute" }], activeStep: "execute", ticketId: "old-001", updatedAt: 1 } },
      ],
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    assert.equal(process.env[FORK_COMPACT_ENV], undefined);
    await handlers.get("session_start")?.({ reason: "startup" }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(names, ["example-api"]);
    assert.equal(compactions.length, 1);
    assert.deepEqual(Object.keys(compactions[0] as object), ["onError"]);
    const heartbeat = JSON.parse(await readFile(heartbeatPath("fork-compact", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(heartbeat.context, undefined);
    assert.equal(heartbeat.workflow, undefined);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    for (const [key, value] of [
      [SESSION_ID_ENV, previous.sessionId], [STATE_ENV, previous.stateDir], [PRIMARY_CWD_ENV, previous.primaryCwd], [FORK_COMPACT_ENV, previous.forkCompact],
    ] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("compaction publishes transient running and restores or preserves continuation state", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-compaction-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "compaction";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
    getSessionName() { return "Compaction"; },
  };
  const ctx = { cwd: root, hasUI: false };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    const started = JSON.parse(await readFile(heartbeatPath("compaction", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;

    await handlers.get("session_before_compact")?.({ reason: "manual", willRetry: false }, ctx);
    const compacting = JSON.parse(await readFile(heartbeatPath("compaction", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(compacting.state, "running");
    assert.equal(compacting.stateSince, started.stateSince);

    await handlers.get("session_compact")?.({ reason: "manual", willRetry: false }, ctx);
    const restored = JSON.parse(await readFile(heartbeatPath("compaction", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(restored.state, "waiting");
    assert.equal(restored.stateSince, started.stateSince);

    await handlers.get("session_before_compact")?.({ reason: "overflow", willRetry: true }, ctx);
    const retrying = JSON.parse(await readFile(heartbeatPath("compaction", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(retrying.state, "running");
    await handlers.get("session_compact")?.({ reason: "overflow", willRetry: true }, ctx);
    const continuing = JSON.parse(await readFile(heartbeatPath("compaction", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(continuing.state, "running");
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("blocking Pi prompts publish waiting and restore the prior lifecycle state and activity time", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-prompt-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  const previousSubagentJobId = process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  process.env[SESSION_ID_ENV] = "prompt-lifecycle";
  process.env[STATE_ENV] = root;
  delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const ctx = { cwd: root, hasUI: false };
  const readHeartbeat = async () => JSON.parse(await readFile(heartbeatPath("prompt-lifecycle", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    const idleOrigin = await readHeartbeat();
    await handlers.get("ui_prompt_start")?.({ method: "confirm" }, ctx);
    let heartbeat = await readHeartbeat();
    assert.equal(heartbeat.state, "waiting");
    await handlers.get("ui_prompt_end")?.({ method: "confirm" }, ctx);
    heartbeat = await readHeartbeat();
    assert.equal(heartbeat.state, "waiting");
    assert.equal(heartbeat.stateSince, idleOrigin.stateSince);

    await handlers.get("agent_start")?.({}, ctx);
    const runningOrigin = await readHeartbeat();
    await handlers.get("ui_prompt_start")?.({ method: "select" }, ctx);
    heartbeat = await readHeartbeat();
    assert.equal(heartbeat.state, "waiting");
    await handlers.get("ui_prompt_start")?.({ method: "input" }, ctx);
    await handlers.get("ui_prompt_end")?.({ method: "select" }, ctx);
    heartbeat = await readHeartbeat();
    assert.equal(heartbeat.state, "running");
    assert.equal(heartbeat.stateSince, runningOrigin.stateSince);

    const restored = heartbeat;
    await handlers.get("ui_prompt_end")?.({ method: "input" }, ctx);
    assert.deepEqual(await readHeartbeat(), restored);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    if (previousSubagentJobId === undefined) delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
    else process.env.PI_TMUX_SUBAGENTS_JOB_ID = previousSubagentJobId;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("newer lifecycle transitions and shutdown reject stale prompt restoration", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-prompt-stale-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  const previousSubagentJobId = process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  process.env[SESSION_ID_ENV] = "prompt-stale";
  process.env[STATE_ENV] = root;
  delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const ctx = { cwd: root, hasUI: false };
  const readHeartbeat = async () => JSON.parse(await readFile(heartbeatPath("prompt-stale", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    await handlers.get("agent_start")?.({}, ctx);
    await handlers.get("ui_prompt_start")?.({ method: "editor" }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    await handlers.get("agent_start")?.({}, ctx);
    const sameStateOwner = await readHeartbeat();
    assert.equal(sameStateOwner.state, "running");
    await handlers.get("ui_prompt_end")?.({ method: "editor" }, ctx);
    assert.deepEqual(await readHeartbeat(), sameStateOwner);

    await handlers.get("ui_prompt_start")?.({ method: "custom" }, ctx);
    await handlers.get("agent_end")?.({}, ctx);
    const differentStateOwner = await readHeartbeat();
    assert.equal(differentStateOwner.state, "waiting");
    await handlers.get("ui_prompt_end")?.({ method: "custom" }, ctx);
    assert.deepEqual(await readHeartbeat(), differentStateOwner);

    await handlers.get("ui_prompt_start")?.({ method: "confirm" }, ctx);
    await handlers.get("session_shutdown")?.({}, ctx);
    const shutdown = await readHeartbeat();
    assert.equal(shutdown.state, "shutdown");
    await handlers.get("ui_prompt_end")?.({ method: "confirm" }, ctx);
    assert.deepEqual(await readHeartbeat(), shutdown);
  } finally {
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    if (previousSubagentJobId === undefined) delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
    else process.env.PI_TMUX_SUBAGENTS_JOB_ID = previousSubagentJobId;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("an extension error owns lifecycle state over a stale prompt end", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-prompt-error-"));
  const previous = {
    sessionId: process.env[SESSION_ID_ENV],
    stateDir: process.env[STATE_ENV],
    subagentJobId: process.env.PI_TMUX_SUBAGENTS_JOB_ID,
    forkCompact: process.env[FORK_COMPACT_ENV],
  };
  process.env[SESSION_ID_ENV] = "prompt-error";
  process.env[STATE_ENV] = root;
  process.env[FORK_COMPACT_ENV] = "1";
  delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  let compactOptions: { onError?: (error: Error) => void } | undefined;
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
    setSessionName() {},
  };
  const ctx = { cwd: root, hasUI: false, compact(options: { onError?: (error: Error) => void }) { compactOptions = options; } };
  const readHeartbeat = async () => JSON.parse(await readFile(heartbeatPath("prompt-error", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await handlers.get("ui_prompt_start")?.({ method: "confirm" }, ctx);
    compactOptions?.onError?.(new Error("compact failed"));
    let error = await readHeartbeat();
    for (let attempt = 0; error.state !== "error" && attempt < 20; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      error = await readHeartbeat();
    }
    assert.equal(error.state, "error");
    await handlers.get("ui_prompt_end")?.({ method: "confirm" }, ctx);
    assert.deepEqual(await readHeartbeat(), error);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    for (const [key, value] of [
      [SESSION_ID_ENV, previous.sessionId], [STATE_ENV, previous.stateDir], ["PI_TMUX_SUBAGENTS_JOB_ID", previous.subagentJobId], [FORK_COMPACT_ENV, previous.forkCompact],
    ] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("compaction watchdog restores the prior state when completion is missing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-watchdog-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "compaction-watchdog";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const ctx = { cwd: root, hasUI: false };
  const readCompactionHeartbeat = async (predicate?: (heartbeat: Heartbeat) => boolean): Promise<Heartbeat> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const heartbeat = JSON.parse(await readFile(heartbeatPath("compaction-watchdog", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
        if (!predicate || predicate(heartbeat)) return heartbeat;
      } catch {}
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail("timed out waiting for compaction watchdog heartbeat");
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    t.mock.timers.tick(3_000);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await handlers.get("session_before_compact")?.({ reason: "manual", willRetry: false }, ctx);
    let heartbeat = await readCompactionHeartbeat();
    assert.equal(heartbeat.state, "running");

    t.mock.timers.tick(HEARTBEAT_STALE_MS);
    heartbeat = await readCompactionHeartbeat((item) => item.state === "waiting");
    assert.equal(heartbeat.state, "waiting");

    await handlers.get("session_before_compact")?.({ reason: "overflow", willRetry: true }, ctx);
    await handlers.get("session_compact")?.({ reason: "overflow", willRetry: true }, ctx);
    t.mock.timers.tick(HEARTBEAT_STALE_MS);
    await new Promise<void>((resolve) => setImmediate(resolve));
    heartbeat = await readCompactionHeartbeat((item) => item.state === "running");
    assert.equal(heartbeat.state, "running");
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    t.mock.timers.reset();
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension appends bounded worktree guidance before parent agent turns", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const previous = process.env[WORKTREE_GUIDANCE_ENV];
  const handlers = new Map<string, (event: { systemPrompt?: string }, ctx: unknown) => unknown>();
  const pi = {
    on(name: string, handler: (event: { systemPrompt?: string }, ctx: unknown) => unknown) { handlers.set(name, handler); },
    registerTool() {},
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    process.env[WORKTREE_GUIDANCE_ENV] = "## worktree context\nUse /hub/worktree, not /repo/source.";
    assert.deepEqual(await handlers.get("before_agent_start")?.({ systemPrompt: "base prompt" }, {}), {
      systemPrompt: "base prompt\n\n## worktree context\nUse /hub/worktree, not /repo/source.",
    });

    process.env[WORKTREE_GUIDANCE_ENV] = "   ";
    assert.equal(await handlers.get("before_agent_start")?.({ systemPrompt: "base prompt" }, {}), undefined);
    process.env[WORKTREE_GUIDANCE_ENV] = "x".repeat(WORKTREE_GUIDANCE_MAX_LENGTH + 1);
    assert.equal(await handlers.get("before_agent_start")?.({ systemPrompt: "base prompt" }, {}), undefined);
  } finally {
    await handlers.get("session_shutdown")?.({}, { cwd: "/repo", hasUI: false });
    if (previous === undefined) delete process.env[WORKTREE_GUIDANCE_ENV];
    else process.env[WORKTREE_GUIDANCE_ENV] = previous;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension leaves tmux subagent prompt and heartbeat ownership to child bootstrap", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  const previousSubagentJobId = process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  const previousWorktreeGuidance = process.env[WORKTREE_GUIDANCE_ENV];
  process.env[SESSION_ID_ENV] = "subagent-1";
  process.env[STATE_ENV] = root;
  process.env.PI_TMUX_SUBAGENTS_JOB_ID = "subagent-1";
  process.env[WORKTREE_GUIDANCE_ENV] = "worktree guidance already present in the child prompt";
  const file = heartbeatPath("subagent-1", { PI_AGENT_HUB_DIR: root });
  const childHeartbeat = `${JSON.stringify({ owner: "child-bootstrap" })}\n`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, childHeartbeat, "utf8");
  await publishThemeCommand("light", "light", { PI_AGENT_HUB_DIR: root }, { now: Date.now() + 10, revision: "subagent-command" });
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      handlers.set(name, handler);
    },
    registerTool() {},
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    assert.equal(await handlers.get("before_agent_start")?.({ systemPrompt: "child prompt" }, {}), undefined);
    const childCtx = {
      cwd: root,
      hasUI: true,
      ui: {
        getTheme() { throw new Error("subagent theme command should not be read"); },
        setTheme() { throw new Error("subagent theme command should not be applied"); },
      },
    };
    await handlers.get("session_start")?.({}, childCtx);
    await handlers.get("ui_prompt_start")?.({ method: "custom" }, childCtx);
    await handlers.get("ui_prompt_end")?.({ method: "custom" }, childCtx);

    assert.equal(await readFile(file, "utf8"), childHeartbeat);
  } finally {
    await handlers.get("session_shutdown")?.({}, { cwd: root, hasUI: false });
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    if (previousSubagentJobId === undefined) delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
    else process.env.PI_TMUX_SUBAGENTS_JOB_ID = previousSubagentJobId;
    if (previousWorktreeGuidance === undefined) delete process.env[WORKTREE_GUIDANCE_ENV];
    else process.env[WORKTREE_GUIDANCE_ENV] = previousWorktreeGuidance;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension refreshes active theme shortly after session start", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-startup-theme";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      handlers.set(name, handler);
    },
    registerTool() {},
  };
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: {
        name: "startup-theme",
        getFgAnsi() { return "\u001b[38;2;1;1;1m"; },
      },
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    ctx.ui.theme.name = "solarized-dark";
    ctx.ui.theme.getFgAnsi = () => "\u001b[38;2;2;3;4m";

    const heartbeat = await waitForHeartbeat(root, "session-startup-theme", (item) => item.activeTheme?.name === "solarized-dark");

    assert.equal(heartbeat.activeTheme?.tokens?.accent, "#020304");
  } finally {
    await handlers.get("session_shutdown")?.({}, { cwd: root });
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension does not apply theme commands in unmanaged Pi processes", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-theme-command-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  delete process.env[SESSION_ID_ENV];
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const applied: string[] = [];
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: { name: "dark" },
      getTheme: () => ({ name: "light" }),
      setTheme: (theme: { name: string }) => { applied.push(theme.name); },
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await publishThemeCommand("light", "light", { PI_AGENT_HUB_DIR: root }, { now: Date.now() + 10, revision: "unmanaged-command" });
    await handlers.get("session_start")?.({}, ctx);
    assert.deepEqual(applied, []);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension applies one theme command created before session_start and refreshes heartbeat", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-theme-command-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-theme-command";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const dark = { name: "dark", getFgAnsi: () => "\u001b[38;2;1;1;1m" };
  const light = { name: "light", getFgAnsi: () => "\u001b[38;2;2;2;2m" };
  const applied: string[] = [];
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: dark,
      getTheme(name: string) { return name === "light" ? light : undefined; },
      setTheme(theme: typeof light) { this.theme = theme; applied.push(theme.name); },
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await publishThemeCommand("light/dark", "light", { PI_AGENT_HUB_DIR: root }, { now: Date.now() + 10, revision: "new-command" });
    await handlers.get("session_start")?.({}, ctx);
    await handlers.get("agent_start")?.({}, ctx);
    await publishThemeCommand("missing", "missing", { PI_AGENT_HUB_DIR: root }, { now: Date.now() + 20, revision: "missing-command" });
    await handlers.get("agent_end")?.({}, ctx);

    assert.deepEqual(applied, ["light"]);
    const heartbeat = JSON.parse(await readFile(heartbeatPath("session-theme-command", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
    assert.equal(heartbeat.activeTheme?.name, "light");
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension polls a new theme command while the session is idle", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-theme-command-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-idle-theme-command";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const applied: string[] = [];
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: { name: "dark" },
      getTheme: (name: string) => ({ name }),
      setTheme(theme: { name: string }) { this.theme = theme; applied.push(theme.name); },
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    await publishThemeCommand("light", "light", { PI_AGENT_HUB_DIR: root }, { now: Date.now() + 10, revision: "idle-command" });
    const heartbeat = await waitForHeartbeat(root, "session-idle-theme-command", (item) => item.activeTheme?.name === "light");
    assert.deepEqual(applied, ["light"]);
    assert.equal(heartbeat.activeTheme?.name, "light");
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension ignores a theme command created exactly at process start", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-theme-command-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-equal-theme-command";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const applied: string[] = [];
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: { name: "dark" },
      getTheme: () => ({ name: "light" }),
      setTheme: (theme: { name: string }) => { applied.push(theme.name); },
    },
  };

  try {
    const originalNow = Date.now;
    Date.now = () => 1_000;
    try {
      piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    } finally {
      Date.now = originalNow;
    }
    await publishThemeCommand("light", "light", { PI_AGENT_HUB_DIR: root }, { now: 1_000, revision: "equal-command" });
    await handlers.get("session_start")?.({}, ctx);
    assert.deepEqual(applied, []);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension ignores theme commands older than the extension process", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-theme-command-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-old-theme-command";
  process.env[STATE_ENV] = root;
  await publishThemeCommand("light", "light", { PI_AGENT_HUB_DIR: root }, { now: 1, revision: "old-command" });
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const applied: string[] = [];
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {},
  };
  const ctx = {
    cwd: root,
    hasUI: true,
    ui: {
      theme: { name: "dark" },
      getTheme: () => ({ name: "light" }),
      setTheme: (theme: { name: string }) => { applied.push(theme.name); },
    },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, ctx);
    assert.deepEqual(applied, []);
  } finally {
    await handlers.get("session_shutdown")?.({}, ctx);
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

test("piAgentHubExtension records the active Pi theme in heartbeat", async () => {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-1";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      handlers.set(name, handler);
    },
    registerTool() {},
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    await handlers.get("session_start")?.({}, {
      cwd: root,
      hasUI: true,
      ui: {
        theme: {
          name: "active-theme",
          sourcePath: "/themes/active-theme.json",
          getFgAnsi(token: string) {
            if (token === "accent") return "\u001b[38;2;1;2;3m";
            if (token === "muted") return "\u001b[38;5;244m";
            if (token === "text") return "\u001b[39m";
            return "\u001b[38;2;4;5;6m";
          },
        },
      },
    });

    const heartbeat = JSON.parse(await readFile(heartbeatPath("session-1", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;

    assert.deepEqual(heartbeat.activeTheme, {
      name: "active-theme",
      sourcePath: "/themes/active-theme.json",
      tokens: {
        accent: "#010203",
        border: "#040506",
        dim: "#040506",
        error: "#040506",
        muted: 244,
        success: "#040506",
        text: "",
        warning: "#040506",
      },
    });
    await handlers.get("session_shutdown")?.({}, { cwd: root });
  } finally {
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
});

const WORKFLOW_STEPS = [
  { id: "plan-md", short: "PL", label: "Plan" },
  { id: "execute", short: "EX", label: "Execute" },
  { id: "review", short: "RV", label: "Review" },
  { id: "reflect", short: "RF", label: "Reflect" },
  { id: "commit", short: "CM", label: "Commit" },
];

const FOCUS_MODE = {
  id: "focus",
  short: "FOC",
  label: "Focus",
  detail: "turn 4",
};

const WORKFLOW_ENTRY = {
  type: "custom",
  customType: "workflow-runtime",
  data: {
    activeStep: "execute",
    ticketId: "workflow-board-001",
    updatedAt: 1_784_772_000_000,
    steps: WORKFLOW_STEPS,
  },
};

test("piAgentHubExtension bridges the producer-owned workflow definition into heartbeat", async () => {
  const heartbeat = await heartbeatWithSessionManager({
    getBranch: () => [
      { ...WORKFLOW_ENTRY, data: { ...WORKFLOW_ENTRY.data, activeStep: "review", updatedAt: 1_784_771_000_000 } },
      { type: "message" },
      WORKFLOW_ENTRY,
    ],
  });

  assert.deepEqual(heartbeat.workflow, {
    steps: WORKFLOW_STEPS,
    activeIndex: 1,
    ticketId: "workflow-board-001",
    updatedAt: 1_784_772_000_000,
  });
});

test("piAgentHubExtension transports optional current-position completion without interpreting the producer", async () => {
  for (const [currentStepComplete, expected] of [[undefined, undefined], [false, false], [true, true], ["true", undefined], [1, undefined]] as const) {
    const heartbeat = await heartbeatWithSessionManager({
      getBranch: () => [{ ...WORKFLOW_ENTRY, data: { ...WORKFLOW_ENTRY.data, currentStepComplete } }],
    });
    assert.equal(heartbeat.workflow?.currentStepComplete, expected);
    assert.equal(heartbeat.workflow?.steps[heartbeat.workflow.activeIndex]?.id, "execute");
  }
});

test("piAgentHubExtension bridges native name, generic context, activity, and plan", async () => {
  const heartbeat = await heartbeatWithSessionManager({
    getBranch: () => [
      { type: "custom", customType: "pi-agent-hub-context", data: { version: 1, updatedAt: 4, ticket: { id: "metadata-redesign-001", subtitle: "Simplify session context", description: "Use one generic contract." }, attention: { requestId: "review-4", kind: "ready", text: "Review the result" } } },
      { ...WORKFLOW_ENTRY, data: { ...WORKFLOW_ENTRY.data, activity: { id: "critic", label: "Reviewing implementation", pass: 2 }, plan: { phase: { title: "Hub bridge", index: 2, count: 4 }, tasks: { completed: 8, total: 11 }, phases: [{ completed: 3, total: 3 }, { completed: 5, total: 8 }], nextStep: "Wire settled heartbeat" } } },
    ],
  });
  assert.equal(heartbeat.piSessionName, "Canonical Name");
  assert.deepEqual(heartbeat.context?.ticket, { id: "metadata-redesign-001", subtitle: "Simplify session context", description: "Use one generic contract." });
  assert.deepEqual(heartbeat.context?.attention, { requestId: "review-4", kind: "ready", text: "Review the result" });
  assert.deepEqual(heartbeat.workflow?.activity, { id: "critic", label: "Reviewing implementation", pass: 2 });
  assert.deepEqual(heartbeat.workflow?.plan?.tasks, { completed: 8, total: 11 });
  assert.equal(heartbeat.workflow?.plan?.nextStep, "Wire settled heartbeat");
});

test("piAgentHubExtension bridges optional producer mode display into heartbeat", async () => {
  const heartbeat = await heartbeatWithSessionManager({
    getBranch: () => [{
      ...WORKFLOW_ENTRY,
      data: { ...WORKFLOW_ENTRY.data, activeMode: { ...FOCUS_MODE, ignored: "producer-private" } },
    }],
  });

  assert.deepEqual(heartbeat.workflow, {
    steps: WORKFLOW_STEPS,
    activeIndex: 1,
    activeMode: FOCUS_MODE,
    ticketId: "workflow-board-001",
    updatedAt: 1_784_772_000_000,
  });
});

test("piAgentHubExtension drops malformed optional mode without dropping workflow", async () => {
  const invalidModes = [
    {},
    { id: "", short: "FOC" },
    { id: "focus", short: "" },
    { id: "focus", short: "FOC", label: "" },
    { id: "focus", short: "FOC", detail: "" },
  ];

  for (const [index, activeMode] of invalidModes.entries()) {
    const heartbeat = await heartbeatWithSessionManager({
      getBranch: () => [{ ...WORKFLOW_ENTRY, data: { ...WORKFLOW_ENTRY.data, activeMode } }],
    });
    assert.deepEqual(heartbeat.workflow, {
      steps: WORKFLOW_STEPS,
      activeIndex: 1,
      ticketId: "workflow-board-001",
      updatedAt: 1_784_772_000_000,
    }, `invalid mode ${index}`);
  }
});

test("piAgentHubExtension omits malformed optional activity and plan for alternate producer steps", async () => {
  const base = {
    activeStep: "ship",
    ticketId: "alternate-001",
    updatedAt: 1_784_772_000_000,
    steps: [{ id: "discover", short: "DS", label: "Discover" }, { id: "ship", short: "SH", label: "Ship" }],
  };
  const invalidActivities = [
    {}, { id: "", label: "Working" }, { id: "work", label: "" },
    { id: "work", label: "Working", pass: 0 }, { id: "work", label: "Working", pass: 1.5 },
  ];
  for (const activity of invalidActivities) {
    const heartbeat = await heartbeatWithSessionManager({ getBranch: () => [{ type: "custom", customType: "workflow-runtime", data: { ...base, activity } }] });
    assert.equal(heartbeat.workflow?.steps[heartbeat.workflow.activeIndex]?.id, "ship");
    assert.equal(heartbeat.workflow?.activity, undefined);
  }

  const invalidPlans = [
    {},
    { tasks: { completed: 4, total: 3 } },
    { phase: { title: "", index: 1, count: 2 } },
    { phases: [{ completed: -1, total: 2 }] },
    { phases: [{ completed: 3_000, total: 6_000 }, { completed: 2_000, total: 5_000 }] },
    { nextStep: "x".repeat(241) },
  ];
  for (const plan of invalidPlans) {
    const heartbeat = await heartbeatWithSessionManager({ getBranch: () => [{ type: "custom", customType: "workflow-runtime", data: { ...base, plan } }] });
    assert.equal(heartbeat.workflow?.steps[heartbeat.workflow.activeIndex]?.id, "ship");
    assert.equal(heartbeat.workflow?.plan, undefined);
  }

  const partial = await heartbeatWithSessionManager({ getBranch: () => [{
    type: "custom", customType: "workflow-runtime",
    data: { ...base, activity: { id: "", label: "bad" }, plan: { phase: { title: "bad", index: 3, count: 2 }, tasks: { completed: 2, total: 5 }, nextStep: "Publish result" } },
  }] });
  assert.deepEqual(partial.workflow?.plan, { tasks: { completed: 2, total: 5 }, nextStep: "Publish result" });
  assert.equal(partial.workflow?.activity, undefined);
});

test("piAgentHubExtension keeps producer workflow time stable across heartbeat cadence", async () => {
  const first = await heartbeatWithSessionManager({ getBranch: () => [WORKFLOW_ENTRY] });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = await heartbeatWithSessionManager({ getBranch: () => [WORKFLOW_ENTRY] });

  assert.equal(first.workflow?.updatedAt, WORKFLOW_ENTRY.data.updatedAt);
  assert.equal(second.workflow?.updatedAt, WORKFLOW_ENTRY.data.updatedAt);
});

test("piAgentHubExtension rejects invalid producer workflow definitions", async () => {
  const invalidData: Record<string, unknown>[] = [
    {},
    { activeStep: "execute", updatedAt: WORKFLOW_ENTRY.data.updatedAt },
    { activeStep: "execute", updatedAt: Number.NaN, steps: WORKFLOW_STEPS },
    { activeStep: "unknown", updatedAt: WORKFLOW_ENTRY.data.updatedAt, steps: WORKFLOW_STEPS },
    { activeStep: "execute", updatedAt: WORKFLOW_ENTRY.data.updatedAt, steps: [] },
    { activeStep: "execute", updatedAt: WORKFLOW_ENTRY.data.updatedAt, steps: [{ id: "execute", short: "" }] },
    { activeStep: "execute", updatedAt: WORKFLOW_ENTRY.data.updatedAt, steps: [{ id: "execute", short: "EX" }, { id: "execute", short: "E2" }] },
    { activeStep: "execute", updatedAt: WORKFLOW_ENTRY.data.updatedAt, steps: [{ id: "execute", short: "EX", label: "" }] },
  ];

  for (const [index, data] of invalidData.entries()) {
    const heartbeat = await heartbeatWithSessionManager({
      getBranch: () => [{ type: "custom", customType: "workflow-runtime", data }],
    });
    assert.equal(heartbeat.workflow, undefined, `invalid definition ${index}`);
  }

  const cleared = await heartbeatWithSessionManager({ getBranch: () => [WORKFLOW_ENTRY, { type: "custom", customType: "workflow-runtime", data: {} }] });
  assert.equal(cleared.workflow, undefined);
});

test("piAgentHubExtension agent_settled projects request-backed question context appended after agent_end", async () => {
  const branch: unknown[] = [];
  const requestId = "a".repeat(64);
  const heartbeat = await heartbeatWithSessionManager({ getBranch: () => branch }, async (handlers, ctx) => {
    await handlers.get("agent_end")?.({}, ctx);
    branch.push({ type: "custom", customType: "pi-agent-hub-context", data: {
      version: 1, updatedAt: 9, attention: { requestId, kind: "question", text: "Choose the release target" },
    } });
    await handlers.get("agent_settled")?.({}, ctx);
  });
  assert.equal(heartbeat.state, "waiting");
  assert.deepEqual(heartbeat.context?.attention, { requestId, kind: "question", text: "Choose the release target" });
});

test("piAgentHubExtension follows agent_settled for detached context publication", async () => {
  const branch: unknown[] = [];
  const heartbeat = await heartbeatWithSessionManager({ getBranch: () => branch }, async (handlers, ctx) => {
    await handlers.get("agent_settled")?.({}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 300));
    branch.push({ type: "custom", customType: "pi-agent-hub-context", data: {
      version: 1, updatedAt: 10, attention: { kind: "ready", text: "Review the completed change" },
    } });
    await new Promise((resolve) => setTimeout(resolve, 850));
  });
  assert.equal(heartbeat.state, "waiting");
  assert.deepEqual(heartbeat.context?.attention, { kind: "ready", text: "Review the completed change" });
});

test("piAgentHubExtension omits workflow when getBranch is unavailable or throws", async () => {
  assert.equal((await heartbeatWithSessionManager({})).workflow, undefined);
  assert.equal((await heartbeatWithSessionManager({ getBranch: () => { throw new Error("boom"); } })).workflow, undefined);
});

async function heartbeatWithSessionManager(
  sessionManager: Record<string, unknown>,
  afterStart?: (handlers: Map<string, (event: unknown, ctx: unknown) => Promise<void>>, ctx: Record<string, unknown>) => Promise<void>,
): Promise<Heartbeat> {
  delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-extension-"));
  const previousSessionId = process.env[SESSION_ID_ENV];
  const previousStateDir = process.env[STATE_ENV];
  process.env[SESSION_ID_ENV] = "session-wf";
  process.env[STATE_ENV] = root;
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
      handlers.set(name, handler);
    },
    registerTool() {},
    getSessionName() { return "Canonical Name"; },
  };

  try {
    piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0]);
    const ctx = { cwd: root, hasUI: false, sessionManager };
    await handlers.get("session_start")?.({}, ctx);
    if (afterStart) await afterStart(handlers, ctx);
    else await handlers.get("session_info_changed")?.({}, ctx);
    return JSON.parse(await readFile(heartbeatPath("session-wf", { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
  } finally {
    await handlers.get("session_shutdown")?.({}, { cwd: root, sessionManager });
    if (previousSessionId === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = previousSessionId;
    if (previousStateDir === undefined) delete process.env[STATE_ENV];
    else process.env[STATE_ENV] = previousStateDir;
    delete (globalThis as Record<symbol, unknown>)[EXTENSION_KEY];
  }
}

async function waitForHeartbeat(root: string, sessionId: string, predicate: (heartbeat: Heartbeat) => boolean): Promise<Heartbeat> {
  const started = Date.now();
  let last: Heartbeat | undefined;
  while (Date.now() - started < 1_500) {
    try {
      last = JSON.parse(await readFile(heartbeatPath(sessionId, { PI_AGENT_HUB_DIR: root }), "utf8")) as Heartbeat;
      if (predicate(last)) return last;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for heartbeat; last=${JSON.stringify(last)}`);
}
