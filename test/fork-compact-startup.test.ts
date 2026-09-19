import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import piAgentHubExtension from "../src/extension/index.js";
import { FORK_COMPACT_ENV, KIND_ENV, SESSION_ID_ENV, STATE_ENV } from "../src/core/names.js";
import type { Heartbeat } from "../src/core/types.js";

type Dependencies = NonNullable<Parameters<typeof piAgentHubExtension>[1]>;
type Interaction = Awaited<ReturnType<NonNullable<Dependencies["startInteraction"]>>>;
const attempt = "571b5a3d-55fa-4c90-b5cc-fc2f907785d1";
const loaded = Symbol.for("pi-agent-hub.extension.loaded");
const entry = (customType: string, data: unknown) => ({ type: "custom", customType, data });
const resetEntries = (id = attempt) => [
  entry("pi-agent-hub-context", { version: 1, updatedAt: Date.now() }),
  entry("workflow-runtime", { updatedAt: Date.now(), steps: [{ id: "work", short: "W", label: "Work" }] }),
  entry("workflow-runtime-reset", { version: 1, id, status: "ready" }),
];
const sleep = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await sleep(); }
  assert.fail("Timed out waiting for test observation");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function harness(dependencies: Dependencies = {}, marker = attempt) {
  const root = await mkdtemp(join(tmpdir(), "hub-reset-startup-"));
  const prior = [FORK_COMPACT_ENV, KIND_ENV, SESSION_ID_ENV, STATE_ENV, "PI_TMUX_SUBAGENTS_JOB_ID"].map((key) => [key, process.env[key]] as const);
  delete process.env[KIND_ENV];
  delete process.env.PI_TMUX_SUBAGENTS_JOB_ID;
  process.env[FORK_COMPACT_ENV] = marker;
  process.env[SESSION_ID_ENV] = "child";
  process.env[STATE_ENV] = root;
  delete (globalThis as Record<symbol, unknown>)[loaded];
  const branch: unknown[] = [
    entry("pi-agent-hub-context", { version: 1, updatedAt: 1, ticket: { id: "old-001" } }),
    entry("workflow-runtime", { updatedAt: 1, ticketId: "old-001", activeStep: "work", steps: [{ id: "work", short: "W", label: "Work" }] }),
  ];
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  type Compaction = { onComplete: () => Promise<void>; onError: (error: Error) => Promise<void> };
  const compactions: Compaction[] = [];
  let sessionId = "conversation";
  let throwCompact = false;
  const ctx = {
    cwd: root, hasUI: false,
    sessionManager: { getBranch: () => branch, getSessionId: () => sessionId },
    compact(options: Compaction) { if (throwCompact) throw new Error("compact request failed"); compactions.push(options); },
    isIdle: () => true, hasPendingMessages: () => false, ui: { getEditorText: () => "" },
  };
  const pi = {
    on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(event, handler); },
    getSessionName: () => "Fork name", registerTool() {},
    events: { on: () => () => {}, emit() {} },
  };
  piAgentHubExtension(pi as unknown as Parameters<typeof piAgentHubExtension>[0], {
    startInteraction: async () => ({ target: { managedId: "child", piSessionId: "conversation", instanceId: "test" }, lifecycleChanged() {}, branchChanged() {}, close: async () => {} }),
    registerMcp: async () => async () => {},
    ...dependencies,
  });
  const emit = (event: string) => handlers.get(event)?.({}, ctx);
  const read = async () => JSON.parse(await readFile(join(root, "heartbeats/child.json"), "utf8")) as Heartbeat;
  return {
    branch, compactions, emit, read,
    changeSession: () => { sessionId = "replacement"; },
    failCompactionRequest: () => { throwCompact = true; },
    async close() {
      await emit("session_shutdown");
      for (const [key, value] of prior) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const mode of ["missing", "wrong-token", "receipt-only", "malformed", "relinked"] as const) {
  test(`compact fork refuses ${mode} reset evidence and keeps actual ticket context`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 100_000 });
    const h = await harness();
    try {
      if (mode === "wrong-token") h.branch.push(...resetEntries("other-attempt-123456"));
      if (mode === "receipt-only") h.branch.push(resetEntries()[2]);
      if (mode === "malformed") h.branch.push(...resetEntries().slice(0, 2), entry("workflow-runtime-reset", { version: 2, id: attempt, status: "ready" }));
      if (mode === "relinked") h.branch.push(...resetEntries(), entry("pi-agent-hub-context", { version: 1, updatedAt: 2, ticket: { id: "other-001" } }));
      await h.emit("session_start");
      await sleep(30);
      t.mock.timers.tick(5_001);
      await until(async () => (await h.read()).operation?.phase === "error");
      const heartbeat = await h.read();
      assert.equal(h.compactions.length, 0);
      assert.equal(heartbeat.operation?.id, attempt);
      assert.match(heartbeat.message ?? "", /Enable or update Rules/);
      if (mode === "missing" || mode === "receipt-only") assert.equal(heartbeat.context?.ticket?.id, "old-001");
      if (mode === "relinked") assert.equal(heartbeat.context?.ticket?.id, "other-001");
    } finally { await h.close(); t.mock.timers.reset(); }
  });
}

for (const producerFirst of [true, false]) {
  test(`startup releases the event handler with blocked services, producer first=${producerFirst}`, async () => {
    const interaction = deferred<Interaction>();
    const mcp = deferred<() => Promise<void>>();
    let interactionClosed = 0;
    let mcpClosed = 0;
    const h = await harness({ startInteraction: () => interaction.promise, registerMcp: () => mcp.promise });
    try {
      if (producerFirst) h.branch.push(...resetEntries());
      await h.emit("session_start");
      if (!producerFirst) h.branch.push(...resetEntries());
      await until(() => h.compactions.length === 1);
      await h.compactions[0].onComplete();
      assert.equal((await h.read()).operation?.phase, "complete");
      await h.emit("session_shutdown");
      const stopped = await h.read();
      interaction.resolve({ target: { managedId: "child", piSessionId: "conversation", instanceId: "late" }, lifecycleChanged() {}, branchChanged() {}, close: async () => { interactionClosed++; } });
      mcp.resolve(async () => { mcpClosed++; });
      await until(() => interactionClosed === 1 && mcpClosed === 1);
      await h.compactions[0].onComplete();
      await h.compactions[0].onError(new Error("late failure"));
      assert.deepEqual(await h.read(), stopped);
    } finally { await h.close(); }
  });
}

for (const service of ["interaction", "mcp"] as const) {
  test(`failed ${service} startup does not block Rules or leave unhandled work`, async () => {
    const fail = async (): Promise<never> => { throw new Error(`${service} initialization failed`); };
    const h = await harness(service === "interaction" ? { startInteraction: fail } : { registerMcp: fail });
    try {
      await h.emit("session_start");
      await until(async () => { try { return (await h.read()).operation?.phase === "error"; } catch { return false; } });
      h.branch.push(...resetEntries());
      await sleep(80);
      assert.equal(h.compactions.length, 0);
      assert.match((await h.read()).message ?? "", /initialization failed/);
    } finally { await h.close(); }
  });
}

test("shutdown or session replacement invalidates pending reset and late callbacks", async () => {
  for (const replace of [false, true]) {
    const h = await harness();
    try {
      await h.emit("session_start");
      await sleep(20);
      if (replace) h.changeSession(); else await h.emit("session_shutdown");
      h.branch.push(...resetEntries());
      await sleep(80);
      assert.equal(h.compactions.length, 0);
    } finally { await h.close(); }
  }
});

test("compaction failure and relinking during compaction cannot publish success", async () => {
  for (const mode of ["throw", "error", "relink"] as const) {
    const h = await harness();
    try {
      h.branch.push(...resetEntries());
      if (mode === "throw") h.failCompactionRequest();
      await h.emit("session_start");
      if (mode !== "throw") {
        await until(() => h.compactions.length === 1);
        if (mode === "error") await h.compactions[0].onError(new Error("model compaction failed"));
        else {
          h.branch.push(entry("pi-agent-hub-context", { version: 1, updatedAt: 2, ticket: { id: "new-001" } }));
          await h.compactions[0].onComplete();
        }
      }
      await until(async () => { try { return (await h.read()).operation?.phase === "error"; } catch { return false; } });
      assert.equal((await h.read()).operation?.id, attempt);
    } finally { await h.close(); }
  }
});

test("completion rechecks ticket reset after awaiting compaction-state restoration", async () => {
  const h = await harness();
  try {
    h.branch.push(...resetEntries());
    await h.emit("session_start");
    await until(() => h.compactions.length === 1);
    await h.emit("session_before_compact");
    const completing = h.compactions[0].onComplete();
    h.branch.push(entry("pi-agent-hub-context", { version: 1, updatedAt: 2, ticket: { id: "new-001" } }));
    await completing;
    const result = await h.read();
    assert.equal(result.operation?.phase, "error");
    assert.equal(result.context?.ticket?.id, "new-001");
  } finally { await h.close(); }
});

test("invalid launch marker fails rather than falling back to unverified compaction", async () => {
  const h = await harness({}, "1");
  try {
    await h.emit("session_start");
    await until(async () => { try { return (await h.read()).state === "error"; } catch { return false; } });
    assert.equal(h.compactions.length, 0);
    assert.match((await h.read()).message ?? "", /Invalid fork reset token/);
  } finally { await h.close(); }
});
