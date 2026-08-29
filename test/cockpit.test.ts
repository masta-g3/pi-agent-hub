import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildDashboardProjection, buildRenderModel, type RenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, lightTheme, stripAnsi, type SessionsTheme } from "../src/tui/theme.js";
import { cockpitFleet, cockpitFrameFleet, COCKPIT_NOW } from "./fixtures/cockpit.js";
import { COCKPIT_EXPECTED_FRAMES } from "./fixtures/cockpit-frames.js";

function sectionRows(model: RenderModel, key: string) {
  return model.sections.find((section) => section.key === key)?.groups.flatMap((group) => group.sessions) ?? [];
}

function tierOf(model: RenderModel, id: string): string | undefined {
  return model.sections.find((section) => section.groups.some((group) => group.sessions.some((row) => row.id === id)))?.key;
}

function rowOf(model: RenderModel, id: string) {
  return model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions)).find((row) => row.id === id);
}

test("project cockpit classifies independent state axes without promotion", () => {
  const model = buildRenderModel({
    sessions: cockpitFleet(),
    selectedId: "docs",
    width: 100,
    now: COCKPIT_NOW,
    expandedProjectParentIds: new Set(["dashboard", "quiet-parent"]),
  });

  assert.deepEqual(model.sections.map((section) => section.key), ["needs-you", "health", "active", "quiet", "archived"]);
  assert.equal(tierOf(model, "docs"), "needs-you");
  assert.equal(tierOf(model, "ready"), "needs-you");
  assert.equal(tierOf(model, "blocked"), "needs-you");
  assert.equal(tierOf(model, "qa"), "health");
  assert.equal(tierOf(model, "dashboard"), "active");
  assert.equal(tierOf(model, "worker"), "active");
  assert.equal(tierOf(model, "release"), "active");
  assert.equal(tierOf(model, "waiting"), "quiet");
  assert.equal(tierOf(model, "quiet-parent"), "quiet");
  assert.equal(tierOf(model, "child-attention"), "quiet");
  assert.equal(tierOf(model, "child-error"), "quiet");
  assert.equal(tierOf(model, "theme"), "quiet");
  assert.equal(tierOf(model, "orphan"), "quiet");
  assert.equal(tierOf(model, "archive-new"), "archived");

  assert.equal(model.sections.find((section) => section.key === "needs-you")?.sessionsTotal, 3);
  assert.equal(model.sections.find((section) => section.key === "active")?.sessionsTotal, 2);
  assert.equal(model.sections.find((section) => section.key === "quiet")?.sessionsTotal, 5);
  assert.equal(rowOf(model, "docs")?.cockpitPlacement.kind, "explicit-attention");
  assert.equal(rowOf(model, "qa")?.cockpitPlacement.kind, "owner-error");
  assert.deepEqual(rowOf(model, "dashboard")?.cockpitPlacement, {
    kind: "descendant-active", ownerId: "dashboard", ownerTitle: "Dashboard UI polish",
    driverId: "worker", driverTitle: "code-critic", status: "running",
  });
  assert.equal(rowOf(model, "child-error")?.cockpitPlacement.kind, "quiet");
  assert.equal(rowOf(model, "archive-new")?.cockpitPlacement.kind, "archived");
});

test("Backlog lifecycle stays independent from higher-priority cockpit signals", () => {
  const backlog = cockpitFleet().find((row) => row.id === "theme")!;
  const attention = { ...backlog, status: "waiting" as const, context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose theme" } } };
  const error = { ...backlog, id: "theme-error", status: "error" as const, error: "theme failed" };
  const running = { ...backlog, id: "theme-running", status: "running" as const };
  const model = buildRenderModel({ sessions: [attention, error, running], width: 100 });

  assert.equal(tierOf(model, "theme"), "needs-you");
  assert.equal(tierOf(model, "theme-error"), "health");
  assert.equal(tierOf(model, "theme-running"), "active");
  for (const row of model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions))) {
    assert.equal(row.section, "backlog");
  }
});

test("multiple active descendants choose the first cached descendant as evidence", () => {
  const fleet = cockpitFleet();
  const parent = fleet.find((row) => row.id === "dashboard")!;
  const first = { ...fleet.find((row) => row.id === "worker")!, id: "first", agentName: "first" };
  const second = { ...first, id: "second", agentName: "second" };
  const model = buildRenderModel({ sessions: [parent, first, second], selectedId: parent.id, width: 100 });

  assert.deepEqual(model.selected?.cockpitPlacement, {
    kind: "descendant-active", ownerId: parent.id, ownerTitle: parent.title,
    driverId: "first", driverTitle: "first", status: "running",
  });
  assert.deepEqual(model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions)).map((row) => row.cockpitPlacement), [
    model.selected?.cockpitPlacement,
  ]);
});

test("filtering visibility cannot demote an owner whose hidden descendant is running", () => {
  const model = buildRenderModel({
    sessions: cockpitFleet(),
    selectedId: "dashboard",
    filter: "needle",
    width: 100,
    now: COCKPIT_NOW,
  });

  assert.equal(tierOf(model, "dashboard"), "active");
  assert.deepEqual(sectionRows(model, "active").map((row) => row.id), ["dashboard", "scout"]);
});

test("ownerless subagents use their terminal row as a standalone cockpit tree", () => {
  const model = buildRenderModel({ sessions: cockpitFleet(), selectedId: "orphan", width: 100, now: COCKPIT_NOW });
  assert.equal(tierOf(model, "orphan"), "quiet");
  assert.equal(model.sections.find((section) => section.key === "quiet")?.sessionsTotal, 5);
});

test("cyclic subagents remain visible as standalone terminal fallbacks", () => {
  const base = cockpitFleet().find((row) => row.id === "orphan")!;
  const cycleA = { ...base, id: "cycle-a", parentId: "cycle-b", status: "error" as const, error: "cycle failed" };
  const cycleB = { ...base, id: "cycle-b", parentId: "cycle-a" };
  const model = buildRenderModel({ sessions: [cycleA, cycleB], selectedId: "cycle-a", width: 100, now: COCKPIT_NOW });

  assert.equal(tierOf(model, "cycle-a"), "health");
  assert.equal(tierOf(model, "cycle-b"), "quiet");
  assert.deepEqual(model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions.map((row) => row.id))), ["cycle-a", "cycle-b"]);
});

function cockpitFrame(width: 60 | 100 | 160, theme?: SessionsTheme): string {
  const sessions = cockpitFrameFleet();
  const selected = sessions.find((session) => session.id === "docs")!;
  const capacity = width < 100 ? 0 : width < 160 ? 2 : 4;
  const constrained = capacity === 0;
  const commands = buildDashboardCommands({ sessions, selectedId: selected.id, capabilities: { openSession: true, restart: true, sendMessage: true, pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, acknowledge: true }, pinState: { slots: ["docs", undefined, undefined, undefined], count: 1, capacity, constrained } });
  const model = buildRenderModel({
    sessions,
    selectedId: "docs",
    width,
    height: 24,
    now: COCKPIT_NOW,
    pinSlots: ["docs", undefined, undefined, undefined],
    pinCapacity: capacity,
    pinConstrained: constrained,
    workspaceCommands: selectWorkspaceCommands(selected, commands, 3),
    expandedProjectParentIds: new Set(["dashboard"]),
  });
  return renderSessions(model, theme).lines.map(stripAnsi).map((line) => line.trimEnd()).join("\n");
}

test("rendering and navigation expose the same cockpit tree order", () => {
  const sessions = cockpitFrameFleet();
  const expandedProjectParentIds = new Set(["dashboard"]);
  const projection = buildDashboardProjection({ sessions, expandedProjectParentIds });
  assert.deepEqual(projection.visible.map((row) => row.id), ["docs", "qa", "dashboard", "worker", "release", "mcp", "theme", "archive-new"]);

  const layout = renderSessions(buildRenderModel({
    sessions, selectedId: "docs", width: 60, height: 24, now: COCKPIT_NOW, expandedProjectParentIds,
  }));
  assert.deepEqual(layout.rowTargets.flatMap((target) => target
    ? [target.kind === "session" ? target.id : target.kind === "section-header" ? `header:${target.section}` : target.kind]
    : []), ["docs", "qa", "dashboard", "worker", "release", "mcp", "theme", "header:archived", "archive-new"]);
});

test("live cockpit matches the intended 60, 100, and 160 column frames", () => {
  for (const width of [60, 100, 160] as const) assert.equal(cockpitFrame(width), COCKPIT_EXPECTED_FRAMES[width]);
});

test("cockpit vocabulary is theme-independent and every frame is width-safe", () => {
  for (const width of [60, 100, 160] as const) {
    const plain = cockpitFrame(width);
    assert.equal(cockpitFrame(width, darkTheme), plain);
    assert.equal(cockpitFrame(width, lightTheme), plain);
  }
  for (const width of [40, 60, 80, 100, 120, 160]) {
    const layout = renderSessions(buildRenderModel({
      sessions: cockpitFrameFleet(), selectedId: "docs", width, height: 24, now: COCKPIT_NOW,
      expandedProjectParentIds: new Set(["dashboard"]),
    }), darkTheme);
    for (const line of layout.lines) assert.equal(visibleWidth(line), width, `${width}: ${line}`);
  }
});

test("cockpit placement does not change lifecycle-owned card richness", () => {
  const plan = { tasks: { completed: 1, total: 2 }, nextStep: "Review output" };
  const activeQuiet = { ...cockpitFleet().find((row) => row.id === "mcp")!, workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 1, plan } };
  const promotedBacklog = { ...cockpitFleet().find((row) => row.id === "theme")!, status: "running" as const, workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 1, plan } };
  const model = buildRenderModel({ sessions: [activeQuiet, promotedBacklog], width: 100, density: "all-cards" });
  const rows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));

  assert.equal(rows.find((row) => row.id === "mcp")?.cockpitTier, "quiet");
  assert.ok(rows.find((row) => row.id === "mcp")?.plan);
  assert.equal(rows.find((row) => row.id === "theme")?.cockpitTier, "active");
  assert.equal(rows.find((row) => row.id === "theme")?.section, "backlog");
  assert.equal(rows.find((row) => row.id === "theme")?.plan, undefined);
});
