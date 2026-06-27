import test from "node:test";
import assert from "node:assert/strict";
import { assignGroupOrder, nextOrderInGroup, orderedSessions } from "../src/core/session-order.js";
import type { ManagedSession } from "../src/core/types.js";

function session(id: string, group = "default", order?: number): ManagedSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group,
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...(order === undefined ? {} : { order }),
  };
}

test("orderedSessions preserves registry order for unordered rows and uses persisted order", () => {
  const sessions = [session("work", "work"), session("b"), session("a"), session("ordered", "default", -1)];
  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), ["ordered", "b", "a", "work"]);
});

test("duplicate persisted orders keep registry order", () => {
  const sessions = [session("b", "default", 0), session("a", "default", 0), session("c", "default", 1)];
  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), ["b", "a", "c"]);
});

test("nextOrderInGroup appends after unordered siblings", () => {
  assert.equal(nextOrderInGroup([session("a"), session("b"), session("c", "work", 4)], "default"), 2);
  assert.equal(nextOrderInGroup([session("a", "default", 2), session("b")], "default"), 3);
});

test("assignGroupOrder maps swapped display order back to registry rows", () => {
  const sessions = [session("a"), session("work", "work"), session("b"), session("c")];
  const next = assignGroupOrder(sessions, ["b", "a", "c"], "default");
  assert.deepEqual(next.map((item) => [item.id, item.order]), [["a", 1], ["work", undefined], ["b", 0], ["c", 2]]);
});

test("orderedSessions sorts by section before project groups", () => {
  const sessions = [
    session("archived", "default", 0),
    session("active-work", "work", 0),
    session("backlog", "default", 0),
    session("active-default", "default", 0),
  ];
  sessions[0]!.bucket = "archived";
  sessions[2]!.bucket = "backlog";

  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), ["active-default", "active-work", "backlog", "archived"]);
});

test("group order helpers are scoped by section", () => {
  const sessions = [
    session("active-a", "default", 0),
    session("backlog-a", "default", 0),
    session("backlog-b", "default", 1),
  ];
  sessions[1]!.bucket = "backlog";
  sessions[2]!.bucket = "backlog";

  assert.equal(nextOrderInGroup(sessions, "default", "active"), 1);
  assert.equal(nextOrderInGroup(sessions, "default", "backlog"), 2);

  const next = assignGroupOrder(sessions, ["backlog-b", "backlog-a"], "default", "backlog");
  assert.deepEqual(next.map((item) => [item.id, item.order]), [["active-a", 0], ["backlog-a", 1], ["backlog-b", 0]]);
});
