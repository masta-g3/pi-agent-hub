import test from "node:test";
import assert from "node:assert/strict";
import { assignGroupOrder, nextOrderInGroup, orderedSessions } from "../src/core/session-order.js";
import type { ManagedSession } from "../src/core/types.js";

function session(id: string, group = "default", order?: number, status: ManagedSession["status"] = "idle", lastActivityAt?: number): ManagedSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group,
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
    ...(order === undefined ? {} : { order }),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
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

test("errors and unacknowledged waiting rows stay on top, then rows sort by last interaction", () => {
  const sessions = [
    session("idle", "default", 0, "idle", 500),
    session("running", "default", 1, "running", 400),
    { ...session("acknowledged-waiting", "default", 2, "waiting", 300), acknowledgedAt: 50 },
    session("unread-old", "default", 3, "waiting", 100),
    session("unread-new", "default", 4, "waiting", 200),
    session("error", "default", 5, "error"),
    session("stopped-recent", "default", 6, "stopped", 450),
    session("stopped-never", "default", 7, "stopped"),
  ];

  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), [
    "error", "unread-new", "unread-old", "idle", "stopped-recent", "running", "acknowledged-waiting", "stopped-never",
  ]);
});

test("rows without activity keep persisted order after rows with activity", () => {
  const sessions = [session("b", "default", 1, "running"), session("a", "default", 0, "running"), session("late", "default", 2, "stopped", 10)];
  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), ["late", "a", "b"]);
});

test("attention and recency take precedence over group names", () => {
  const sessions = [
    session("z-running", "z", 0, "running"),
    session("a-waiting", "a", 0, "waiting", 300),
    session("default-idle", "default", 0, "idle", 100),
  ];
  assert.deepEqual(orderedSessions(sessions).map((item) => item.group), ["a", "default", "z"]);

  const changed = sessions.map((item) => item.id === "z-running" ? { ...item, status: "error" as const } : item);
  assert.deepEqual(orderedSessions(changed).map((item) => item.group), ["z", "a", "default"]);
});

test("active and backlog groups mix waiting and idle sessions by recent activity", () => {
  const sessions = [
    session("idle-recent", "default", 0, "idle", 300),
    session("running", "default", 1, "running"),
    session("waiting", "default", 2, "waiting", 200),
    session("error", "default", 3, "error"),
    session("starting", "default", 4, "starting"),
    session("stopped", "default", 5, "stopped"),
    { ...session("backlog-idle", "default", 0, "idle", 100), bucket: "backlog" as const },
    { ...session("backlog-waiting", "default", 1, "waiting", 200), bucket: "backlog" as const },
  ];

  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), [
    "error", "waiting", "idle-recent", "running", "starting", "stopped", "backlog-waiting", "backlog-idle",
  ]);
});

test("recency orders rows across group names", () => {
  const sessions = [
    session("default-idle", "default", 0, "idle", 100),
    session("work-idle", "work", 0, "idle", 200),
    session("work-waiting", "work", 1, "waiting", 300),
    session("z-waiting", "z", 0, "waiting", 400),
    session("z-idle", "z", 1, "idle", 50),
  ];

  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), ["z-waiting", "work-waiting", "work-idle", "default-idle", "z-idle"]);
});

test("nextOrderInGroup appends after unordered siblings", () => {
  assert.equal(nextOrderInGroup([session("a"), session("b"), session("c", "work", 4)], "default"), 2);
  assert.equal(nextOrderInGroup([session("a", "default", 2), session("b")], "default"), 3);
});

test("assignGroupOrder maps swapped display order back to registry rows", () => {
  const sessions = [session("a"), session("work", "work"), session("b"), session("c")];
  const next = assignGroupOrder(sessions, ["b", "a", "c"], "default", "active", 1);
  assert.deepEqual(next.map((item) => [item.id, item.order]), [["a", 1], ["work", undefined], ["b", 0], ["c", 2]]);
  assert.deepEqual(next.map((item) => [item.id, item.updatedAt]), [["a", 2], ["work", 1], ["b", 2], ["c", 2]]);
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

test("archived sessions sort newest-first globally while other sections keep group order", () => {
  const sessions = [
    { ...session("archive-old", "default", 0), bucket: "archived" as const, bucketChangedAt: 100 },
    { ...session("backlog-work", "work", 0), bucket: "backlog" as const },
    { ...session("archive-new", "work", 0), bucket: "archived" as const, bucketChangedAt: 300 },
    { ...session("active-work", "work", 0) },
    { ...session("archive-tied-a", "z", 0), bucket: "archived" as const, bucketChangedAt: 200 },
    { ...session("active-default", "default", 0) },
    { ...session("archive-tied-b", "default", 1), bucket: "archived" as const, bucketChangedAt: 200 },
    { ...session("archive-undated", "default", -1), bucket: "archived" as const },
    { ...session("backlog-default", "default", 0), bucket: "backlog" as const },
  ];

  assert.deepEqual(orderedSessions(sessions).map((item) => item.id), [
    "active-default", "active-work",
    "backlog-default", "backlog-work",
    "archive-new", "archive-tied-a", "archive-tied-b", "archive-old", "archive-undated",
  ]);
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
