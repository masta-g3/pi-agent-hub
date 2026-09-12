import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/extension/index.js";
import { FORK_COMPACT_ENV, PRIMARY_CWD_ENV, SESSION_ID_ENV, STATE_ENV } from "../src/core/names.js";
import { FORK_PREPARATION_ENTRY, WORKFLOW_RESET_CAPABILITY } from "../src/extension/fork-preparation.js";
import type { Heartbeat } from "../src/core/types.js";

const EXTENSION_KEY = Symbol.for("pi-agent-hub.extension.loaded");
const attempt = "fixture-attempt-0001";
type Entry = { type: string; customType: string; data: unknown };
type CompactOptions = { onComplete?: (result: unknown) => void; onError?: (error: Error) => void };

async function fixture(run: (value: {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  read(): Promise<Heartbeat>;
  complete(): void;
  fail(): void;
  branch: Entry[];
  calls(): number;
}) => Promise<void>, options: { marker?: boolean; entries?: Entry[]; failReady?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "hub-fork-finalizer-"));
  const keys = [FORK_COMPACT_ENV, PRIMARY_CWD_ENV, SESSION_ID_ENV, STATE_ENV] as const;
  const previous = keys.map((key) => process.env[key]);
  const globals = globalThis as Record<symbol, unknown>;
  delete globals[EXTENSION_KEY];
  process.env[STATE_ENV] = root;
  process.env[SESSION_ID_ENV] = "managed-fixture";
  process.env[PRIMARY_CWD_ENV] = "/repos/fixture";
  if (options.marker === false) delete process.env[FORK_COMPACT_ENV]; else process.env[FORK_COMPACT_ENV] = attempt;
  const branch = options.entries ?? [];
  const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const requests: CompactOptions[] = [];
  const ctx = {
    cwd: root, hasUI: false,
    compact(value: CompactOptions) { requests.push(value); },
    sessionManager: { getSessionId: () => "pi-fixture", getSessionFile: () => "/sessions/fixture.jsonl", getBranch: () => branch },
  };
  const pi = {
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { handlers.set(name, handler); },
    registerTool() {}, setSessionName() {}, getSessionName: () => "fixture",
    appendEntry(customType: string, data: unknown) {
      if (options.failReady && customType === FORK_PREPARATION_ENTRY && (data as { preparation: { phase: string } }).preparation.phase === "ready") throw new Error("checkpoint disk failure");
      branch.push({ type: "custom", customType, data });
    },
  };
  let stopped = false;
  const shutdown = async () => { if (!stopped) { stopped = true; await handlers.get("session_shutdown")?.({}, ctx); } };
  try {
    extension(pi as unknown as Parameters<typeof extension>[0]);
    await run({
      start: () => handlers.get("session_start")!({ reason: "startup" }, ctx), shutdown,
      read: async () => JSON.parse(await readFile(join(root, "heartbeats/managed-fixture.json"), "utf8")),
      complete: () => requests[0]?.onComplete?.({}), fail: () => requests[0]?.onError?.(new Error("late callback")),
      branch, calls: () => requests.length,
    });
  } finally {
    await shutdown();
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    delete globals[EXTENSION_KEY];
    await rm(root, { recursive: true, force: true });
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 8_000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "timed out waiting for extension result");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const checkpoint = (managedSessionId: string, piSessionId: string, phase: "ready" | "compacting" | "error"): Entry => ({
  type: "custom", customType: FORK_PREPARATION_ENTRY,
  data: { version: 1, managedSessionId, piSessionId, preparation: { id: attempt, phase, ...(phase === "ready" ? { outcome: "compacted" } : {}) } },
});

test("shutdown drains an already-started finalizer and late callbacks cannot overwrite it", async () => {
  await fixture(async (value) => {
    await value.start();
    await waitFor(() => value.calls() === 1);
    value.complete();
    await value.shutdown();
    const terminal = await value.read();
    assert.equal(terminal.state, "shutdown");
    assert.equal(terminal.forkPreparation?.phase, "ready");
    value.fail();
    value.complete();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(await value.read(), terminal);
  });
});

test("failed terminal checkpoint is an error and never publishes ready", async () => {
  await fixture(async (value) => {
    await value.start();
    await waitFor(() => value.calls() === 1);
    value.complete();
    await waitFor(async () => (await value.read()).forkPreparation?.phase === "error");
    assert.match((await value.read()).forkPreparation?.error ?? "", /checkpoint disk failure/);
    assert.equal(value.branch.some((entry) => (entry.data as { preparation?: { phase?: string } }).preparation?.phase === "ready"), false);
    value.complete();
    await value.shutdown();
    assert.equal((await value.read()).forkPreparation?.phase, "error");
  }, { failReady: true });
});

test("registered producer without a receipt cannot bypass reset on an empty branch", async () => {
  const globals = globalThis as Record<symbol, unknown>;
  const previous = globals[WORKFLOW_RESET_CAPABILITY];
  globals[WORKFLOW_RESET_CAPABILITY] = { version: 1 };
  try {
    await fixture(async (value) => {
      await value.start();
      await waitFor(async () => (await value.read()).forkPreparation?.phase === "error");
      assert.equal(value.calls(), 0);
      assert.match((await value.read()).forkPreparation?.error ?? "", /Task reset was not confirmed/);
    });
  } finally {
    if (previous === undefined) delete globals[WORKFLOW_RESET_CAPABILITY]; else globals[WORKFLOW_RESET_CAPABILITY] = previous;
  }
});

test("failed checkpoints still publish current producer context without resetting on resume", async () => {
  const context = { version: 1, updatedAt: 10, ticket: { id: "manual-001", subtitle: "Keep the current task" } };
  const entries = [checkpoint("managed-fixture", "pi-fixture", "error"), { type: "custom", customType: "pi-agent-hub-context", data: context }];
  await fixture(async (value) => {
    await value.start();
    const heartbeat = await value.read();
    assert.equal(heartbeat.forkPreparation?.phase, "error");
    assert.deepEqual(heartbeat.context, context);
    assert.equal(value.calls(), 0);
    assert.equal(value.branch.length, 2);
  }, { marker: false, entries });
});

test("resume ignores copied preparation and reports its own incomplete checkpoint", async () => {
  await fixture(async (value) => {
    await value.start();
    assert.equal((await value.read()).forkPreparation, undefined);
    assert.equal(value.calls(), 0);
  }, { marker: false, entries: [checkpoint("another-managed", "another-pi", "ready")] });
  await fixture(async (value) => {
    await value.start();
    assert.equal((await value.read()).forkPreparation?.phase, "error");
    assert.equal(value.calls(), 0);
    assert.match((await value.read()).forkPreparation?.error ?? "", /interrupted/);
  }, { marker: false, entries: [checkpoint("managed-fixture", "pi-fixture", "compacting")] });
});
