import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heartbeatPath } from "../src/core/paths.js";
import { applyComputedStatus, computeStatus, HEARTBEAT_STALE_MS, markAcknowledged, readHeartbeat } from "../src/core/status.js";
import type { ManagedSession, Heartbeat } from "../src/core/types.js";

const now = 1_000_000;

function session(overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-agent-hub-s1",
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function heartbeat(overrides: Partial<Heartbeat> = {}): Heartbeat {
  return {
    managedSessionId: "s1",
    cwd: "/tmp/api",
    state: "waiting",
    stateSince: now - 1_000,
    updatedAt: now,
    ...overrides,
  };
}

test("malformed heartbeat is treated as missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-heartbeat-"));
  const previous = process.env.PI_AGENT_HUB_DIR;
  process.env.PI_AGENT_HUB_DIR = root;
  try {
    const path = heartbeatPath("broken");
    await mkdir(join(root, "heartbeats"));
    await writeFile(path, "", "utf8");
    assert.equal(await readHeartbeat("broken"), undefined);
  } finally {
    if (previous === undefined) delete process.env.PI_AGENT_HUB_DIR;
    else process.env.PI_AGENT_HUB_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("status evidence covers every reducer branch", () => {
  const cases = [
    { name: "stopped tmux", input: { session: session({ status: "stopped" }), tmux: { exists: false }, now }, status: "stopped", reason: "tmux-stopped" },
    { name: "missing tmux", input: { session: session(), tmux: { exists: false }, now }, status: "error", reason: "tmux-missing" },
    { name: "unknown tmux", input: { session: session(), tmux: { exists: false, error: "tmux did not answer" }, now }, status: "error", reason: "tmux-unknown" },
    { name: "missing heartbeat active", input: { session: session(), tmux: { exists: true, recentActivityMs: 100 }, now }, status: "running", reason: "fallback-active" },
    { name: "missing heartbeat starting", input: { session: session({ status: "starting" }), tmux: { exists: true }, now }, status: "starting", reason: "fallback-starting" },
    { name: "missing heartbeat waiting", input: { session: session({ status: "running" }), tmux: { exists: true }, now }, status: "waiting", reason: "fallback-waiting" },
    { name: "missing heartbeat idle", input: { session: session({ status: "idle", acknowledgedAt: now - 1 }), tmux: { exists: true }, now }, status: "idle", reason: "fallback-idle" },
    { name: "heartbeat error", input: { session: session(), tmux: { exists: true }, heartbeat: heartbeat({ state: "error", message: "Pi failed" }), now }, status: "error", reason: "heartbeat-error" },
    { name: "heartbeat shutdown", input: { session: session(), tmux: { exists: true }, heartbeat: heartbeat({ state: "shutdown" }), now }, status: "stopped", reason: "heartbeat-shutdown" },
    { name: "heartbeat running", input: { session: session(), tmux: { exists: true }, heartbeat: heartbeat({ state: "running" }), now }, status: "running", reason: "heartbeat-active" },
    { name: "heartbeat unread", input: { session: session(), tmux: { exists: true }, heartbeat: heartbeat(), now }, status: "waiting", reason: "heartbeat-unread" },
    { name: "heartbeat read", input: { session: session({ acknowledgedAt: now }), tmux: { exists: true }, heartbeat: heartbeat(), now }, status: "idle", reason: "heartbeat-read" },
  ] as const;

  for (const item of cases) {
    const result = computeStatus(item.input);
    assert.equal(result.status, item.status, item.name);
    assert.equal(result.evidence.reason, item.reason, item.name);
    assert.equal(result.evidence.observedAt, now, item.name);
  }
});

test("heartbeat running maps to running", () => {
  const result = computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat({ state: "running" }), now });
  assert.equal(result.status, "running");
  assert.deepEqual(result.evidence.tmux, { state: "present" });
  assert.equal(result.evidence.heartbeat.freshness, "fresh");
});

test("heartbeat waiting with no acknowledgement maps to waiting", () => {
  assert.equal(computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat(), now }).status, "waiting");
});

test("heartbeat waiting after acknowledgement maps to idle", () => {
  const acknowledged = session({ acknowledgedAt: now });
  assert.equal(computeStatus({ session: acknowledged, tmux: { exists: true }, heartbeat: heartbeat({ stateSince: now - 1_000 }), now }).status, "idle");
});

test("periodic heartbeat updates liveness without changing acknowledgement semantics", () => {
  const acknowledged = session({ acknowledgedAt: now - 500 });
  const beat = heartbeat({ stateSince: now - 1_000, updatedAt: now });
  assert.equal(computeStatus({ session: acknowledged, tmux: { exists: true }, heartbeat: beat, now }).status, "idle");
});

test("missing tmux maps to error unless session is stopped", () => {
  assert.equal(computeStatus({ session: session(), tmux: { exists: false }, now }).status, "error");
  assert.equal(computeStatus({ session: session({ status: "stopped" }), tmux: { exists: false }, now }).status, "stopped");
});

test("stale heartbeat falls back to tmux activity", () => {
  const stale = heartbeat({ updatedAt: now - HEARTBEAT_STALE_MS - 1, state: "waiting" });
  const result = computeStatus({ session: session(), tmux: { exists: true, recentActivityMs: 100 }, heartbeat: stale, now });
  assert.equal(result.status, "running");
  assert.equal(result.evidence.reason, "fallback-active");
  assert.equal(result.evidence.heartbeat.freshness, "stale");
});

test("heartbeat freshness and acknowledgement boundaries are exact", () => {
  const fresh = computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat({ updatedAt: now - HEARTBEAT_STALE_MS }), now });
  const stale = computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat({ updatedAt: now - HEARTBEAT_STALE_MS - 1 }), now });
  const equalRead = computeStatus({ session: session({ acknowledgedAt: now - 1_000 }), tmux: { exists: true }, heartbeat: heartbeat({ stateSince: now - 1_000 }), now });
  const beforeUnread = computeStatus({ session: session({ acknowledgedAt: now - 1_001 }), tmux: { exists: true }, heartbeat: heartbeat({ stateSince: now - 1_000 }), now });

  assert.equal(fresh.evidence.heartbeat.freshness, "fresh");
  assert.equal(stale.evidence.heartbeat.freshness, "stale");
  assert.equal(equalRead.evidence.acknowledgement.state, "read");
  assert.equal(beforeUnread.evidence.acknowledgement.state, "unread");
});

test("missing heartbeat falls back to waiting while tmux is alive", () => {
  const result = computeStatus({ session: session({ status: "running" }), tmux: { exists: true }, now });
  assert.equal(result.status, "waiting");
  assert.equal(result.evidence.reason, "fallback-waiting");
  assert.equal(result.evidence.heartbeat.freshness, "missing");
});

test("workflow evidence stays independent from status", () => {
  const workflow = { steps: [{ id: "execute", short: "EX", label: "Execute" }], activeIndex: 0, updatedAt: now };
  const fresh = computeStatus({ session: session({ workflow }), tmux: { exists: true }, heartbeat: heartbeat({ workflow }), now });
  const retained = computeStatus({ session: session({ workflow }), tmux: { exists: true }, now });
  const absent = computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat(), now });

  assert.deepEqual(fresh.evidence.workflow, { source: "fresh", activeIndex: 0, stepCount: 1, stepLabel: "Execute" });
  assert.deepEqual(retained.evidence.workflow, { source: "retained", activeIndex: 0, stepCount: 1, stepLabel: "Execute" });
  assert.deepEqual(absent.evidence.workflow, { source: "absent" });
  assert.equal(fresh.status, absent.status);
});

test("apply computed status persists Pi session metadata from heartbeat", () => {
  const updated = applyComputedStatus(
    session(),
    { status: "waiting" },
    now,
    heartbeat({ piSessionFile: "/tmp/session.jsonl", piSessionId: "abc123" }),
  );
  assert.equal(updated.sessionFile, "/tmp/session.jsonl");
  assert.equal(updated.piSessionId, "abc123");
});

test("unchanged computed status keeps the existing row timestamp", () => {
  const existing = session({ status: "waiting", updatedAt: now });
  const updated = applyComputedStatus(existing, { status: "waiting" }, now);

  assert.equal(updated, existing);
});

test("transient compaction running heartbeat does not advance activity recency", () => {
  const existing = now - 500;
  const transient = applyComputedStatus(
    session({ lastActivityAt: existing }),
    { status: "running" },
    now,
    heartbeat({ state: "running", stateSince: now - 5_000 }),
  );
  assert.equal(transient.lastActivityAt, existing);
});

test("apply computed status preserves the latest heartbeat activity time", () => {
  const fresh = applyComputedStatus(session({ lastActivityAt: now - 2_000 }), { status: "waiting" }, now, heartbeat({ stateSince: now - 1_000 }));
  assert.equal(fresh.lastActivityAt, now - 1_000);

  const older = applyComputedStatus(session({ lastActivityAt: now - 500 }), { status: "waiting" }, now, heartbeat({ stateSince: now - 1_000 }));
  assert.equal(older.lastActivityAt, now - 500);
});

test("apply computed status keeps fresh active theme and drops stale theme", () => {
  const activeTheme = { name: "solarized-dark", sourcePath: "/themes/solarized-dark.json" };
  const fresh = applyComputedStatus(session(), { status: "waiting" }, now, heartbeat({ activeTheme }));
  const stale = applyComputedStatus(session(), { status: "waiting" }, now, heartbeat({ activeTheme, updatedAt: now - HEARTBEAT_STALE_MS - 1 }));

  assert.deepEqual(fresh.activeTheme, activeTheme);
  assert.equal(stale.activeTheme, undefined);
});

test("apply computed status retains base workflow without transient active mode", () => {
  const workflow = { steps: [{ id: "plan-md", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }], activeIndex: 1, currentStepComplete: true, ticketId: "auth-001", updatedAt: now };
  const runtimeWorkflow = {
    ...workflow,
    activeMode: { id: "focus", short: "FOC", label: "Focus", detail: "turn 4" },
  };
  const fresh = applyComputedStatus(session(), { status: "waiting" }, now, heartbeat({ workflow: runtimeWorkflow }));
  assert.deepEqual(fresh.workflow, workflow);

  const cleared = applyComputedStatus(session({ workflow }), { status: "waiting" }, now, heartbeat());
  assert.equal(cleared.workflow, undefined);

  const stale = applyComputedStatus(session({ workflow }), { status: "waiting" }, now, heartbeat({ workflow: runtimeWorkflow, updatedAt: now - HEARTBEAT_STALE_MS - 1 }));
  assert.deepEqual(stale.workflow, workflow);

  const shutdown = applyComputedStatus(session({ workflow }), { status: "stopped" }, now, heartbeat({ state: "shutdown", workflow: runtimeWorkflow }));
  assert.deepEqual(shutdown.workflow, workflow);

  const missing = applyComputedStatus(session({ workflow }), { status: "waiting" }, now);
  assert.deepEqual(missing.workflow, workflow);
});

test("apply computed status retains producer activity and plan while dropping transient mode", () => {
  const managed = session({ status: "waiting" });
  const runtime = {
    steps: [{ id: "build", short: "BLD" }], activeIndex: 0, updatedAt: 10,
    activeMode: { id: "focus", short: "FOC" },
    activity: { id: "review", label: "Reviewing implementation", pass: 2 },
    plan: { tasks: { completed: 2, total: 3 } },
  };
  const updated = applyComputedStatus(managed, { status: "waiting" }, now, heartbeat({ workflow: runtime }));
  assert.deepEqual(updated.workflow, {
    steps: [{ id: "build", short: "BLD" }], activeIndex: 0, updatedAt: 10,
    activity: { id: "review", label: "Reviewing implementation", pass: 2 },
    plan: { tasks: { completed: 2, total: 3 } },
  });
});

test("mark acknowledged turns waiting into idle", () => {
  assert.equal(markAcknowledged(session({ status: "waiting" }), now).status, "idle");
});

test("mark acknowledged does not touch an already idle row", () => {
  const existing = session({ status: "idle", acknowledgedAt: now - 1, updatedAt: now - 1 });
  assert.equal(markAcknowledged(existing, now), existing);
});
