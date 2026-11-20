import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { stripAnsi } from "../src/tui/theme.js";
import { SIDEBAR_WIDTH } from "../src/app/side-pane.js";
import type { RuntimeSession } from "../src/core/types.js";

const NOW = 1_800_000_000_000;
function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return { id, title: `Session ${id}`, cwd: "/tmp/repo", group: "plaza", tmuxSession: `pi-agent-hub-${id}`, status: "idle", acknowledgedAt: NOW,
    createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW - 3 * 3_600_000, ...overrides };
}
const request = "PR #6 conflicts are resolved: master is merged in, all checks pass, GitHub shows it mergeable.";
const ready = session("ready", { title: "Business history", status: "waiting", acknowledgedAt: undefined,
  context: { version: 1, updatedAt: NOW, attention: { kind: "ready", requestId: "r", text: request, recommendation: "Stop the 3 jobs, then merge PR #6.", title: "PR #6 mergeable" } } });
const done = session("done", { title: "Long Way Page", group: "homepage",
  context: { version: 1, updatedAt: NOW, progress: { done: "Built a shared bare-instrument machine at /long-way with working wear, snapping, dead parts, and auto-growth.", updatedAt: NOW } } });
const pinned = session("pinned", { title: "Pinned elsewhere", group: "oro" });
const fleet = [ready, done];

/** One session's list rows, as plain text cut to the list width. */
function rows(input: Partial<BuildRenderModelInput>, id: string): string[] {
  const layout = renderSessions(buildRenderModel({ sessions: [...fleet, pinned], selectedId: "done", height: 50, now: NOW, guidanceHidden: true, width: 120, ...input }));
  return layout.lines.flatMap((line, index) => (layout.rowTargets[index] as { id?: string } | undefined)?.id === id
    ? [[...stripAnsi(line)].slice(0, layout.listWidth).join("").replace(/^▌/u, " ").trimEnd()] : []);
}

test("the list beside the card keeps the pinned sidebar's width at every window width", () => {
  for (const width of [100, 160, 290]) {
    const layout = renderSessions(buildRenderModel({ sessions: fleet, selectedId: "done", width, height: 30, now: NOW, guidanceHidden: true }));
    assert.equal(layout.listWidth, SIDEBAR_WIDTH, `${width}`);
    assert.ok(layout.pane && layout.pane.x === SIDEBAR_WIDTH + 2, `${width}`);
    assert.ok(layout.lines.every((line) => visibleWidth(line) <= width));
  }
  // Below 100 columns the list takes the full width and the card docks below it.
  assert.equal(renderSessions(buildRenderModel({ sessions: fleet, selectedId: "done", width: 90, height: 30, now: NOW })).listWidth, 90);
});

test("pinning keeps every list row: the same text in the same order as unpinned", () => {
  for (const id of ["ready", "done"]) {
    // A third session holds the pin, so the compared rows carry no slot marker.
    assert.deepEqual(rows({ pinSlots: ["pinned"], width: SIDEBAR_WIDTH }, id), rows({}, id), id);
  }
  const ready = rows({}, "ready");
  const text = ready.slice(1).join(" ").replace(/\s+/g, " ");
  assert.ok(text.includes(request) && text.includes("→ Stop the 3 jobs"), ready.join("\n"));
  assert.match(ready[0]!, /Business history {3}plaza +3h$/);
  assert.equal(rows({}, "done").length, 3, rows({}, "done").join("\n"));
});

test("short lists step every row down together, and on one line a request shows by its name", () => {
  const heights = (height: number, selectedId: string) => fleet.map((item) => rows({ height, selectedId }, item.id).length);
  const seen = new Map<string, number>();
  for (let height = 30; height >= 8; height -= 1) {
    const counts = heights(height, "done");
    assert.deepEqual(heights(height, "ready"), counts, `selection changes heights at ${height}`);
    seen.set(counts.join(","), height);
  }
  assert.ok(seen.has("3,2") && seen.has("2,2"), [...seen.keys()].join(" | "));
  const line = rows({ height: seen.get("2,2")! }, "ready");
  assert.match(line[1]!, /RDY {4}PR #6 mergeable/);
});
