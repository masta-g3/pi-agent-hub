import test from "node:test";
import assert from "node:assert/strict";
import { forkPreparationMessage, isForkPreparationPending, parseForkPreparation, reconcileForkPreparation } from "../src/core/fork-preparation.js";
import type { Heartbeat, ManagedSession } from "../src/core/types.js";

const session = (forkPreparation: ManagedSession["forkPreparation"]): ManagedSession => ({
  id: "child", title: "repo", cwd: "/repo", group: "default", tmuxSession: "child-tmux",
  status: "starting", createdAt: 1, updatedAt: 1, forkPreparation,
});
const heartbeat = (forkPreparation?: Heartbeat["forkPreparation"], state: Heartbeat["state"] = "running"): Heartbeat => ({
  managedSessionId: "child", cwd: "/repo", state, stateSince: 10, updatedAt: 10, forkPreparation,
});

test("preparation parser accepts bounded control state and drops malformed optional fields", () => {
  assert.deepEqual(parseForkPreparation({ id: " attempt ", phase: "error", launchConfirmed: true, launchDeadline: 50, outcome: "compacted", error: " failed ", extra: true }), {
    id: "attempt", phase: "error", launchConfirmed: true, launchDeadline: 50, outcome: "compacted", error: "failed",
  });
  assert.equal(parseForkPreparation({ id: "x".repeat(81), phase: "preparing" }), undefined);
  assert.equal(parseForkPreparation({ id: "attempt", phase: "ready" }), undefined, "ready requires a verified outcome");
  assert.deepEqual(parseForkPreparation({ id: "a", phase: "preparing", error: "x".repeat(501), launchDeadline: -1 }), { id: "a", phase: "preparing" });
});

test("preparation helpers expose the shared access gate and message", () => {
  assert.equal(isForkPreparationPending({ id: "a", phase: "preparing" }), true);
  assert.equal(isForkPreparationPending({ id: "a", phase: "compacting" }), true);
  assert.equal(isForkPreparationPending({ id: "a", phase: "error" }), false);
  assert.equal(forkPreparationMessage({ id: "a", phase: "preparing" }), "Preparing fork");
  assert.equal(forkPreparationMessage({ id: "a", phase: "compacting" }), "Compacting");
  assert.equal(forkPreparationMessage({ id: "a", phase: "error", error: "Provider failed" }), "Provider failed");
  assert.equal(forkPreparationMessage({ id: "a", phase: "ready" }), undefined);
});

test("reconciliation is exact-attempt and terminal-monotonic", () => {
  const preparing = session({ id: "new", phase: "preparing", launchDeadline: 100 });
  assert.deepEqual(reconcileForkPreparation(preparing, heartbeat({ id: "old", phase: "ready" }), "present", 10), preparing.forkPreparation);
  assert.deepEqual(reconcileForkPreparation(preparing, heartbeat({ id: "old", phase: "error" }, "shutdown"), "missing", 10), preparing.forkPreparation,
    "an old process shutdown must not fail the newly claimed retry before its launch");
  assert.deepEqual(reconcileForkPreparation(preparing, heartbeat({ id: "new", phase: "compacting" }), "present", 10), {
    id: "new", phase: "compacting", launchConfirmed: true, launchDeadline: 100,
  });
  const ready = session({ id: "new", phase: "ready", launchConfirmed: true, outcome: "compacted" });
  assert.deepEqual(reconcileForkPreparation(ready, heartbeat({ id: "new", phase: "preparing" }), "present", 20), ready.forkPreparation);
  const failed = session({ id: "new", phase: "error", error: "reset failed" });
  assert.deepEqual(reconcileForkPreparation(failed, heartbeat({ id: "new", phase: "ready" }), "present", 20), failed.forkPreparation);
});

test("unconfirmed missing tmux stays pending until its launch deadline", () => {
  const pending = session({ id: "a", phase: "preparing", launchDeadline: 100 });
  assert.equal(reconcileForkPreparation(pending, undefined, "missing", 100)?.phase, "preparing");
  const stopped = { ...pending, status: "stopped" as const };
  assert.equal(reconcileForkPreparation(stopped, undefined, "missing", 10)?.phase, "error");
  assert.equal(reconcileForkPreparation(stopped, heartbeat({ id: "a", phase: "ready", outcome: "compacted" }), "missing", 10)?.phase, "ready");
  assert.deepEqual(reconcileForkPreparation(pending, undefined, "missing", 101), {
    id: "a", phase: "error", launchDeadline: 100, error: "Fork launch was not confirmed",
  });
  const confirmed = session({ id: "a", phase: "compacting", launchConfirmed: true });
  assert.equal(reconcileForkPreparation(confirmed, undefined, "unknown", 200)?.phase, "compacting");
  assert.equal(reconcileForkPreparation(confirmed, undefined, "missing", 200)?.phase, "error");
});
