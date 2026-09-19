import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
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

for (const width of [40, 50, 60, 100, 120, 160, 220]) {
  test(`compact fleet titles and workflow columns at ${width} columns`, () => {
    const pinSlots = width <= 60 ? ["s0"] : undefined;
    const rendered = renderSessions(buildRenderModel({ sessions, selectedId: "s0", width, height: 35, pinSlots }), darkTheme);
    const lines = rendered.lines.map(stripAnsi);
    const header = lines.find((line) => /PL\s+EX\s+RV/.test(line));
    assert.ok(header, "one producer-owned shared header");
    assert.equal(lines.filter((line) => /PL\s+EX\s+RV/.test(line)).length, 1);
    const positions = ["PL", "EX", "RV"].map((short) => header.indexOf(short));
    for (const session of sessions) {
      const titleIndex = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === session.id);
      assert.ok(titleIndex >= 0);
      assert.ok(lines[titleIndex].includes(session.title), lines[titleIndex]);
      assert.ok(!lines[titleIndex].includes("[pi-"));
      const metadata = lines[titleIndex + 1];
      assert.deepEqual(rendered.rowTargets[titleIndex + 1], { kind: "session-continuation", id: session.id });
      assert.equal(metadata[positions[session.workflow!.activeIndex]], "◉", metadata);
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

test("completed steps stay checked in their exact shared columns", () => {
  for (const activeIndex of [0, 1, 2]) {
    const complete = { ...sessions[0], status: "stopped" as const, workflow: { ...workflow, activeIndex, currentStepComplete: true } };
    const rendered = renderSessions(buildRenderModel({ sessions: [complete], selectedId: "s0", width: 100 }));
    const lines = rendered.lines.map(stripAnsi);
    const header = lines.find((line) => /PL\s+EX\s+RV/.test(line))!;
    const title = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s0");
    for (const [index, step] of workflow.steps.entries()) {
      assert.equal(lines[title + 1][header.indexOf(step.short)], index <= activeIndex ? "✓" : "·");
    }
  }
});

test("different pipelines show explicit step labels rather than misleading grid positions", () => {
  const other = { ...sessions[1], workflow: { ...workflow, steps: [{ id: "ship", short: "SHIP", label: "Ship" }], activeIndex: 0 } };
  const rendered = renderSessions(buildRenderModel({ sessions: [sessions[0], other], selectedId: "s0", width: 100 }));
  const title = rendered.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s1");
  assert.match(stripAnsi(rendered.lines[title + 1]), /◉SHIP/);
});

test("focus decoration does not move the producer grid columns", () => {
  const focused = { ...sessions[0], workflow: { ...workflow, activeMode: { id: "focus", short: "FOC", label: "Focus" } } };
  const rendered = renderSessions(buildRenderModel({ sessions: [focused, sessions[1]], width: 100, selectedId: "s0" }));
  const lines = rendered.lines.map(stripAnsi);
  assert.ok(lines.some((line) => /PL\s+EX\s+RV/.test(line)));
  assert.ok(lines.some((line) => line.includes("FOC")));
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
        assert.deepEqual(rendered.rowTargets[index + 1], { kind: "session-continuation", id: target.id }, `${width}: ${target.id} lost its progress row`);
        assert.match(stripAnsi(rendered.lines[index + 1]), /✓\s+◉\s+·/);
      }
      assert.equal(rendered.lines.length, 18);
    }
  }
});

test("selected metadata takes priority over task text at minimum card height", () => {
  const withTask = { ...sessions[0], context: { version: 1 as const, updatedAt: 1, ticket: { id: "task-001", subtitle: "Task explanation" } } };
  const rendered = renderSessions(buildRenderModel({ sessions: [withTask], selectedId: "s0", width: 60, height: 7 }));
  const index = rendered.rowTargets.findIndex((target) => target?.kind === "session");
  assert.ok(index >= 0);
  assert.match(stripAnsi(rendered.lines[index + 1]), /\[.*\].*✓\s+◉\s+·/);
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
