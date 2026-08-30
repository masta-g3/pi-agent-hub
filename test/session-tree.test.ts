import test from "node:test";
import assert from "node:assert/strict";
import { createSessionTreeIndex, orderedSessionRows, sessionCascadeIds, sessionDepth } from "../src/core/session-tree.js";
import type { RuntimeSession } from "../src/core/types.js";

function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

test("sessionDepth preserves nested missing-parent and cycle behavior", () => {
  const root = session("root");
  const child = session("child", { kind: "subagent", parentId: "root" });
  const grandchild = session("grandchild", { kind: "subagent", parentId: "child" });
  const orphan = session("orphan", { kind: "subagent", parentId: "missing" });
  const partial = session("partial", { kind: "subagent", parentId: "orphan" });
  const self = session("self", { kind: "subagent", parentId: "self" });
  const cycleA = session("cycle-a", { kind: "subagent", parentId: "cycle-b" });
  const cycleB = session("cycle-b", { kind: "subagent", parentId: "cycle-a" });
  const rows = [root, child, grandchild, orphan, partial, self, cycleA, cycleB];

  assert.equal(sessionDepth(root, rows), 0);
  assert.equal(sessionDepth(child, rows), 1);
  assert.equal(sessionDepth(grandchild, rows), 2);
  assert.equal(sessionDepth(orphan, rows), 0);
  assert.equal(sessionDepth(partial, rows), 1);
  assert.equal(sessionDepth(self, rows), 1);
  assert.equal(sessionDepth(cycleA, rows), 2);
});

test("ordered session rows retain cyclic subagents as standalone fallbacks", () => {
  const cycleA = session("cycle-a", { kind: "subagent", parentId: "cycle-b" });
  const cycleB = session("cycle-b", { kind: "subagent", parentId: "cycle-a" });

  assert.deepEqual(orderedSessionRows([cycleA, cycleB]).map((row) => row.id), ["cycle-a", "cycle-b"]);
  assert.deepEqual(orderedSessionRows([cycleA, cycleB], "cycle-a").map((row) => row.id), ["cycle-a", "cycle-b"]);
});

test("sessionDepth parent lookup keeps last duplicate id precedence", () => {
  const root = session("root");
  const child = session("child", { kind: "subagent", parentId: "duplicate" });
  const duplicateMain = session("duplicate");
  const duplicateNested = session("duplicate", { kind: "subagent", parentId: "root" });

  assert.equal(sessionDepth(child, [root, child, duplicateMain, duplicateNested]), 2);
  assert.equal(sessionDepth(child, [root, child, duplicateNested, duplicateMain]), 1);
});

test("session tree index traces owner terminal missing links and cycles once per scope", () => {
  const root = session("root");
  const child = session("child", { kind: "subagent", parentId: "root" });
  const missing = session("missing-child", { kind: "subagent", parentId: "absent" });
  const self = session("self", { kind: "subagent", parentId: "self" });
  const cycleA = session("cycle-a", { kind: "subagent", parentId: "cycle-b" });
  const cycleB = session("cycle-b", { kind: "subagent", parentId: "cycle-a" });
  const entering = session("entering", { kind: "subagent", parentId: "cycle-a" });
  const tree = createSessionTreeIndex([root, child, missing, self, cycleA, cycleB, entering]);

  const childTrace = tree.trace(child);
  assert.equal(childTrace.owner?.id, "root");
  assert.equal(childTrace.terminal.id, "root");
  assert.deepEqual(childTrace.linkedParentIds, ["root"]);
  assert.deepEqual(childTrace.parents.map((row) => row.id), ["root"]);
  assert.equal(childTrace.missingParent, false);
  assert.equal(childTrace.cycle, false);
  assert.deepEqual(tree.trace(child), childTrace);

  const missingTrace = tree.trace(missing);
  assert.equal(missingTrace.owner, undefined);
  assert.equal(missingTrace.terminal.id, "missing-child");
  assert.deepEqual(missingTrace.linkedParentIds, ["absent"]);
  assert.deepEqual(missingTrace.parents, []);
  assert.equal(missingTrace.missingParent, true);

  const selfTrace = tree.trace(self);
  assert.equal(selfTrace.owner, undefined);
  assert.equal(selfTrace.terminal.id, "self");
  assert.deepEqual(selfTrace.linkedParentIds, ["self"]);
  assert.deepEqual(selfTrace.parents.map((row) => row.id), ["self"]);
  assert.equal(selfTrace.cycle, true);

  assert.equal(tree.trace(cycleA).terminal.id, "cycle-a");
  assert.equal(tree.trace(entering).terminal.id, "cycle-b");
  assert.equal(tree.trace(entering).owner, undefined);
});

test("session tree index keeps generic parent links after a main owner for descendant statistics", () => {
  const rows = [
    { id: "ancestor", kind: "main" as const },
    { id: "parent", kind: "main" as const, parentId: "ancestor" },
    { id: "child", kind: "subagent" as const, parentId: "parent" },
  ];
  const trace = createSessionTreeIndex(rows).trace(rows[2]!);

  assert.equal(trace.owner?.id, "parent");
  assert.deepEqual(trace.parents.map((row) => row.id), ["parent"]);
  assert.deepEqual(trace.linkedParentIds, ["parent", "ancestor"]);
});

test("session tree index keeps last duplicate id precedence and generic row support", () => {
  const rows = [
    { id: "child", kind: "subagent" as const, parentId: "duplicate" },
    { id: "duplicate", kind: "main" as const },
    { id: "root", kind: "main" as const },
    { id: "duplicate", kind: "subagent" as const, parentId: "root" },
  ];
  const tree = createSessionTreeIndex(rows);
  const trace = tree.trace(rows[0]!);

  assert.equal(tree.get("duplicate"), rows[3]);
  assert.equal(trace.owner?.id, "root");
  assert.deepEqual(trace.parents.map((row) => row.id), ["duplicate", "root"]);
});

test("sessionCascadeIds preserves generic parent links insertion and cycle membership", () => {
  const root = session("root");
  const mainChild = session("main-child", { parentId: "root" });
  const nested = session("nested", { kind: "subagent", parentId: "main-child" });
  const cycleA = session("cycle-a", { kind: "subagent", parentId: "cycle-b" });
  const cycleB = session("cycle-b", { kind: "subagent", parentId: "cycle-a" });
  const rows = [root, mainChild, nested, cycleA, cycleB];

  assert.deepEqual([...sessionCascadeIds(rows, "root")], ["root", "main-child", "nested"]);
  assert.deepEqual([...sessionCascadeIds(rows, "cycle-a")], ["cycle-a", "cycle-b"]);
});

test("sessionCascadeIds handles deep and missing-parent cascades", () => {
  const rows = [session("root")];
  for (let index = 1; index <= 100; index += 1) {
    rows.push(session(`child-${index}`, { parentId: index === 1 ? "root" : `child-${index - 1}` }));
  }
  rows.push(session("orphan", { parentId: "missing" }));

  assert.equal(sessionCascadeIds(rows, "root").size, 101);
  assert.deepEqual([...sessionCascadeIds(rows, "missing")], ["missing", "orphan"]);
});
