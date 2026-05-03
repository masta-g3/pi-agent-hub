import test from "node:test";
import assert from "node:assert/strict";
import { applyComputedStatus, computeStatus, HEARTBEAT_STALE_MS, markAcknowledged } from "../src/core/status.js";
import type { ManagedSession, Heartbeat } from "../src/core/types.js";

const now = 1_000_000;

function session(overrides: Partial<ManagedSession> = {}): ManagedSession {
  return {
    id: "s1",
    title: "api",
    cwd: "/tmp/api",
    group: "default",
    tmuxSession: "pi-sessions-s1",
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

test("heartbeat running maps to running", () => {
  assert.equal(computeStatus({ session: session(), tmux: { exists: true }, heartbeat: heartbeat({ state: "running" }), now }).status, "running");
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
  assert.equal(result.note, "stale heartbeat");
});

test("missing heartbeat falls back to waiting while tmux is alive", () => {
  const result = computeStatus({ session: session({ status: "running" }), tmux: { exists: true }, now });
  assert.equal(result.status, "waiting");
  assert.equal(result.note, "missing heartbeat");
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

test("mark acknowledged turns waiting into idle", () => {
  assert.equal(markAcknowledged(session({ status: "waiting" }), now).status, "idle");
});
