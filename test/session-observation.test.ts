import test from "node:test";
import assert from "node:assert/strict";
import { observeSessions } from "../src/app/session-observation.js";
import { createSessionRecord } from "../src/core/registry.js";

test("a stalled heartbeat does not block observation of other sessions", async () => {
  const first = createSessionRecord({ cwd: "/tmp/first" });
  const second = createSessionRecord({ cwd: "/tmp/second" });
  let aborted = false;
  const observations = await observeSessions([first, second], {
    presenceSnapshot: async () => new Map([
      [first.tmuxSession, { presence: "present" as const }],
      [second.tmuxSession, { presence: "present" as const }],
    ]),
    heartbeatTimeoutMs: 20,
    heartbeat: (id, signal) => id === first.id
      ? new Promise(() => { signal?.addEventListener("abort", () => { aborted = true; }); })
      : Promise.resolve(undefined),
  });
  assert.equal(aborted, true);
  assert.equal(observations.size, 2);
  assert.equal(observations.get(first.id)?.heartbeat, undefined);
  assert.equal(observations.get(second.id)?.presence, "present");
});

test("all heartbeat reads start before stalled reads time out and retain input order", async () => {
  const sessions = [createSessionRecord({ cwd: "/tmp/first" }), createSessionRecord({ cwd: "/tmp/second" })];
  const started: string[] = [];
  const startedAtTimeout: number[] = [];
  const observations = await observeSessions(sessions, {
    presenceSnapshot: async () => new Map(sessions.map((session) => [session.tmuxSession, { presence: "present" as const }])),
    heartbeatTimeoutMs: 20,
    heartbeat: (id, signal) => {
      started.push(id);
      signal?.addEventListener("abort", () => { startedAtTimeout.push(started.length); });
      return new Promise(() => {});
    },
  });
  assert.deepEqual(startedAtTimeout, [2, 2]);
  assert.deepEqual([...observations.keys()], sessions.map((session) => session.id));
});
