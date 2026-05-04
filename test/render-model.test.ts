import test from "node:test";
import assert from "node:assert/strict";
import { buildRenderModel, retainSelectionAfterRefresh } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import type { ManagedSession, SessionStatus } from "../src/core/types.js";

function session(id: string, group: string, status: SessionStatus, title = id): ManagedSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group,
    tmuxSession: `pi-sessions-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

test("empty state rendering includes first-run prompts", () => {
  const lines = renderSessions(buildRenderModel({ sessions: [], width: 64 }));
  assert.match(lines.join("\n"), /No managed Pi sessions yet/);
  assert.match(lines.join("\n"), /▶ n  create a session/);
  assert.match(lines.join("\n"), /  q  quit/);
});

test("grouping order and status counts", () => {
  const model = buildRenderModel({
    sessions: [session("b", "work", "idle"), session("a", "default", "waiting"), session("e", "default", "error")],
    width: 120,
  });
  assert.deepEqual(model.groups.map((group) => group.name), ["default", "work"]);
  assert.equal(model.groups[0]?.waitingCount, 1);
  assert.equal(model.groups[0]?.errorCount, 1);
  assert.match(renderSessions(model).join("\n"), /1 waiting · 1 error/);
});

test("narrow layout hides preview and uses compact footer", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 70 });
  assert.equal(model.showPreview, false);
  assert.match(model.footer, /help/);
  assert.doesNotMatch(model.footer, /skills/);
});

test("long titles/cwd truncate without exceeding width", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "a".repeat(100))], width: 60 });
  for (const line of renderSessions(model)) assert.ok([...line].length <= 60, line);
});

test("error reason appears in selected metadata", () => {
  const broken = { ...session("a", "default", "error", "api"), error: "MCP failed" };
  const lines = renderSessions(buildRenderModel({ sessions: [broken], selectedId: "a", width: 120 }));
  assert.match(lines.join("\n"), /error\s+MCP failed/);
});

test("selected and stopped rows have distinct treatments", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api"), session("b", "default", "stopped", "docs")], selectedId: "a", width: 100 });
  const lines = renderSessions(model).join("\n");
  assert.match(lines, /▶ ○ api/);
  assert.match(lines, /· - docs/);
});

test("preview renders captured tmux output with empty state", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview: "one\ntwo" });
  const lines = renderSessions(model).join("\n");
  assert.match(lines, /one/);
  assert.match(lines, /two/);
  assert.doesNotMatch(lines, /preview loads from tmux/);

  const empty = renderSessions(buildRenderModel({ sessions: [session("a", "default", "idle", "api")], selectedId: "a", width: 120, preview: "" })).join("\n");
  assert.match(empty, /preview empty/);
});

test("filter matches across title group cwd basename and status", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api"), session("b", "work", "waiting", "docs")], width: 100, filter: "wait" });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0]?.live[0]?.id, "b");
});

test("filter with zero matches renders no-match state", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], width: 100, filter: "zzz" });
  assert.equal(model.noMatches, true);
  const rendered = renderSessions(model).join("\n");
  assert.match(rendered, /No sessions match/);
  assert.match(rendered, /▶ Use the footer controls below/);
});

test("starting displays as running", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "starting")], width: 100 });
  assert.equal(model.selected?.displayStatus, "running");
});

test("selection retention chooses next sibling without jumping groups", () => {
  const previous = [session("a", "default", "idle"), session("b", "default", "idle"), session("c", "work", "idle")];
  const next = [session("a", "default", "idle"), session("c", "work", "idle")];
  assert.equal(retainSelectionAfterRefresh(previous, next, "b"), "a");
});
