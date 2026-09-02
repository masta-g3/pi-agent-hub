import test from "node:test";
import assert from "node:assert/strict";
import { parseDashboardFilter, serializeDashboardFilter, matchesDashboardFilter, type DashboardFilter } from "../src/core/dashboard-filter.js";
import { createSessionTreeIndex, orderedSessionRows } from "../src/core/session-tree.js";
import type { RuntimeSession } from "../src/core/types.js";

function session(id: string, bucket?: "backlog" | "archived", parentId?: string): RuntimeSession {
  return {
    id,
    title: id,
    cwd: `/tmp/${id}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    ...(bucket ? { bucket } : {}),
    ...(parentId ? { parentId, kind: "subagent" as const } : {}),
  };
}

const all = new Set(["active", "backlog", "archived"] as const);

test("dashboard filter defaults to all lifecycle values and preserves ordinary text", () => {
  assert.deepEqual(parseDashboardFilter(undefined), { lifecycle: all });
  assert.deepEqual(parseDashboardFilter("release"), { lifecycle: all, text: "release" });
  assert.equal(serializeDashboardFilter(parseDashboardFilter("release")), "release");
});

test("dashboard filter parses lifecycle OR sets canonically", () => {
  const filter = parseDashboardFilter("lifecycle:archived,backlog release");
  assert.deepEqual(filter, { lifecycle: new Set(["backlog", "archived"]), text: "release" });
  assert.equal(serializeDashboardFilter(filter), "lifecycle:backlog,archived release");
});

test("unknown lifecycle values do not hide valid text and an empty clause is explicit", () => {
  assert.deepEqual(parseDashboardFilter("lifecycle:future release"), { lifecycle: all, text: "release" });
  assert.deepEqual(parseDashboardFilter("lifecycle:"), { lifecycle: new Set() });
  assert.equal(serializeDashboardFilter({ lifecycle: new Set() }), "lifecycle:");
});

test("ordered session rows apply lifecycle OR matching before tree context", () => {
  const active = session("active");
  const backlog = session("backlog", "backlog");
  const archived = session("archived", "archived");
  assert.deepEqual(orderedSessionRows([active, backlog, archived], "lifecycle:archived,backlog").map((row) => row.id), ["backlog", "archived"]);
});

test("lifecycle matching uses the owner lifecycle for descendants", () => {
  const owner = session("owner", "backlog");
  const child = session("child", undefined, owner.id);
  const tree = createSessionTreeIndex([owner, child]);
  const backlog: DashboardFilter = { lifecycle: new Set(["backlog"]) };
  const archived: DashboardFilter = { lifecycle: new Set(["archived"]) };
  assert.equal(matchesDashboardFilter(owner, backlog, tree), true);
  assert.equal(matchesDashboardFilter(child, backlog, tree), true);
  assert.equal(matchesDashboardFilter(child, archived, tree), false);
});
