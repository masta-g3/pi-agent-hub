import test from "node:test";
import assert from "node:assert/strict";
import {
  createAttentionDeliveryState,
  observeAttentionDelivery,
  routeAttentionDeliveries,
  type AttentionDeliveryState,
} from "../src/app/attention-delivery.js";
import type { RuntimeSession, SessionAttentionKind } from "../src/core/types.js";

function session(id: string, requestId?: string, options: {
  status?: RuntimeSession["status"];
  kind?: SessionAttentionKind;
  text?: string;
  acknowledgedAt?: number;
  parentId?: string;
  title?: string;
  workflowUpdatedAt?: number;
} = {}): RuntimeSession {
  return {
    id,
    title: options.title ?? id.toUpperCase(),
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: options.status ?? "waiting",
    createdAt: 1,
    updatedAt: 1,
    ...(options.acknowledgedAt === undefined ? {} : { acknowledgedAt: options.acknowledgedAt }),
    ...(options.parentId ? { kind: "subagent", parentId: options.parentId } : {}),
    ...(options.workflowUpdatedAt ? { workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: options.workflowUpdatedAt } } : {}),
    ...(requestId ? { context: { version: 1, updatedAt: 1, attention: { requestId, kind: options.kind ?? "question", text: options.text ?? `Request ${requestId}` } } } : {}),
  };
}

function observe(state: AttentionDeliveryState, sessions: RuntimeSession[], now: number) {
  return observeAttentionDelivery(state, sessions, now);
}

test("cold start seeds existing request identities without announcing them", () => {
  const state = createAttentionDeliveryState([session("api", "req-1"), session("legacy")], 1_000);
  assert.deepEqual(state.active, []);
  assert.deepEqual(observe(state, [session("api", "req-1")], 1_100).fresh, []);
});

test("announces each session and request identity once and ignores non-request updates", () => {
  let state = createAttentionDeliveryState([], 1_000);
  const first = observe(state, [session("api", "same")], 2_000);
  state = first.state;
  assert.deepEqual(first.fresh.map((entry) => entry.key), ["api\0same"]);
  assert.equal(first.active[0]?.expiresAt, 8_000);

  const unchanged = observe(state, [session("api", "same", { title: "Renamed", workflowUpdatedAt: 9 })], 2_100);
  state = unchanged.state;
  assert.deepEqual(unchanged.fresh, []);
  assert.equal(unchanged.active[0]?.title, "Renamed");

  const otherSession = observe(state, [session("api", "same"), session("web", "same")], 2_200);
  state = otherSession.state;
  assert.deepEqual(otherSession.fresh.map((entry) => entry.key), ["web\0same"]);

  const replaced = observe(state, [session("api", "next"), session("web", "same")], 2_300);
  assert.deepEqual(replaced.fresh.map((entry) => entry.key), ["api\0next"]);
  assert.equal(replaced.active.some((entry) => entry.key === "api\0same"), false);
});

test("withdrawal and same-ID reappearance do not announce twice", () => {
  let state = observe(createAttentionDeliveryState([], 0), [session("api", "req-1")], 100).state;
  state = observe(state, [session("api")], 200).state;
  const reappeared = observe(state, [session("api", "req-1")], 300);
  assert.deepEqual(reappeared.fresh, []);
  assert.deepEqual(reappeared.active, []);
});

test("prunes individual expiry, acknowledgement, ineligible state, and removed sessions", () => {
  let result = observe(createAttentionDeliveryState([], 0), [session("api", "one"), session("web", "two")], 1_000);
  let state = result.state;
  result = observe(state, [session("api", "one"), session("web", "two", { acknowledgedAt: 1_100 })], 1_100);
  state = result.state;
  assert.deepEqual(result.active.map((entry) => entry.sessionId), ["api"]);

  result = observe(state, [session("api", "one", { status: "running" })], 1_200);
  state = result.state;
  assert.deepEqual(result.active, []);

  result = observe(state, [session("api", "three")], 2_000);
  state = result.state;
  assert.equal(result.active.length, 1);
  result = observe(state, [session("api", "three")], 8_000);
  assert.deepEqual(result.active, []);

  const removed = observe(result.state, [], 8_100);
  const returned = observe(removed.state, [session("api", "three")], 8_200);
  assert.deepEqual(returned.fresh.map((entry) => entry.key), ["api\0three"]);
});

test("orders newest requests first and preserves child owner identity", () => {
  let state = createAttentionDeliveryState([session("parent")], 0);
  state = observe(state, [session("parent"), session("child", "one", { parentId: "parent" })], 100).state;
  const result = observe(state, [session("parent"), session("child", "one", { parentId: "parent" }), session("web", "two", { kind: "blocked" })], 200);
  assert.deepEqual(result.active.map((entry) => entry.sessionId), ["web", "child"]);
  assert.deepEqual(result.fresh.map((entry) => entry.sessionId), ["web"]);
  assert.equal(result.active[1]?.ownerTitle, "PARENT");

  const nested = observe(createAttentionDeliveryState([], 0), [
    session("grand"),
    session("parent", undefined, { parentId: "grand" }),
    session("nested", "three", { parentId: "parent" }),
  ], 300);
  assert.equal(nested.active[0]?.ownerTitle, "GRAND");
});

test("routes requests per client and suppresses process-wide bell for mixed focus", () => {
  const fresh = observe(createAttentionDeliveryState([], 0), [session("api", "one"), session("web", "two")], 100).fresh;
  const clients = [
    { name: "api-client", tty: "/dev/1", session: "pi-agent-hub-api", paneId: "%7", flags: ["attached"] },
    { name: "dashboard-client", tty: "/dev/2", session: "pi-agent-hub-dashboard", paneId: "%1", flags: ["attached"] },
    { name: "other-client", tty: "/dev/3", session: "shell", paneId: "%9", flags: ["attached"] },
  ];
  const routed = routeAttentionDeliveries(fresh, clients, {
    dashboardSession: "pi-agent-hub-dashboard",
    dashboardPaneId: "%1",
    pins: [],
  });
  assert.deepEqual(routed.deliveries.map((delivery) => [delivery.client.name, delivery.entries.map((entry) => entry.sessionId)]), [
    ["api-client", ["web"]],
    ["other-client", ["web", "api"]],
  ]);
  assert.equal(routed.bellEligible, false);
});

test("suppresses an exact pinned pane and permits bell only when every client is eligible", () => {
  const fresh = observe(createAttentionDeliveryState([], 0), [session("api", "one")], 100).fresh;
  const pinned = routeAttentionDeliveries(fresh, [
    { name: "pin-client", tty: "/dev/1", session: "pi-agent-hub-dashboard", paneId: "%4", flags: [] },
    { name: "other", tty: "/dev/2", session: "shell", paneId: "%9", flags: [] },
  ], {
    dashboardSession: "pi-agent-hub-dashboard",
    dashboardPaneId: "%1",
    pins: [{ sessionId: "api", paneId: "%4" }],
  });
  assert.deepEqual(pinned.deliveries.map((delivery) => delivery.client.name), ["other"]);
  assert.equal(pinned.bellEligible, false);

  const eligible = routeAttentionDeliveries(fresh, [
    { name: "one", tty: "/dev/1", session: "shell", paneId: "%8", flags: [] },
    { name: "two", tty: "/dev/2", session: "other", paneId: "%9", flags: [] },
  ], { dashboardSession: "pi-agent-hub-dashboard", dashboardPaneId: "%1", pins: [] });
  assert.equal(eligible.deliveries.length, 2);
  assert.equal(eligible.bellEligible, true);
  assert.deepEqual(routeAttentionDeliveries(fresh, [], { dashboardSession: "pi-agent-hub-dashboard", pins: [] }), { deliveries: [], bellEligible: false });
});

test("attention without a request ID and stopped attention never announce", () => {
  const legacy = session("legacy");
  legacy.context = { version: 1, updatedAt: 1, attention: { kind: "ready", text: "Review" } };
  const result = observe(createAttentionDeliveryState([], 0), [legacy, session("stopped", "req", { status: "stopped" })], 100);
  assert.deepEqual(result.fresh, []);
  assert.deepEqual(result.active, []);
});
