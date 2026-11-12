import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer, expectedOrigin, type WebServerDeps } from "../src/web/server.js";
import { DELIVERY_UNCONFIRMED, type SessionInteractionState } from "../src/core/session-interaction.js";
import type { RuntimeSession } from "../src/core/types.js";

function asking(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: "ask", title: "Ask", cwd: "/tmp/ask", group: "default", tmuxSession: "pi-agent-hub-ask", status: "waiting", createdAt: 1, updatedAt: 1,
    piSessionId: "pi-1", interaction: { version: 1, instanceId: "inst-1" },
    context: { version: 1, updatedAt: 10, attention: { requestId: "req-1", kind: "question", text: "Which one?" } },
    ...overrides,
  };
}

const STATE: SessionInteractionState = {
  answerChannel: "rpiv-events", questionProtocol: true, messageDelivery: "idle", lastMessage: "Tests pass.",
  pending: [{ toolCallId: "call-1", params: { questions: [{ question: "Context first. Which one?", header: "Pick", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } }],
};

interface Harness {
  base: string;
  origin: string;
  calls: string[];
  sessions: RuntimeSession[];
  staticDir: string;
  fail?: Error;
  publish(): void;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
}

async function withServer(fn: (h: Harness) => Promise<void>, sessions: RuntimeSession[] = [asking()]): Promise<void> {
  const staticDir = await mkdtemp(join(tmpdir(), "pi-agent-hub-web-"));
  await writeFile(join(staticDir, "index.html"), "<!doctype html><title>Hub</title>");
  const h = { calls: [] as string[], sessions, staticDir } as Harness;
  const deps: WebServerDeps = {
    staticDir,
    sessions: () => h.sessions,
    now: () => 1_000,
    loadState: async () => STATE,
    async loadConversation(target, options) {
      h.calls.push(`read:${target.instanceId}:${JSON.stringify(options ?? {})}`);
      if (h.fail) throw h.fail;
      return options?.before
        ? { branchId: "b", revision: "r", items: [{ id: "0", role: "user", text: "Earlier" }] }
        : { branchId: "b", revision: "r", before: "1", items: [{ id: "1", role: "assistant", text: "Hello", toolCallId: "x", at: 1_700_000_000_000 }, { id: "2", role: "user", text: "Long", truncated: true }] };
    },
    async submitAnswer(target, toolCallId, answers) {
      h.calls.push(`answer:${target.instanceId}:${toolCallId}:${JSON.stringify(answers)}`);
      if (h.fail) throw h.fail;
    },
    async sendMessage(target, text, delivery) {
      h.calls.push(`send:${target.instanceId}:${delivery}:${text}`);
      if (h.fail) throw h.fail;
    },
    async acknowledge(id, requestId, dismiss, expected) { h.calls.push(`ack:${id}:${requestId}:${dismiss}:${expected.piSessionId}`); },
    async touch(id) { h.calls.push(`touch:${id}`); },
  };
  const web = createWebServer(deps);
  await new Promise<void>((done) => web.server.listen(0, "127.0.0.1", done));
  const port = (web.server.address() as AddressInfo).port;
  h.base = `http://127.0.0.1:${port}`;
  h.origin = h.base;
  h.publish = () => web.publish();
  h.post = (path, body, headers = {}) => fetch(`${h.base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: h.origin, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  try { await fn(h); } finally { await web.close(); await rm(staticDir, { recursive: true, force: true }); }
}

const TARGET = { piSessionId: "pi-1", instanceId: "inst-1" };

test("expected origin accepts loopback over http and tailnet names over https only", () => {
  assert.equal(expectedOrigin("127.0.0.1:4747"), "http://127.0.0.1:4747");
  assert.equal(expectedOrigin("localhost:4747"), "http://localhost:4747");
  assert.equal(expectedOrigin("mac.tail1234.ts.net"), "https://mac.tail1234.ts.net");
  assert.equal(expectedOrigin("evil.example.com"), undefined);
  assert.equal(expectedOrigin("ts.net.evil.com"), undefined);
  assert.equal(expectedOrigin("127.0.0.1@evil.com"), undefined);
  assert.equal(expectedOrigin(undefined), undefined);
});

test("serves the page with a strict content security policy and rejects foreign hosts", async () => {
  await withServer(async (h) => {
    const page = await fetch(`${h.base}/`);
    assert.equal(page.status, 200);
    // frame-ancestors blocks another page from framing the inbox and steering taps onto its buttons.
    assert.equal(page.headers.get("content-security-policy"), "default-src 'self'; frame-ancestors 'none'");
    assert.match(await page.text(), /Hub/);
    assert.equal((await fetch(`${h.base}/../package.json`)).status, 404);
    // The page's own modules are served by name; nothing else in the directory is.
    for (const name of ["markdown.js", "chat.js"]) {
      await writeFile(join(h.staticDir, name), "export {};");
      const module = await fetch(`${h.base}/${name}`);
      assert.equal(module.status, 200, name);
      assert.match(module.headers.get("content-type") ?? "", /^text\/javascript/u);
    }
    await writeFile(join(h.staticDir, "other.js"), "export {};");
    assert.equal((await fetch(`${h.base}/other.js`)).status, 404);
    // fetch() cannot forge Host; a rebinding browser sends the attacker's name here.
    const status = await new Promise<number>((done, fail) => {
      request(`${h.base}/`, { headers: { Host: "evil.example.com" } }, (res) => { res.resume(); done(res.statusCode ?? 0); }).on("error", fail).end();
    });
    assert.equal(status, 403);
  });
});

test("event stream sends a snapshot on connect and again only after a change", async () => {
  await withServer(async (h) => {
    const response = await fetch(`${h.base}/api/events`);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const next = async () => JSON.parse(/data: (.*)\n/u.exec(decoder.decode((await reader.read()).value))![1]!);
    const first = await next();
    assert.equal(first.requestCount, 1);
    assert.equal(first.tiers[0].sessions[0].attention.requestId, "req-1");
    h.publish();
    h.publish();
    h.sessions = [asking({ title: "Renamed" })];
    h.publish();
    const second = await next();
    assert.equal(second.tiers[0].sessions[0].title, "Renamed");
    await reader.cancel();
  });
});

test("session detail returns formatted questions and the newest page of the conversation", async () => {
  await withServer(async (h) => {
    const body = await (await fetch(`${h.base}/api/sessions/ask`)).json() as any;
    assert.equal(body.session.id, "ask");
    assert.equal(body.interaction.canAnswer, true);
    // The transcript carries the latest message, so the detail does not repeat it.
    assert.equal("lastMessage" in body.interaction, false);
    assert.equal(body.interaction.pending[0].toolCallId, "call-1");
    assert.equal(body.interaction.pending[0].questions[0].ask, "Which one?");
    assert.equal(body.interaction.pending[0].questions[0].context, "Context first.");
    assert.deepEqual(body.conversation, { branchId: "b", revision: "r", before: "1", items: [
      { id: "1", role: "assistant", text: "Hello", toolCallId: "x", at: 1_700_000_000_000 }, { id: "2", role: "user", text: "Long", truncated: true },
    ] });
    assert.equal((await (await fetch(`${h.base}/api/sessions/ask?conversation=0`)).json() as any).conversation, undefined);
    assert.equal((await fetch(`${h.base}/api/sessions/missing`)).status, 404);
  });
});

test("earlier messages are read from the displayed branch and cursor only", async () => {
  await withServer(async (h) => {
    const earlier = await fetch(`${h.base}/api/sessions/ask/conversation?before=1&branch=b`);
    assert.equal(earlier.status, 200);
    assert.deepEqual(await earlier.json(), { branchId: "b", revision: "r", items: [{ id: "0", role: "user", text: "Earlier" }] });
    assert.deepEqual(h.calls, ['read:inst-1:{"before":"1","branchId":"b"}']);
    h.calls.length = 0;

    for (const query of ["", "?before=1", "?branch=b", "?before=&branch=b", `?before=${"x".repeat(257)}&branch=b`, `?before=1&branch=${"x".repeat(257)}`]) {
      assert.equal((await fetch(`${h.base}/api/sessions/ask/conversation${query}`)).status, 400, query);
    }
    assert.deepEqual(h.calls, []);
    assert.equal((await fetch(`${h.base}/api/sessions/missing/conversation?before=1&branch=b`)).status, 404);

    // The extension rejects a cursor from a branch the session has left.
    h.fail = new Error("Conversation branch changed");
    const moved = await fetch(`${h.base}/api/sessions/ask/conversation?before=1&branch=old`);
    assert.equal(moved.status, 409);
    assert.deepEqual(await moved.json(), { error: "Conversation branch changed" });
    h.fail = new Error("Conversation cursor is no longer on the current branch");
    assert.equal((await fetch(`${h.base}/api/sessions/ask/conversation?before=gone&branch=b`)).status, 409);

    // Only a moved branch or cursor is a 409: the page drops its history on one, and must not for a read that merely failed.
    for (const message of ["Session interaction timed out", "Session interaction unavailable", "Interaction response too large"]) {
      h.fail = new Error(message);
      const failed = await fetch(`${h.base}/api/sessions/ask/conversation?before=1&branch=b`);
      assert.equal(failed.status, 503, message);
      assert.deepEqual(await failed.json(), { error: message });
    }
    h.fail = undefined;

    h.sessions = [asking({ status: "stopped" })];
    const stopped = await fetch(`${h.base}/api/sessions/ask/conversation?before=1&branch=b`);
    assert.equal(stopped.status, 503);
    assert.deepEqual(await stopped.json(), { error: "Session is not running" });

    // Reading is not activity, and it is not a write route.
    assert.doesNotMatch(h.calls.join("\n"), /touch|ack|send|answer/u);
    assert.equal((await h.post("/api/sessions/ask/conversation?before=1&branch=b", {})).status, 404);
    const status = await new Promise<number>((done, fail) => {
      request(`${h.base}/api/sessions/ask/conversation?before=1&branch=b`, { headers: { Host: "evil.example.com" } }, (res) => { res.resume(); done(res.statusCode ?? 0); }).on("error", fail).end();
    });
    assert.equal(status, 403);
  });
});

test("writes require a JSON body from the page's own origin", async () => {
  await withServer(async (h) => {
    const reply = { ...TARGET, text: "hi", delivery: "send" };
    const port = new URL(h.base).port;
    for (const origin of ["https://evil.example.com", `https://127.0.0.1:${port}`, "http://127.0.0.1:1", `http://localhost:${port}`]) {
      assert.equal((await h.post("/api/sessions/ask/reply", reply, { Origin: origin })).status, 403, origin);
    }
    assert.equal((await fetch(`${h.base}/api/sessions/ask/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reply) })).status, 403);
    assert.equal((await h.post("/api/sessions/ask/reply", reply, { "Content-Type": "text/plain" })).status, 403);
    assert.equal((await h.post("/api/sessions/ask/reply", JSON.stringify({ ...reply, text: "x".repeat(70_000) }))).status, 413);
    assert.deepEqual(h.calls, []);
  });
});

test("an accepted answer dismisses that request and counts as activity", async () => {
  await withServer(async (h) => {
    const answers = [{ questionIndex: 0, kind: "option", optionIndex: 1, notes: "because" }];
    const response = await h.post("/api/sessions/ask/answer", { ...TARGET, toolCallId: "call-1", answers, requestId: "req-1" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "accepted" });
    assert.deepEqual(h.calls, [`answer:inst-1:call-1:${JSON.stringify(answers)}`, "ack:ask:req-1:true:pi-1", "touch:ask"]);
  });
});

test("a stale target or malformed answer is rejected without a send", async () => {
  await withServer(async (h) => {
    const answers = [{ questionIndex: 0, kind: "option", optionIndex: 0 }];
    assert.equal((await h.post("/api/sessions/ask/answer", { piSessionId: "pi-1", instanceId: "inst-old", toolCallId: "call-1", answers })).status, 409);
    assert.equal((await h.post("/api/sessions/ask/reply", { piSessionId: "pi-old", instanceId: "inst-1", text: "hi", delivery: "send" })).status, 409);
    assert.equal((await h.post("/api/sessions/ask/answer", { ...TARGET, toolCallId: "call-1", answers: [{ questionIndex: 0, kind: "custom", text: " " }] })).status, 400);
    assert.equal((await h.post("/api/sessions/ask/reply", { ...TARGET, text: "hi", delivery: "shout" })).status, 400);
    h.sessions = [asking({ status: "stopped" })];
    assert.equal((await h.post("/api/sessions/ask/reply", { ...TARGET, text: "hi", delivery: "send" })).status, 409);
    assert.deepEqual(h.calls, []);
  });
});

test("replies report accepted, unknown or rejected and never acknowledge on failure", async () => {
  await withServer(async (h) => {
    const reply = { ...TARGET, text: "go on", delivery: "steer" };
    assert.deepEqual(await (await h.post("/api/sessions/ask/reply", reply)).json(), { status: "accepted" });
    assert.deepEqual(h.calls, ["send:inst-1:steer:go on", "touch:ask"]);

    h.calls.length = 0;
    h.fail = new Error(DELIVERY_UNCONFIRMED);
    const unknown = await h.post("/api/sessions/ask/reply", reply);
    assert.equal(unknown.status, 504);
    assert.deepEqual(await unknown.json(), { status: "unknown", error: DELIVERY_UNCONFIRMED });

    h.fail = new Error("Question was answered elsewhere");
    const rejected = await h.post("/api/sessions/ask/answer", { ...TARGET, toolCallId: "call-1", answers: [{ questionIndex: 0, kind: "option", optionIndex: 0 }], requestId: "req-1" });
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rejected.json(), { status: "rejected", error: "Question was answered elsewhere" });
    assert.equal(h.calls.some((call) => call.startsWith("ack") || call.startsWith("touch")), false);
  });
});

test("mark read dismisses only the request and conversation the card displayed", async () => {
  await withServer(async (h) => {
    assert.equal((await h.post("/api/sessions/ask/read", { piSessionId: "pi-1", requestId: "req-old" })).status, 409);
    assert.equal((await h.post("/api/sessions/ask/read", { piSessionId: "pi-old", requestId: "req-1" })).status, 409);
    assert.equal((await h.post("/api/sessions/ask/read", { piSessionId: "pi-1" })).status, 409);
    assert.deepEqual(h.calls, []);
    assert.equal((await h.post("/api/sessions/ask/read", { piSessionId: "pi-1", requestId: "req-1" })).status, 200);
    assert.deepEqual(h.calls, ["ack:ask:req-1:true:pi-1"]);

    h.calls.length = 0;
    h.sessions = [asking({ context: undefined })];
    assert.equal((await h.post("/api/sessions/ask/read", { piSessionId: "pi-1" })).status, 200);
    assert.deepEqual(h.calls, ["ack:ask:undefined:false:pi-1"]);
  });
});
