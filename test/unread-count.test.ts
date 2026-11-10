import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions, type SessionsLayout } from "../src/tui/layout.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import { cockpitFleet, COCKPIT_NOW } from "./fixtures/cockpit.js";

const COLLAPSED = new Set(["health", "active", "quiet", "archived"] as const);

// Adds a waiting subagent under a quiet parent: it must never count.
function fleet(): RuntimeSession[] {
  const rows = cockpitFleet();
  const child = rows.find((row) => row.id === "child-error")!;
  return [...rows, { ...child, id: "child-waiting", title: "worker-waiting", agentName: "worker-waiting", status: "waiting", error: undefined }];
}

function render(input: Partial<BuildRenderModelInput> = {}, sessions = fleet()) {
  return renderSessions(buildRenderModel({ sessions, width: 120, height: 80, now: COCKPIT_NOW, guidanceHidden: true, collapsedSections: COLLAPSED, ...input }), darkTheme);
}

/** A tier heading's roster text, without the side pane beside it at 100+ columns. */
function header(layout: SessionsLayout, label: string): string | undefined {
  return layout.lines.map((line) => sliceByColumn(stripAnsi(line), 0, layout.listWidth)).find((line) => new RegExp(`^[ ▌][─▸]─ ${label} \\d+`).test(line));
}

test("collapsed ACTIVE and QUIET headers count hidden waiting parents only", () => {
  const layout = render();
  assert.match(header(layout, "ACTIVE")!, /◐ 1 unread$/);
  assert.match(header(layout, "QUIET")!, /◐ 1 unread$/);
  assert.ok(layout.lines.some((line) => line.includes(styleToken(darkTheme, "warning", "◐ 1 unread"))));
  for (const label of ["NEEDS YOU", "HEALTH", "ARCHIVED"]) assert.doesNotMatch(header(layout, label)!, /unread/, label);
  // The header meter draws ACTIVE owners as ◐ cells but never an unread count.
  assert.doesNotMatch(stripAnsi(layout.lines[0]!), /unread/);
});

test("the count disappears when rows are visible or nothing is unread", () => {
  assert.doesNotMatch(header(render({ collapsedSections: new Set() }), "QUIET")!, /unread/);
  assert.doesNotMatch(header(render({ filter: "Waiting" }), "QUIET")!, /unread/);

  const opened = fleet().map((row) => row.id === "waiting" || row.id === "dashboard" ? { ...row, status: "idle" as const, acknowledgedAt: COCKPIT_NOW } : row);
  const layout = render({}, opened);
  assert.doesNotMatch(header(layout, "QUIET")!, /unread/);
  assert.doesNotMatch(header(layout, "ACTIVE")!, /unread/);
});

test("an Archived reveal and filter-local folds still count hidden rows", () => {
  const revealed = render({ selectedId: "archive-old", revealedSessionId: "archive-old" });
  assert.match(header(revealed, "QUIET")!, /◐ 1 unread/);

  const filtered = render({
    filter: "wait",
    collapsedSections: new Set(["quiet"]),
    filterDisclosure: { sections: new Set(["quiet"]), repos: new Set(), projectTrees: new Set(), boardTrees: new Set() },
  });
  assert.match(header(filtered, "QUIET")!, /◐ 1 unread/);
});

test("Repo view and the board never show the unread count", () => {
  for (const input of [{ fleetGrouping: "repo" as const }, { grouping: "stage" as const }]) {
    assert.doesNotMatch(render(input).lines.map(stripAnsi).join("\n"), /unread/);
  }
});

test("narrow headers shorten the count before the tier title or child label is cut", () => {
  for (const width of [30, 34, 40, 50, 60, 80, 100, 120, 160]) {
    for (const extra of [{}, { pinSlots: ["mcp"] }]) {
      const layout = render({ width, ...extra });
      assert.ok(layout.lines.every((line) => visibleWidth(line) <= width), `width ${width}`);
      const line = header(layout, "QUIET");
      assert.ok(line, `QUIET header at ${width}`);
      assert.match(line, /▸─ QUIET 5 /, `title whole at ${width}`);
      assert.match(line, /\?1 child/, `child label kept at ${width}`);
      assert.match(line, width <= 34 ? /\?1 child · ◐1$/ : /\?1 child · ◐ 1 unread$/, `unread label at ${width}`);
    }
  }
});
