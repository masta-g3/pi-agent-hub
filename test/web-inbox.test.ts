import test from "node:test";
import assert from "node:assert/strict";
import { buildInboxSnapshot } from "../src/web/inbox.js";
import { buildDashboardProjection } from "../src/tui/render-model.js";
import type { RuntimeSession, SessionAttention } from "../src/core/types.js";

const NOW = 10_000_000;

function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id,
    title: id.toUpperCase(),
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    acknowledgedAt: 5,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function asking(id: string, attention: Partial<SessionAttention> = {}, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return session(id, {
    status: "waiting",
    acknowledgedAt: undefined,
    piSessionId: `pi-${id}`,
    interaction: { version: 1, instanceId: `inst-${id}` },
    context: { version: 1, updatedAt: 10, attention: { requestId: `req-${id}`, kind: "question", text: `Question from ${id}?`, ...attention } },
    ...overrides,
  });
}

function fleet(): RuntimeSession[] {
  return [
    session("quiet", { lastActivityAt: NOW - 3 * 3_600_000 }),
    session("running", { status: "running", lastActivityAt: NOW - 5_000, activity: { current: { tool: "bash", detail: "npm run typecheck", at: NOW } },
      workflow: { steps: [{ id: "plan-md", short: "PL", label: "Plan" }, { id: "execute", short: "EX" }], activeIndex: 1, updatedAt: 1 } }),
    session("child", { kind: "subagent", parentId: "running", status: "running", agentName: "scout" }),
    session("broken", { status: "error", error: "tmux session is missing" }),
    asking("ask", {}, { lastActivityAt: NOW - 4 * 60_000, group: "ui" }),
    asking("handoff", { kind: "ready", text: "Plan ready", recommendation: "Run execute", artifact: "/tmp/plan.md" }),
    session("archived", { bucket: "archived", bucketChangedAt: NOW - 1000 }),
  ];
}

test("tiers and order follow the dashboard projection, with parents only and no archive", () => {
  const sessions = fleet();
  const snapshot = buildInboxSnapshot(sessions, NOW);
  const projection = buildDashboardProjection({ sessions });
  const expected = projection.visible
    .filter((row) => projection.cockpitOwnerById.get(row.id) === row.id && projection.cockpitTierById.get(row.id) !== "archived")
    .map((row) => `${projection.cockpitTierById.get(row.id)}:${row.id}`);
  const actual = snapshot.tiers.flatMap((tier) => tier.sessions.map((row) => `${tier.tier}:${row.id}`));
  assert.deepEqual(actual, expected);
  assert.deepEqual(snapshot.tiers.map((tier) => tier.tier), ["needs-you", "health", "active", "quiet"]);
  assert.equal(actual.some((entry) => entry.endsWith(":child") || entry.endsWith(":archived")), false);
  assert.equal(snapshot.requestCount, 2);
  assert.equal(snapshot.now, NOW);
});

test("rows carry the exact write target, request, step, status line and subagent count", () => {
  const rows = new Map(buildInboxSnapshot(fleet(), NOW).tiers.flatMap((tier) => tier.sessions).map((row) => [row.id, row]));
  const ask = rows.get("ask")!;
  assert.deepEqual({ piSessionId: ask.piSessionId, instanceId: ask.instanceId, canInteract: ask.canInteract }, { piSessionId: "pi-ask", instanceId: "inst-ask", canInteract: true });
  assert.deepEqual(ask.attention, { requestId: "req-ask", kind: "question", text: "Question from ask?" });
  assert.equal(ask.age, "4m");
  assert.equal(ask.group, "ui");
  assert.deepEqual(rows.get("handoff")!.attention, { requestId: "req-handoff", kind: "ready", text: "Plan ready", recommendation: "Run execute", artifact: "/tmp/plan.md" });
  const running = rows.get("running")!;
  assert.equal(running.step, "execute");
  assert.deepEqual(running.steps, [{ short: "PL", state: "done" }, { short: "EX", state: "active" }]);
  assert.equal(running.statusLine, "bash npm run typecheck");
  assert.equal(running.runningSubagents, 1);
  assert.equal(running.canInteract, false);
  assert.equal(rows.get("broken")!.statusLine, "tmux session is missing");
});

test("a dismissed request is not shown and a stopped row cannot be written to", () => {
  const dismissed = asking("ask", {}, { status: "idle", acknowledgedAt: 20, dismissedRequestId: "req-ask" });
  const stopped = session("stopped", { status: "stopped", piSessionId: "pi", interaction: { version: 1, instanceId: "inst" } });
  const snapshot = buildInboxSnapshot([dismissed, stopped], NOW);
  const rows = snapshot.tiers.flatMap((tier) => tier.sessions);
  assert.equal(rows.find((row) => row.id === "ask")!.attention, undefined);
  assert.equal(rows.find((row) => row.id === "stopped")!.canInteract, false);
  assert.equal(snapshot.requestCount, 0);
});

test("a subagent request is counted on its owner, not listed", () => {
  const parent = session("parent", { status: "running" });
  const child = asking("kid", {}, { kind: "subagent", parentId: "parent" });
  const rows = buildInboxSnapshot([parent, child], NOW).tiers.flatMap((tier) => tier.sessions);
  assert.deepEqual(rows.map((row) => row.id), ["parent"]);
  assert.equal(rows[0]!.hiddenChildRequests, 1);
});

test("a subagent whose parent is gone is not listed and sends no request", () => {
  const orphan = asking("orphan", {}, { kind: "subagent", parentId: "missing" });
  const snapshot = buildInboxSnapshot([orphan, session("parent")], NOW);
  assert.deepEqual(snapshot.tiers.flatMap((tier) => tier.sessions).map((row) => row.id), ["parent"]);
  assert.equal(snapshot.requestCount, 0);
});

test("producer text is stripped of control sequences and bounded", () => {
  const row = buildInboxSnapshot([asking("ask", { text: `\x1b[31mred\x1b[0m\x07 ${"x".repeat(5000)}` }, { title: `T\x1b]0;evil\x07itle ${"y".repeat(500)}` })], NOW)
    .tiers[0]!.sessions[0]!;
  assert.equal(row.attention!.text.startsWith("red x"), true);
  assert.equal([...row.attention!.text].length, 2000);
  assert.equal(row.title.startsWith("Title y"), true);
  assert.equal([...row.title].length, 120);
});
