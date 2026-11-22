import test from "node:test";
import assert from "node:assert/strict";
import { buildInboxSnapshot, inboxDetail } from "../src/web/inbox.js";
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

test("a working session carries its live tool, its run's call count and when the run started", () => {
  const evidence = (state: "running" | "waiting") => ({ observedAt: NOW, reason: "heartbeat-active" as const, tmux: { state: "present" as const }, heartbeat: { freshness: "fresh" as const, state, stateSince: NOW - 120_000 },
    acknowledgement: { state: "not-applicable" as const }, workflow: { source: "absent" as const } });
  const rows = buildInboxSnapshot([
    session("tool", { status: "running", activity: { current: { tool: "bash", detail: "npm test", at: NOW }, calls: 14 }, statusEvidence: evidence("running") }),
    session("think", { status: "running", activity: { recent: [{ tool: "read", at: NOW }] } }),
    session("idle", { activity: { recent: [{ tool: "read", at: NOW }], calls: 3 }, statusEvidence: evidence("waiting") }),
  ], NOW).tiers.flatMap((tier) => tier.sessions);
  const byId = new Map(rows.map((row) => [row.id, row.work]));
  assert.deepEqual(byId.get("tool"), { tool: "bash npm test", calls: 14, since: NOW - 120_000 });
  assert.deepEqual(byId.get("think"), {});
  assert.equal(byId.get("idle"), undefined);
});

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

test("archived parents are listed apart from the tiers, newest first and capped", () => {
  const archived = Array.from({ length: 25 }, (_, index) => session(`arc${index}`, { bucket: "archived", bucketChangedAt: NOW - 5_000 - index * 1000 }));
  const snapshot = buildInboxSnapshot([...fleet(), ...archived], NOW);
  assert.equal(snapshot.tiers.flatMap((tier) => tier.sessions).some((row) => row.id.startsWith("arc") || row.id === "archived"), false);
  assert.equal(snapshot.archived.length, 20);
  assert.deepEqual(snapshot.archived.slice(0, 3).map((row) => row.id), ["archived", "arc0", "arc1"]);
});

test("a backlogged parent leaves the tiers for its own uncounted list, newest first", () => {
  const snapshot = buildInboxSnapshot([
    asking("parked", {}, { bucket: "backlog", bucketChangedAt: NOW - 5_000 }),
    session("later", { bucket: "backlog", bucketChangedAt: NOW - 1_000 }),
    session("child", { kind: "subagent", parentId: "later", status: "running" }),
    session("work", { status: "running" }),
  ], NOW);
  assert.deepEqual(snapshot.tiers.flatMap((tier) => tier.sessions).map((row) => row.id), ["work"]);
  assert.deepEqual(snapshot.backlog.map((row) => row.id), ["later", "parked"]);
  assert.equal(snapshot.requestCount, 0);
});

test("rows carry the step short, lens progress and an archived outcome", () => {
  const snapshot = buildInboxSnapshot([
    session("lens", { status: "running", workflow: { steps: [{ id: "execute", short: "exe" }], activeIndex: 0, updatedAt: 1, lens: { progress: { completed: 3, total: 8 } } } }),
    session("empty", { lens: { progress: { completed: 0, total: 0 } } }),
    session("done", { bucket: "archived", bucketChangedAt: NOW, closure: "done" }),
  ], NOW);
  const rows = new Map([...snapshot.tiers.flatMap((tier) => tier.sessions), ...snapshot.archived].map((row) => [row.id, row]));
  assert.equal(rows.get("lens")!.stepShort, "exe");
  assert.deepEqual(rows.get("lens")!.progress, { completed: 3, total: 8 });
  assert.equal(rows.get("empty")!.progress, undefined);
  assert.equal(rows.get("done")!.closure, "done");
});

test("the card carries the dashboard card's fields, bounded, windowed and without empty values", () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ state: index < 9 ? "done" as const : index === 9 ? "active" as const : "pending" as const, text: `task ${index}` }));
  const parent = session("card", {
    status: "running", cwd: "/src/hub",
    model: { provider: "anthropic", id: "claude-opus-4-5", thinking: "high" },
    context: { version: 1, updatedAt: 1, progress: { goal: "Ship the card", done: "Wrote tests", updatedAt: 1 } },
    activity: { current: { tool: "edit", detail: "web/app.js", at: NOW }, recent: [1, 2, 3, 4].map((n) => ({ tool: "read", detail: `f${n}`, at: NOW - n })) },
    workflow: { steps: [{ id: "execute", short: "exe" }], activeIndex: 0, updatedAt: 1,
      lens: { doing: `\x1b[1mWiring\x1b[0m <b>card</b> ${"z".repeat(400)}`, stages: [{ label: "build", state: "active" }], progress: { completed: 9, total: 20, unit: "tasks" }, pass: 2,
        list: { label: "Phase 2", head: "3 of 6", items, before: 4, after: 1 } } },
  });
  const kids = [1, 2, 3, 4].map((n) => session(`kid${n}`, { kind: "subagent", parentId: "card", status: "running", agentName: `scout${n}`, taskPreview: "map" }));
  const detail = inboxDetail([parent, ...kids], "card", NOW)!;
  const card = detail.card;
  assert.equal(card.section, "active");
  assert.equal(card.goal, "Ship the card");
  assert.equal(card.done, "Wrote tests");
  assert.equal(card.next, undefined);
  assert.equal(card.doing!.startsWith("Wiring <b>card</b> z"), true);
  assert.equal([...card.doing!].length, 240);
  assert.deepEqual(card.progress, { completed: 9, total: 20, unit: "tasks" });
  assert.equal(card.pass, 2);
  assert.equal(card.now, "edit web/app.js");
  assert.deepEqual(card.log.map((entry) => entry.text), ["read f1", "read f2", "read f3"]);
  assert.deepEqual(card.subagents.map((child) => child.name), ["scout1", "scout2", "scout3"]);
  assert.equal(card.model, "opus4.5 high");
  assert.equal(card.repo, "hub");
  assert.equal(card.list!.items.length, 12);
  assert.equal(card.list!.items[2]!.text, "task 9");
  assert.equal(card.list!.before, 4 + 7);
  assert.equal(card.list!.after, 1 + 1);
  assert.equal(inboxDetail([parent, ...kids], "kid1", NOW), undefined);
});

test("the card names no goal under ticket copy and no live tool for a stopped session", () => {
  const card = inboxDetail([session("s", { status: "stopped", context: { version: 1, updatedAt: 1, ticket: { id: "t-1", subtitle: "Sub" }, progress: { goal: "Goal", updatedAt: 1 } },
    activity: { current: { tool: "bash", at: NOW } } })], "s", NOW)!.card;
  assert.equal(card.goal, undefined);
  assert.equal(card.now, undefined);
  assert.equal(card.model, undefined);
});

test("detail opens a parent beyond the list caps", () => {
  const archived = Array.from({ length: 25 }, (_, index) => session(`a${index}`, { bucket: "archived", bucketChangedAt: NOW - index }));
  assert.equal(buildInboxSnapshot(archived, NOW).archived.some((row) => row.id === "a24"), false);
  assert.equal(inboxDetail(archived, "a24", NOW)!.card.section, "archived");
});
