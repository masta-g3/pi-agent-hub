import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter, once } from "node:events";
import { startSessionInteraction, type InteractionAdapter } from "../src/extension/session-interaction.js";
import { requestSessionInteraction, interactionSocketPath, parseInteractionRequest, parsePendingQuestions, INTERACTION_BYTE_CAP, type InteractionRequest, type SessionInteractionState } from "../src/core/session-interaction.js";

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
const pending = [{ toolCallId: "call", params: { questions: [{ question: "Which?", header: "Choice", options: [{ label: "A", description: "first", hasPreview: true }, { label: "B", description: "second", hasPreview: false }] }] } }];
const prompt = (f: Awaited<ReturnType<typeof fixture>>, toolCallId = "call") => f.bus.emit("rpiv:ask-user:prompt", { toolCallId, ...pending[0]!.params });

test("official prompts track multiple questionnaires across dashboard connections, native closure, and branch changes", async () => {
  const f = await fixture();
  const state = () => f.request({ kind: "state" }) as Promise<SessionInteractionState>;
  try {
    assert.equal((await state()).questionProtocol, false);
    assert.equal((await state()).answerChannel, "rpiv-events");
    prompt(f);
    prompt(f, "second");
    assert.equal((await state()).questionProtocol, true);
    assert.deepEqual((await state()).pending.map(p => p.toolCallId), ["call", "second"]);
    // Each request opens a new dashboard connection; the producer process owns the tracker.
    assert.deepEqual((await state()).pending.map(p => p.toolCallId), ["call", "second"]);
    f.bus.emit("rpiv:ask-user:blocked", { active: true, toolCallId: "call" });
    assert.equal((await state()).pending.length, 2);
    f.bus.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "call" });
    assert.deepEqual((await state()).pending.map(p => p.toolCallId), ["second"]);
    await assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), /Question stale/);
    f.server.branchChanged();
    assert.deepEqual((await state()).pending, []);
    assert.equal((await state()).questionProtocol, true);
  } finally { await f.close(); }
  assert.equal(f.bus.listenerCount("rpiv:ask-user:prompt"), 0);
  assert.equal(f.bus.listenerCount("rpiv:ask-user:blocked"), 0);
});

test("official prompts ignore append-only fields and keep a snapshot of producer data", async () => {
  const f = await fixture();
  try {
    const questions = structuredClone(pending[0]!.params.questions);
    const payload = { toolCallId: "call", extra: "ignored", questions: questions.map(q => ({ ...q, extra: "ignored", options: q.options.map(o => ({ ...o, extra: "ignored" })) })) };
    f.bus.emit("rpiv:ask-user:prompt", payload);
    payload.questions[0]!.question = "changed later";
    assert.deepEqual((await f.request({ kind: "state" }) as SessionInteractionState).pending, pending);
  } finally { await f.close(); }
});

test("answer notes are optional bounded strings, never an answer on their own", () => {
  const request = { version: 1, id: "id", managedId: "managed", piSessionId: "pi", instanceId: "instance", kind: "submit-answer", toolCallId: "call" };
  const answer = { questionIndex: 0, kind: "option", optionIndex: 0 };
  for (const notes of [undefined, "", "Qualification", "x".repeat(8192)]) assert.ok(parseInteractionRequest({ ...request, answers: [{ ...answer, notes }] }));
  for (const notes of [1, null, {}, "x".repeat(8193)]) assert.equal(parseInteractionRequest({ ...request, answers: [{ ...answer, notes }] }), undefined);
  assert.equal(parseInteractionRequest({ ...request, answers: [{ questionIndex: 0, notes: "Only a note" }] }), undefined);
});

test("preview contract validates optional bounded text", () => {
  const value = structuredClone(pending);
  Object.assign(value[0]!.params.questions[0]!.options[0]!, { preview: "Real preview" });
  assert.equal(parsePendingQuestions(value)?.[0]?.params.questions[0]?.options[0]?.preview, "Real preview");
  Object.assign(value[0]!.params.questions[0]!.options[0]!, { preview: 1 });
  assert.equal(parsePendingQuestions(value), undefined);
  Object.assign(value[0]!.params.questions[0]!.options[0]!, { preview: "x".repeat(INTERACTION_BYTE_CAP) });
  assert.equal(parsePendingQuestions(value), undefined);
});

test("state reads sanitized previews only from the exact current-branch tool call and bounds the full frame", async () => {
  let branch: unknown[] = [];
  const f = await fixture({ getBranch: () => branch });
  const state = () => f.request({ kind: "state" }) as Promise<SessionInteractionState>;
  const entry = (id: string, preview: string) => ({ type: "message", id: "entry", message: { role: "assistant", content: [{ type: "toolCall", name: "ask_user_question", id, arguments: { questions: pending[0]!.params.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o, preview })) })) } }] } });
  try {
    prompt(f);
    branch = [entry("other", "wrong")];
    assert.equal((await state()).pending[0]?.params.questions[0]?.options[0]?.preview, undefined);
    branch = [entry("call", "real\u001b]52;c;secret\u0007 preview")];
    assert.equal((await state()).pending[0]?.params.questions[0]?.options[0]?.preview, "real preview");
    branch = [entry("call", "界\"\\\n".repeat(INTERACTION_BYTE_CAP))];
    const large = await state();
    assert.ok(large.pending[0]?.params.questions[0]?.options[0]?.preview?.length);
    assert.ok(Buffer.byteLength(JSON.stringify({ version: 1, id: "x".repeat(128), ...f.server.target, ok: true, result: large })) + 1 <= INTERACTION_BYTE_CAP);
    branch = [];
    assert.equal((await state()).pending[0]?.params.questions[0]?.options[0]?.preview, undefined);
    f.server.branchChanged();
    assert.deepEqual((await state()).pending, []);
  } finally { await f.close(); }
});

test("all sixteen previews share the remaining full-state byte budget", async () => {
  const questions = Array.from({ length: 4 }, (_, i) => ({ question: `Question ${i} ` + "q".repeat(48_000), header: `Tab ${i}`, options: Array.from({ length: 4 }, (_, j) => ({ label: `Option ${j}`, description: "Description", hasPreview: true })) }));
  const args = { questions: questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o, preview: "\"\\\n界".repeat(INTERACTION_BYTE_CAP) })) })) };
  const f = await fixture({ getBranch: () => [{ type: "message", id: "entry", message: { role: "assistant", content: [{ type: "toolCall", name: "ask_user_question", id: "call", arguments: args }] } }] });
  try {
    f.bus.emit("rpiv:ask-user:prompt", { toolCallId: "call", questions });
    const state = await f.request({ kind: "state" }, "x".repeat(128)) as SessionInteractionState;
    assert.equal(state.pending[0]?.params.questions.length, 4);
    assert.ok(state.pending[0]?.params.questions[0]?.options[0]?.preview);
    assert.ok(Buffer.byteLength(JSON.stringify({ version: 1, id: "x".repeat(128), ...f.server.target, ok: true, result: state })) + 1 <= INTERACTION_BYTE_CAP);
    assert.ok(parsePendingQuestions(state.pending));
  } finally { await f.close(); }
});

test("official tracker validates prompt shapes and reports legacy and Pi-only prompts", async () => {
  const f = await fixture({ uiPromptOpen: () => true });
  const state = () => f.request({ kind: "state" }) as Promise<SessionInteractionState>;
  try {
    assert.equal((await state()).questionUnavailableReason, "This prompt can only be answered in Pi");
    for (const questions of [[], Array(5).fill(pending[0]!.params.questions[0]), [{ ...pending[0]!.params.questions[0], options: [] }], [{ ...pending[0]!.params.questions[0], options: [{ label: "A", description: "x", hasPreview: "yes" }, { label: "B", description: "y" }] }]]) {
      f.bus.emit("rpiv:ask-user:prompt", { toolCallId: "bad", questions });
    }
    assert.deepEqual((await state()).pending, []);
    assert.equal((await state()).questionProtocol, false);
    f.bus.emit("rpiv:ask-user:prompt", pending[0]!.params);
    assert.equal((await state()).questionUnavailableReason, "Update rpiv-ask-user-question to 2.15+ to answer from Hub");
  } finally { await f.close(); }
});

test("official answers map every input, subscribe before emit, and replay duplicate writes once", async () => {
  const f = await fixture();
  const attempts: { toolCallId: string; requestId: string; answers: unknown[] }[] = [];
  f.bus.on("rpiv:ask-user:answer", (request) => {
    attempts.push(request);
    f.bus.emit("rpiv:ask-user:answer-result", { requestId: "unrelated", ok: false, code: "not_found" });
    f.bus.emit("rpiv:ask-user:answer-result", { requestId: request.requestId, toolCallId: request.toolCallId, ok: true });
  });
  try {
    prompt(f); prompt(f, "second");
    const body = { kind: "submit-answer", toolCallId: "call", answers: [
      { questionIndex: 0, kind: "option", optionIndex: 1, notes: "Keep the boundary" },
      { questionIndex: 1, kind: "multi", optionIndices: [0, 2], notes: "Both" },
      { questionIndex: 2, kind: "custom", text: "My choice", notes: "Qualification" },
    ] };
    assert.deepEqual(await Promise.all([f.request(body, "answer"), f.request(body, "answer")]), [{ accepted: true }, { accepted: true }]);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.toolCallId, "call");
    assert.ok(attempts[0]!.requestId);
    assert.deepEqual(attempts[0]!.answers, [
      { questionIndex: 0, optionIndexes: [1], notes: "Keep the boundary" }, { questionIndex: 1, optionIndexes: [0, 2], notes: "Both" }, { questionIndex: 2, text: "My choice", notes: "Qualification" },
    ]);
    assert.deepEqual((await f.request({ kind: "state" }) as SessionInteractionState).pending.map(p => p.toolCallId), ["second"]);
    await assert.rejects(f.request({ ...body, toolCallId: "other" }, "answer"), /already used/);
    await f.request({ ...body, toolCallId: "second" });
    assert.notEqual(attempts[0]!.requestId, attempts[1]!.requestId);
    assert.equal(f.bus.listenerCount("rpiv:ask-user:answer-result"), 0);
  } finally { await f.close(); }
});

for (const [code, error, retained] of [
  ["not_found", /Question stale; answered elsewhere or closed/, false],
  ["invalid_answer", /Answer rejected: choose an option/, true],
  ["invalid_payload", /Answer rejected: choose an option/, true],
  ["unsupported_host", /This prompt can only be answered in Pi/, false],
] as const) test(`official verdict ${code} updates pending and reports the reason`, async () => {
  const f = await fixture();
  f.bus.on("rpiv:ask-user:answer", r => f.bus.emit("rpiv:ask-user:answer-result", { requestId: r.requestId, toolCallId: r.toolCallId, ok: false, code, reason: "choose an option" }));
  try {
    prompt(f);
    await assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), error);
    const state = await f.request({ kind: "state" }) as SessionInteractionState;
    assert.equal(state.pending.length, retained ? 1 : 0);
    if (code === "unsupported_host") {
      assert.equal(state.questionUnavailableReason, "This prompt can only be answered in Pi");
      f.bus.emit("rpiv:ask-user:blocked", { active: false, toolCallId: "call" });
      assert.equal((await f.request({ kind: "state" }) as SessionInteractionState).questionUnavailableReason, undefined);
    }
  } finally { await f.close(); }
});

for (const [name, overrides] of [
  ["busy", { isIdle: () => false }], ["queued", { hasPendingMessages: () => true }],
  ["question", { uiPromptOpen: () => true }], ["draft", { getEditorText: () => "keep this" }],
] as const) test(`configured dispatch rejects ${name} at delivery`, async () => {
  const f = await fixture(overrides);
  try {
    await writeFile(`${f.dir}/config.json`, JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: "z", send: "/skill:review" }] } }));
    await assert.rejects(f.request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:other" }), /changed/);
    await assert.rejects(f.request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:review" }), new RegExp(name));
  } finally { await f.close(); }
});

test("configured dispatch stays blocked by an unsupported questionnaire until it closes", async () => {
  const f = await fixture();
  f.bus.on("rpiv:ask-user:answer", r => f.bus.emit("rpiv:ask-user:answer-result", { requestId: r.requestId, ok: false, code: "unsupported_host" }));
  try {
    await writeFile(`${f.dir}/config.json`, JSON.stringify({ version: 1, dashboard: { shortcuts: [{ key: "z", send: "/skill:review" }] } }));
    prompt(f);
    await assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), /only be answered in Pi/);
    await assert.rejects(f.request({ kind: "run-shortcut", key: "z", expectedSend: "/skill:review" }), /pending Pi question/);
  } finally { await f.close(); }
});

test("shutdown cancels an in-flight answer and removes listeners", async () => {
  const f = await fixture();
  prompt(f);
  const seen = once(f.bus, "rpiv:ask-user:answer");
  const rejected = assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), /not confirmed|unavailable/);
  await seen;
  await f.close();
  await rejected;
  assert.equal(f.bus.listenerCount("rpiv:ask-user:answer-result"), 0);
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

test("tree change invalidates an in-flight answer with the branch error", async () => {
  const f = await fixture();
  prompt(f);
  const started = once(f.bus, "rpiv:ask-user:answer");
  try {
    const rejected = assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [] }), /Conversation branch changed/);
    await started;
    f.server.branchChanged();
    await rejected;
    assert.equal(f.bus.listenerCount("rpiv:ask-user:answer-result"), 0);
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

test("message delivery uses Pi's steer and follow-up APIs without touching its editor or blocking on existing queues", async () => {
  let idle = false;
  const sent: unknown[] = [];
  const f = await fixture({ isIdle: () => idle, hasPendingMessages: () => true, getEditorText: () => "keep my draft",
    sendUserMessage: (text, options) => { sent.push({ text, options }); },
  });
  try {
    assert.equal((await f.request({ kind: "state" }) as { messageDelivery?: string }).messageDelivery, "busy");
    await f.request({ kind: "send-message", text: "change direction", delivery: "steer" });
    const queued = { kind: "send-message", text: "/literal text", delivery: "followUp" };
    await Promise.all([f.request(queued, "queued-once"), f.request(queued, "queued-once")]);
    idle = true;
    assert.equal((await f.request({ kind: "state" }) as { messageDelivery?: string }).messageDelivery, "idle");
    await f.request({ kind: "send-message", text: "new task", delivery: "send" });
    assert.deepEqual(sent, [
      { text: "change direction", options: { deliverAs: "steer", expandPromptTemplates: false } },
      { text: "/literal text", options: { deliverAs: "followUp", expandPromptTemplates: false } },
      { text: "new task", options: { deliverAs: "steer", expandPromptTemplates: true } },
    ]);
  } finally { await f.close(); }
});

test("send rejects an idle-to-busy race and stale session identity without dispatch", async () => {
  let sends = 0;
  let piSessionId = "pi";
  const f = await fixture({ isIdle: () => false, getPiSessionId: () => piSessionId, sendUserMessage: () => { sends++; } });
  try {
    await assert.rejects(f.request({ kind: "send-message", text: "hello", delivery: "send" }), /Steer|Queue/);
    piSessionId = "replacement";
    await assert.rejects(f.request({ kind: "send-message", text: "hello", delivery: "steer" }), /unavailable/);
    assert.equal(sends, 0);
  } finally { await f.close(); }
});

test("explicit queued delivery still dispatches if Pi becomes idle", async () => {
  let options: unknown;
  const f = await fixture({ sendUserMessage: (_text, value) => { options = value; } });
  try {
    await f.request({ kind: "send-message", text: "next task", delivery: "followUp" });
    assert.deepEqual(options, { deliverAs: "followUp", expandPromptTemplates: false });
  } finally { await f.close(); }
});

test("message request parsing rejects blank text and unknown delivery modes", () => {
  const base = { version: 1, id: "request", managedId: "managed", piSessionId: "pi", instanceId: "instance", kind: "send-message", text: "hello", delivery: "steer" };
  assert.ok(parseInteractionRequest(base));
  for (const changes of [{ text: " " }, { text: 2 }, { delivery: "queue" }, { delivery: ["steer"] }, { delivery: undefined }]) {
    assert.equal(parseInteractionRequest({ ...base, ...changes }), undefined);
  }
});

test("lost producer receipt reports uncertainty and never retries a write", async () => {
  const f = await fixture();
  let submits = 0;
  prompt(f);
  f.bus.on("rpiv:ask-user:answer", () => submits++);
  try {
    await assert.rejects(f.request({ kind: "submit-answer", toolCallId: "call", answers: [{ questionIndex: 0, kind: "option", optionIndex: 0 }] }), /Delivery not confirmed; check Pi before retrying/);
    assert.equal(submits, 1);
    assert.equal((await f.request({ kind: "state" }) as SessionInteractionState).pending.length, 1);
  } finally { await f.close(); }
});
