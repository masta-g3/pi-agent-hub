import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter, once } from "node:events";
import { startSessionInteraction, type InteractionAdapter } from "../src/extension/session-interaction.js";
import { requestSessionInteraction, interactionSocketPath, type InteractionRequest } from "../src/core/session-interaction.js";

test("bridge binds identities, pages branches, and guards/replays configured dispatch", async () => {
  const dir = await mkdtemp("/tmp/hc13.");
  const env = { PI_AGENT_HUB_DIR: dir };
  const events = new EventEmitter();
  let draft = "";
  let sends = 0;
  const adapter: InteractionAdapter = { managedId: "managed", piSessionId: "pi", env,
    events: { on: (name, fn) => { events.on(name, fn); return () => { events.off(name, fn); }; }, emit: (name, value) => { events.emit(name, value); } },
    getPiSessionId: () => "pi", getBranch: () => [], isIdle: () => true, hasPendingMessages: () => false,
    getEditorText: () => draft, uiPromptOpen: () => false,
    sendUserMessage: (text, options) => { assert.equal(text, "/skill:review"); assert.equal(options.expandPromptTemplates, true); sends++; },
  };
  const server = await startSessionInteraction(adapter);
  const request = (body: Record<string, unknown>, id: string = crypto.randomUUID()) => requestSessionInteraction({ ...server.target, version: 1, id, ...body } as InteractionRequest, env);
  try {
    assert.equal((await stat(interactionSocketPath("managed", env))).mode & 0o777, 0o600);
    await assert.rejects(requestSessionInteraction({ ...server.target, piSessionId: "other", version: 1, id: "wrong", kind: "state" }, env), /unavailable/i);
    const page = await request({ kind: "read", limit: 20 }) as { branchId: string };
    server.branchChanged();
    await assert.rejects(request({ kind: "read", branchId: page.branchId, limit: 20 }), /branch/i);
    await writeFile(`${dir}/config.json`, JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: "z", send: "/skill:review" }] } }));
    draft = "native draft";
    await assert.rejects(request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:review" }), /draft/i);
    draft = "";
    const body = { kind: "run-shortcut", key: "z", expectedSend: "/skill:review" };
    await Promise.all([request(body, "once"), request(body, "once")]);
    assert.equal(sends, 1);
    await assert.rejects(request(body), /dispatch|busy/i);
    server.lifecycleChanged();
    await request(body);
    assert.equal(sends, 2);
    await assert.rejects(startSessionInteraction(adapter), /occupied/i);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

async function fixture(overrides: Partial<import("../src/extension/session-interaction.js").InteractionAdapter> = {}) {
  const dir = await mkdtemp("/tmp/hc13.");
  const env = { PI_AGENT_HUB_DIR: dir };
  const bus = new EventEmitter();
  const adapter: import("../src/extension/session-interaction.js").InteractionAdapter = {
    managedId: "managed", piSessionId: "pi", env,
    events: { on(name, fn) { bus.on(name, fn); return () => { bus.off(name, fn); }; }, emit(name, data) { bus.emit(name, data); } },
    getPiSessionId: () => "pi", getBranch: () => [], isIdle: () => true, hasPendingMessages: () => false,
    getEditorText: () => "", uiPromptOpen: () => false, sendUserMessage() { throw new Error("unexpected send"); }, ...overrides,
  };
  const server = await startSessionInteraction(adapter);
  return { dir, env, bus, server, adapter,
    request(body: Record<string, unknown>, id: string = crypto.randomUUID()) { return requestSessionInteraction({ ...server.target, version: 1, id, ...body } as InteractionRequest, env); },
    async close() { await server.close(); await rm(dir, { recursive: true, force: true }); },
  };
}
const pending = [{ toolCallId: "call", params: { questions: [{ question: "Which?", header: "Choice", options: [{ label: "A", description: "first", preview: "full preview" }, { label: "B", description: "second" }] }] } }];

test("producer query subscribes before emit and duplicate answer writes settle once", async () => {
  const f = await fixture();
  let submits = 0;
  f.bus.on("rpiv:ask-user:request", (request) => {
    if (request.kind === "query") f.bus.emit("rpiv:ask-user:response", { version: 1, id: request.id, ok: true, pending });
    else { submits++; f.bus.emit("rpiv:ask-user:response", { version: 1, id: request.id, ok: true, accepted: true }); }
  });
  try {
    const state = await f.request({ kind: "state" }) as { pending: unknown; questionProtocol: boolean };
    assert.deepEqual(state.pending, pending);
    assert.equal(state.questionProtocol, true);
    const body = { kind: "submit-answer", toolCallId: "call", answers: [{ questionIndex: 0, kind: "option", optionIndex: 0 }] };
    await Promise.all([f.request(body, "answer"), f.request(body, "answer")]);
    assert.equal(submits, 1);
    await assert.rejects(f.request({ ...body, toolCallId: "other" }, "answer"), /already used/);
    assert.equal(f.bus.listenerCount("rpiv:ask-user:response"), 0);
  } finally { await f.close(); }
});

test("missing producer is discovered once and never blocks branch reads", async () => {
  const f = await fixture();
  let queries = 0;
  f.bus.on("rpiv:ask-user:request", () => queries++);
  try {
    await f.request({ kind: "read" });
    assert.equal(queries, 0);
    assert.equal((await f.request({ kind: "state" }) as { questionProtocol: boolean }).questionProtocol, false);
    await f.request({ kind: "state" });
    assert.equal(queries, 1);
  } finally { await f.close(); }
});

for (const [name, overrides] of [
  ["busy", { isIdle: () => false }], ["queued", { hasPendingMessages: () => true }],
  ["question", { uiPromptOpen: () => true }], ["draft", { getEditorText: () => "keep this" }],
] as const) test(`configured dispatch rejects ${name} at delivery`, async () => {
  const f = await fixture(overrides);
  f.bus.on("rpiv:ask-user:request", (r) => f.bus.emit("rpiv:ask-user:response", { version: 1, id: r.id, ok: true, pending: [] }));
  try {
    await writeFile(`${f.dir}/config.json`, JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: "z", send: "/skill:review" }] } }));
    await assert.rejects(f.request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:other" }), /changed/);
    await assert.rejects(f.request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:review" }), new RegExp(name));
  } finally { await f.close(); }
});

test("replacement invalidates submission held during producer query and removes listeners", async () => {
  const f = await fixture();
  let querySeen!: () => void;
  const seen = new Promise<void>((resolve) => { querySeen = resolve; });
  let submits = 0;
  f.bus.on("rpiv:ask-user:request", (r) => { if (r.kind === "query") querySeen(); else submits++; });
  const request = f.request({ kind: "submit-answer", toolCallId: "call", answers: [] });
  const rejected = assert.rejects(request, /not confirmed|unavailable/);
  await seen;
  await f.close();
  await rejected;
  assert.equal(submits, 0);
  assert.equal(f.bus.listenerCount("rpiv:ask-user:response"), 0);
});

test("overlong custom state path fails explicitly without another state root", async () => {
  assert.throws(() => interactionSocketPath("managed", { PI_AGENT_HUB_DIR: "/tmp/" + "x".repeat(120) }), /too long/);
});

test("malformed and oversized socket frames close without invoking Pi", async () => {
  const { createConnection } = await import("node:net");
  const f = await fixture();
  try {
    for (const frame of ["{bad}\n", "x".repeat(256 * 1024 + 1)]) {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(interactionSocketPath("managed", f.env));
        const timer = setTimeout(() => { socket.destroy(); reject(new Error("did not close")); }, 1000);
        socket.on("connect", () => socket.write(frame));
        socket.on("error", () => {});
        socket.on("close", () => { clearTimeout(timer); resolve(); });
        socket.on("data", () => reject(new Error("malformed request got a reply")));
      });
    }
  } finally { await f.close(); }
});

test("tree change invalidates a submission held during protocol discovery", async () => {
  const f = await fixture();
  let seen!: () => void;
  const started = new Promise<void>((resolve) => { seen = resolve; });
  f.bus.on("rpiv:ask-user:request", () => seen());
  try {
    const rejected = assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), /unavailable|branch/);
    await started;
    f.server.branchChanged();
    await rejected;
    assert.equal(f.bus.listenerCount("rpiv:ask-user:response"), 0);
  } finally { await f.close(); }
});

test("confirmed stale socket is replaced, but a regular file is never removed", async () => {
  const { spawn } = await import("node:child_process");
  const f = await fixture();
  await f.server.close();
  const path = interactionSocketPath("managed", f.env);
  try {
    await writeFile(path, "not a socket");
    await assert.rejects(startSessionInteraction(f.adapter), /non-socket/);
    await rm(path);
    const child = spawn(process.execPath, ["--input-type=module", "-e", `import {createServer} from 'node:net'; createServer().listen(${JSON.stringify(path)},()=>process.stdout.write('ready'));`], { stdio: ["ignore", "pipe", "inherit"] });
    try { await once(child.stdout!, "data"); }
    finally { child.kill("SIGKILL"); await once(child, "close"); }
    const replacement = await startSessionInteraction(f.adapter);
    try { assert.notEqual(replacement.target.instanceId, f.server.target.instanceId); }
    finally { await replacement.close(); }
  } finally { await f.close(); }
});

test("lost producer receipt reports uncertainty and never retries a write", async () => {
  const f = await fixture();
  let submits = 0;
  f.bus.on("rpiv:ask-user:request", (request) => {
    if (request.kind === "query") f.bus.emit("rpiv:ask-user:response", { version: 1, id: request.id, ok: true, pending });
    else submits++;
  });
  try {
    await assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [{ questionIndex: 0, kind: "option", optionIndex: 0 }] }), /Delivery not confirmed; check Pi before retrying/);
    assert.equal(submits, 1);
  } finally { await f.close(); }
});
