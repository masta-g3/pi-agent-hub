import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushSender, createRequestNotifier, encryptPushPayload, vapidAuthorization, type PushMessage } from "../src/web/push.js";
import type { RuntimeSession } from "../src/core/types.js";

const b64 = (value: string) => Buffer.from(value, "base64url");

test("payload encryption reproduces the RFC 8291 example", () => {
  const body = encryptPushPayload(
    Buffer.from("When I grow up, I want to be a watermelon"),
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    { salt: b64("DGv6ra1nlYgDCS1FRnbzlw"), privateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") },
  );
  assert.equal(body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("payload encryption rejects a key that is not a P-256 point", () => {
  const bad = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url");
  assert.throws(() => encryptPushPayload(Buffer.from("x"), { p256dh: bad, auth: "BTBZMqHH6r4Tts7J_aSIgg" }));
});

function device(name: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint: `https://push.example.net/send/${name}`, p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
}

async function withStore(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-hub-push-"));
  try { await fn(join(dir, "web-push.json")); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("the VAPID token is signed by the stored key and names the push service", async () => {
  await withStore(async (path) => {
    const sender = createPushSender({ path, now: () => 1_000_000 });
    const publicKey = await sender.publicKey();
    assert.equal(await sender.publicKey(), publicKey, "the key is generated once");
    const raw = b64(publicKey);
    assert.equal(raw.length, 65);
    const store = JSON.parse(await readFile(path, "utf8"));
    const header = vapidAuthorization("https://push.example.net/send/abc", store.vapid, 1_000_000);
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/u.exec(header)!;
    assert.equal(match[4], publicKey);
    assert.deepEqual(JSON.parse(b64(match[1]!).toString()), { typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(b64(match[2]!).toString());
    assert.equal(claims.aud, "https://push.example.net");
    assert.equal(claims.exp, 1_000 + 12 * 3600);
    assert.match(claims.sub, /^https:\/\//u);
    const key = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") } });
    assert.equal(verify("sha256", Buffer.from(`${match[1]}.${match[2]}`), { key, dsaEncoding: "ieee-p1363" }, b64(match[3]!)), true);
  });
});

test("notify sends one encrypted push per device and drops a device the service reports gone", async () => {
  await withStore(async (path) => {
    const requests: { url: string; headers: Record<string, string>; bytes: number }[] = [];
    const gone = new Set<string>();
    const sender = createPushSender({ path, fetch: async (url, init) => {
      requests.push({ url: String(url), headers: init!.headers as Record<string, string>, bytes: (init!.body as Uint8Array).byteLength });
      if (String(url).endsWith("/broken")) throw new Error("network down");
      return new Response(null, { status: gone.has(String(url)) ? 410 : 201 });
    } });
    const [phone, laptop, broken] = [device("phone"), device("laptop"), device("broken")];
    await sender.subscribe(phone);
    await sender.subscribe(laptop);
    await sender.subscribe(phone);
    await sender.subscribe(broken);
    await assert.rejects(sender.subscribe({ ...phone, endpoint: "http://push.example.net/x" }), /https/);
    await assert.rejects(sender.subscribe({ ...phone, auth: "short" }), /Invalid/);

    const message: PushMessage = { title: "Ask", body: "Question · Which one?", tag: "ask:req-1", url: "/#/s/ask" };
    const failures = await sender.notify(message);
    assert.deepEqual(requests.map((request) => request.url).sort(), [broken.endpoint, laptop.endpoint, phone.endpoint].sort());
    assert.equal(requests[0]!.headers["Content-Encoding"], "aes128gcm");
    assert.match(requests[0]!.headers.Authorization!, /^vapid t=/u);
    assert.equal(requests[0]!.headers.TTL, "3600");
    assert.deepEqual(failures, [`${broken.endpoint}: network down`]);

    gone.add(laptop.endpoint);
    requests.length = 0;
    await sender.notify(message);
    await sender.notify(message);
    assert.equal(requests.filter((request) => request.url === laptop.endpoint).length, 1, "a gone device is removed");
    await sender.unsubscribe(phone.endpoint);
    requests.length = 0;
    await sender.notify(message);
    assert.deepEqual(requests.map((request) => request.url), [broken.endpoint]);
  });
});

test("the device list keeps the 16 newest subscriptions", async () => {
  await withStore(async (path) => {
    const sender = createPushSender({ path, fetch: async () => new Response(null, { status: 201 }) });
    for (let index = 0; index < 18; index += 1) await sender.subscribe(device(`d${index}`));
    const store = JSON.parse(await readFile(path, "utf8"));
    assert.equal(store.subscriptions.length, 16);
    assert.equal(store.subscriptions[0].endpoint, "https://push.example.net/send/d2");
  });
});

function asking(id: string, requestId: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title: id.toUpperCase(), cwd: `/tmp/${id}`, group: "default", tmuxSession: `pi-agent-hub-${id}`, status: "waiting", createdAt: 1, updatedAt: 1,
    context: { version: 1, updatedAt: 10, attention: { requestId, kind: "question", text: `Question ${requestId}?` } },
    ...overrides,
  };
}

test("only a new request that the inbox shows is announced, once", () => {
  const sent: PushMessage[] = [];
  const notifier = createRequestNotifier([asking("old", "req-0")], (message) => { sent.push(message); }, 1_000);
  notifier.observe([asking("old", "req-0")], 2_000);
  assert.equal(sent.length, 0, "requests present at startup are not announced");

  const fleet = [
    asking("old", "req-0"),
    asking("ask", "req-1"),
    asking("kid", "req-2", { kind: "subagent", parentId: "ask" }),
    asking("shelved", "req-3", { bucket: "archived", bucketChangedAt: 1 }),
    asking("read", "req-4", { status: "idle", acknowledgedAt: 20, dismissedRequestId: "req-4" }),
  ];
  notifier.observe(fleet, 3_000);
  assert.equal(JSON.stringify(sent), JSON.stringify([{ title: "ASK", body: "Question · Question req-1?", tag: "ask:req-1", url: "/#/s/ask" }]));
  notifier.observe(fleet, 4_000);
  notifier.observe(fleet, 60_000);
  assert.equal(sent.length, 1);

  notifier.observe([asking("ask", "req-5", { context: { version: 1, updatedAt: 30, attention: { requestId: "req-5", kind: "ready", text: "x".repeat(600) } } })], 70_000);
  const bodies = sent.map((message) => message.body);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]!.startsWith("Ready · xxx"), true);
  assert.equal([...bodies[1]!].length <= 250, true);
});
