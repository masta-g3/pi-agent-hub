import test from "node:test";
import assert from "node:assert/strict";
import { applySessionUndo, sessionUndo } from "../src/core/session-undo.js";
import type { ManagedSession } from "../src/core/types.js";

function session(id: string, overrides: Partial<ManagedSession> = {}): ManagedSession {
  return { id, title: id, cwd: `/tmp/${id}`, group: "default", tmuxSession: `pi-agent-hub-${id}`, status: "idle", createdAt: 1, updatedAt: 1, ...overrides };
}

test("lifecycle undo restores parent and subagent buckets and closure only", () => {
  const before = [
    session("parent", { piSessionId: "pi-1" }),
    session("child", { kind: "subagent", parentId: "parent" }),
    session("other"),
  ];
  const after = [
    { ...before[0]!, bucket: "archived" as const, bucketChangedAt: 50, closure: "done" as const, updatedAt: 50 },
    { ...before[1]!, bucket: "archived" as const, bucketChangedAt: 50, updatedAt: 50 },
    before[2]!,
  ];
  const undo = sessionUndo("lifecycle", { before, after }, "parent", "parent", "Archived · Done → parent")!;
  assert.deepEqual(undo.changes.map((change) => change.id), ["parent", "child"]);

  const current = after.map((row) => row.id === "parent" ? { ...row, title: "renamed", lastActivityAt: 70, status: "running" as const } : row);
  const restored = applySessionUndo(current, undo, 100);
  const parent = restored.find((row) => row.id === "parent")!;
  assert.equal("bucket" in parent, false);
  assert.equal("bucketChangedAt" in parent, false);
  assert.equal("closure" in parent, false);
  assert.equal(parent.title, "renamed");
  assert.equal(parent.lastActivityAt, 70);
  assert.equal(parent.status, "running");
  assert.equal(parent.updatedAt, 100);
  assert.equal("bucket" in restored.find((row) => row.id === "child")!, false);
  assert.equal(restored.find((row) => row.id === "other"), before[2]);
});

test("group undo restores order and child group", () => {
  const before = [session("parent", { group: "a", order: 2 }), session("child", { group: "a", kind: "subagent", parentId: "parent" })];
  const after = [{ ...before[0]!, group: "b", order: 0, updatedAt: 9 }, { ...before[1]!, group: "b", updatedAt: 9 }];
  const restored = applySessionUndo(after, sessionUndo("group", { before, after }, "parent", "parent", "Group b → parent")!, 10);
  assert.deepEqual(restored.map((row) => [row.group, row.order]), [["a", 2], ["a", undefined]]);
});

test("read undo restores missing acknowledgement, dismissal, and waiting status", () => {
  const before = [session("s", { status: "waiting", acknowledgedAt: 3 })];
  const after = [{ ...before[0]!, status: "idle" as const, acknowledgedAt: 20, dismissedRequestId: "req-1", updatedAt: 20 }];
  const restored = applySessionUndo(after, sessionUndo("read", { before, after }, "s", "s", "Marked read → s")!, 30)[0]!;
  assert.equal(restored.status, "waiting");
  assert.equal(restored.acknowledgedAt, 3);
  assert.equal("dismissedRequestId" in restored, false);
});

test("changes outside the recorded fields produce no undo", () => {
  const before = [session("s")];
  assert.equal(sessionUndo("lifecycle", { before, after: [{ ...before[0]!, title: "x", updatedAt: 5 }] }, "s", "s", "label"), undefined);
  assert.equal(sessionUndo("lifecycle", undefined, "s", "s", "label"), undefined);
});

test("undo refuses without changes when a field, row, or conversation changed", () => {
  const before = [session("s", { piSessionId: "pi-1" }), session("t", { kind: "subagent", parentId: "s" })];
  const after = before.map((row) => ({ ...row, bucket: "backlog" as const, bucketChangedAt: 5 }));
  const undo = sessionUndo("lifecycle", { before, after }, "s", "Checkout flow", "Backlog → Checkout flow")!;
  const refused = /Checkout flow changed since; nothing undone/;

  assert.throws(() => applySessionUndo(after.map((row) => row.id === "t" ? { ...row, bucket: "archived" as const } : row), undo, 9), refused);
  assert.throws(() => applySessionUndo(after.filter((row) => row.id !== "t"), undo, 9), refused);
  assert.throws(() => applySessionUndo(after.map((row) => row.id === "s" ? { ...row, piSessionId: "pi-2" } : row), undo, 9), refused);
  assert.throws(() => applySessionUndo(after.map((row) => row.id === "s" ? { ...row, piSessionId: undefined } : row), undo, 9), refused);
});
