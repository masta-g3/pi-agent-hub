import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions, type SessionsLayout } from "../src/tui/layout.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";

const workflow = {
  version: 1 as const, source: "test", activeIndex: 1, updatedAt: 1,
  steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }],
};
const sessions: RuntimeSession[] = [0, 1].map((index) => ({
  id: `s${index}`, title: index ? "Sidebar readability" : "Subagent efficiency",
  cwd: "/tmp/repo", group: "pi-tmux-subagents", tmuxSession: `pi-agent-hub-s${index}`,
  status: "running", createdAt: 1, updatedAt: 1,
  workflow: { ...workflow, activeIndex: index + 1 },
}));

/** The roster's and the side pane's text on one screen row (100+ columns); the pane is empty below that. */
function columns(layout: SessionsLayout, row: number): { roster: string; pane: string } {
  const line = stripAnsi(layout.lines[row] ?? "");
  return { roster: sliceByColumn(line, 0, layout.listWidth), pane: sliceByColumn(line, layout.listWidth + 1, visibleWidth(line)) };
}
function paneText(layout: SessionsLayout): string {
  return layout.lines.map((_line, row) => columns(layout, row).pane).join("\n");
}
function titleRow(layout: SessionsLayout, id: string): number {
  return layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id);
}

for (const width of [40, 50, 60, 100, 120, 160, 220]) {
  test(`compact fleet titles and workflow columns at ${width} columns`, () => {
    const pinSlots = width <= 60 ? ["s0"] : undefined;
    const rendered = renderSessions(buildRenderModel({ sessions, selectedId: "s0", width, height: 35, pinSlots, ...(!pinSlots ? { selectedSection: "active" as const } : {}) }), darkTheme);
    const lines = rendered.lines.map(stripAnsi);
    if (!pinSlots) {
      // Fleet modules end their title row with their own step short; no shared header grid, no STEP readout.
      assert.ok(!lines.some((line) => /PL\s+EX\s+RV/.test(line)), lines.join("\n"));
      assert.ok(!lines.some((line) => line.includes("STEP")));
      for (const session of sessions) {
        const titleIndex = titleRow(rendered, session.id);
        const roster = columns(rendered, titleIndex).roster;
        assert.ok(roster.includes(session.title), roster);
        assert.ok(roster.trimEnd().endsWith(workflow.steps[session.workflow!.activeIndex]!.short), roster);
      }
      assert.ok(rendered.lines.every((line) => visibleWidth(line) <= width));
      assert.equal(rendered.lines.length, 35);
      return;
    }
    const header = lines.find((line) => /PL\s+EX\s+RV/.test(line));
    assert.ok(header, "one producer-owned shared header");
    assert.equal(lines.filter((line) => /PL\s+EX\s+RV/.test(line)).length, 1);
    const positions = ["PL", "EX", "RV"].map((short) => header.indexOf(short));
    for (const session of sessions) {
      const titleIndex = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === session.id);
      assert.ok(titleIndex >= 0);
      assert.ok(lines[titleIndex].includes(session.title), lines[titleIndex]);
      assert.ok(!lines[titleIndex].includes("[pi-"));
      // Pin rows keep the grid on their metadata line.
      const markers: string = lines[titleIndex + 1]!;
      assert.deepEqual(rendered.rowTargets[titleIndex + 1], { kind: "session-continuation", id: session.id });
      assert.equal(markers[positions[session.workflow!.activeIndex]], "◉", markers);
    }
    assert.ok(rendered.lines.every((line) => visibleWidth(line) <= width));
    assert.equal(rendered.lines.length, 35);
  });
}

test("five-step pinned grids leave titles readable and fit beside group metadata", () => {
  const steps = [...workflow.steps, { id: "reflect", short: "RF", label: "Reflect" }, { id: "commit", short: "CM", label: "Commit" }];
  for (const width of [40, 50, 60]) {
    const rendered = renderSessions(buildRenderModel({ sessions: sessions.map((session) => ({ ...session, workflow: { ...workflow, steps } })), width, height: 30, pinSlots: ["s0"], selectedId: "s0" }));
    const lines = rendered.lines.map(stripAnsi);
    const header = lines.find((line) => /PL\s+EX\s+RV\s+RF\s+CM/.test(line));
    assert.ok(header);
    const title = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s0");
    assert.ok(lines[title].includes("Subagent efficiency"));
    assert.equal(lines[title + 1][header.indexOf("EX")], "◉");
    assert.match(lines[title + 1], /\[[^\]]+\]/);
    assert.ok(rendered.lines.every((line) => visibleWidth(line) <= width));
  }
});

test("completed steps stay checked on the module's title row and in the card's STEP field", () => {
  for (const activeIndex of [0, 1, 2]) {
    const complete = { ...sessions[0], status: "stopped" as const, workflow: { ...workflow, activeIndex, currentStepComplete: true } };
    const unselected = renderSessions(buildRenderModel({ sessions: [complete], selectedSection: "quiet", width: 100 }));
    const roster = columns(unselected, titleRow(unselected, "s0")).roster.trimEnd();
    assert.ok(roster.endsWith(`${workflow.steps[activeIndex]!.short}✓`), roster);
    const selected = renderSessions(buildRenderModel({ sessions: [complete], selectedId: "s0", width: 100 }));
    const markers = workflow.steps.map((item, index) => `${item.short}${index <= activeIndex ? "✓" : "·"}`).join(" ");
    assert.ok(paneText(selected).includes(markers), paneText(selected));
  }
});

test("different pipelines show explicit step labels rather than misleading grid positions", () => {
  const other = { ...sessions[1], workflow: { ...workflow, steps: [{ id: "ship", short: "SHIP", label: "Ship" }], activeIndex: 0 } };
  const rendered = renderSessions(buildRenderModel({ sessions: [sessions[0], other], selectedSection: "active", width: 100 }));
  const lines = rendered.lines.map(stripAnsi);
  assert.ok(!lines.some((line) => /PL\s+EX\s+RV|SHIP\s/.test(line)), lines.join("\n"));
  assert.match(columns(rendered, titleRow(rendered, "s1")).roster, /Sidebar readability +SHIP$/);
  const selected = renderSessions(buildRenderModel({ sessions: [sessions[0], other], selectedId: "s1", width: 100 }));
  assert.match(paneText(selected), /SHIP◉/);
});

test("focus decoration does not move the producer grid columns", () => {
  const focused = { ...sessions[0], workflow: { ...workflow, activeMode: { id: "focus", short: "FOC", label: "Focus" } } };
  const unselected = renderSessions(buildRenderModel({ sessions: [focused, sessions[1]], width: 100, selectedSection: "active" }));
  // On the title row the mode short replaces the step short in the same right-aligned slot.
  const focusedRow = columns(unselected, titleRow(unselected, "s0")).roster;
  const plainRow = columns(unselected, titleRow(unselected, "s1")).roster;
  assert.match(focusedRow, /FOC$/);
  assert.match(plainRow, /RV$/);
  assert.equal(visibleWidth(focusedRow), visibleWidth(plainRow));
  // In the card the mode follows the markers, so the step columns stay put.
  const first = renderSessions(buildRenderModel({ sessions: [focused, sessions[1]], width: 100, selectedId: "s0" }));
  assert.match(paneText(first), /PL✓ EX◉ RV· FOC/);
  const second = renderSessions(buildRenderModel({ sessions: [focused, sessions[1]], width: 100, selectedId: "s1" }));
  assert.match(paneText(second), /PL✓ EX✓ RV◉ *$/m);
});

test("dense pinned cards retain group and hidden requests without clipping grid labels", () => {
  const children: RuntimeSession[] = Array.from({ length: 12 }, (_, index) => ({
    ...sessions[1], id: `child-${index}`, kind: "subagent", parentId: "s0", agentName: "worker",
    status: index === 0 ? "waiting" : "running",
    context: index === 0 ? { version: 1, updatedAt: 1, attention: { kind: "question", text: "Choose", requestId: "request-1" } } : undefined,
  }));
  const owner = { ...sessions[0], additionalCwds: ["/tmp/other"], workflow: { ...workflow, activeMode: { id: "focus", short: "FOC", label: "Focus" }, steps: [...workflow.steps, { id: "reflect", short: "RF" }, { id: "commit", short: "CM" }] } };
  for (const width of [40, 50, 60]) {
    const rendered = renderSessions(buildRenderModel({ sessions: [owner, ...children], selectedId: "s0", width, height: 24, pinSlots: ["s0"] }));
    const lines = rendered.lines.map(stripAnsi);
    assert.ok(lines.some((line) => line.includes("ACTIVE") && line.includes("?1 child")));
    const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s0");
    assert.match(lines[index + 1], /\[[^\]]+\]/);
    assert.match(lines[index + 1], /\?1/);
    const grid = lines.find((line) => /PL\s+EX\s+RV\s+RF\s+CM/.test(line));
    if (grid) assert.equal(visibleWidth(lines[index + 1].slice(0, lines[index + 1].indexOf("◉"))), visibleWidth(grid.slice(0, grid.indexOf("EX"))));
    else assert.match(lines[index + 1], /◉FOC/);
  }
});

test("repo-mode metadata reserves a group before optional signals", () => {
  const owner = { ...sessions[0], additionalCwds: ["/tmp/other"], workflow: { ...workflow, activeMode: { id: "focus", short: "FOC", label: "Focus" }, steps: [...workflow.steps, { id: "reflect", short: "RF" }, { id: "commit", short: "CM" }] } };
  const children = Array.from({ length: 12 }, (_, index) => ({ ...sessions[1], id: `worker-${index}`, kind: "subagent" as const, parentId: "s0" }));
  const rendered = renderSessions(buildRenderModel({ sessions: [owner, ...children], selectedId: "s0", width: 40, height: 24, pinSlots: ["s0"], fleetGrouping: "repo" }));
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s0");
  assert.match(stripAnsi(rendered.lines[index + 1]), /\[[^\]]+\]/);
  assert.ok(rendered.lines.every((line) => visibleWidth(line) <= 40));
});

test("crowded fleet panels keep progress with every visible title", () => {
  const crowded = Array.from({ length: 12 }, (_, index) => ({ ...sessions[0], id: `s${index}`, title: `Task ${index}` }));
  for (const width of [40, 60, 100, 160]) {
    for (const selectedId of [undefined, "s0", "s5", "s11"]) {
      const rendered = renderSessions(buildRenderModel({ sessions: crowded, selectedId, width, height: 18, pinSlots: width <= 60 ? ["s0"] : undefined }));
      for (const [index, target] of rendered.rowTargets.entries()) {
        if (target?.kind !== "session") continue;
        // Pin rows share the grid; fleet roster rows (selected ones included) end with their step short.
        const roster = columns(rendered, index).roster.trimEnd();
        assert.match(roster, width <= 60 ? /✓\s+◉\s+·$/ : /EX$/, `${width}: ${target.id} lost its progress`);
        if (target.id !== (selectedId ?? "s0") || width > 60) assert.notEqual(rendered.rowTargets[index + 1]?.kind, "session-continuation");
      }
      // The fleet's selected card names every step in the side pane.
      if (width > 60) assert.match(paneText(rendered), /PL✓ EX◉ RV·/);
      assert.equal(rendered.lines.length, 18);
    }
  }
});

test("selected task survives at minimum card height beside plain step metadata", () => {
  const withTask = { ...sessions[0], context: { version: 1 as const, updatedAt: 1, ticket: { id: "task-001", subtitle: "Task explanation" } } };
  const rendered = renderSessions(buildRenderModel({ sessions: [withTask], selectedId: "s0", width: 60, height: 7 }));
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session");
  assert.ok(index >= 0);
  // The list keeps the selected row; the dock below it keeps identity, task and keys.
  assert.ok(rendered.lines.map(stripAnsi).some((line) => /Subagent efficiency {2}pi-tmux-subagents/.test(line)), rendered.lines.map(stripAnsi).join("\n"));
  assert.ok(rendered.lines.map(stripAnsi).some((line) => /Open in Pi/.test(line)));
  assert.ok(rendered.lines.map(stripAnsi).some((line) => line.includes("Task explanation")));
});

test("short pinned panels retain exact selected title and bounded hit targets", () => {
  for (const height of [8, 12, 20]) {
    const rendered = renderSessions(buildRenderModel({ sessions, selectedId: "s1", width: 40, height, pinSlots: ["s0"] }));
    assert.equal(rendered.lines.length, height);
    const index = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s1");
    assert.ok(index >= 0);
    assert.ok(stripAnsi(rendered.lines[index]).includes("Sidebar readability"));
    assert.ok(rendered.lines.every((line) => visibleWidth(line) <= 40));
  }
});
