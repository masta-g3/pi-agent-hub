import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildDashboardProjection, buildRenderModel, type RenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, lightTheme, stripAnsi, type SessionsTheme } from "../src/tui/theme.js";
import { cockpitFleet, cockpitFrameFleet, cockpitOnboardingMoments, COCKPIT_NOW } from "./fixtures/cockpit.js";
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

test("attention announcement follows the responsive hierarchy and exact hit target", () => {
  const sessions = cockpitFleet();
  const announcements = [
    { sessionId: "docs", requestId: "req/1", kind: "question" as const, text: "Choose \u001b]0;secret\u0007\u001b[31mrelease\n target", title: "Docs", announcedAt: COCKPIT_NOW - 100, expiresAt: COCKPIT_NOW + 5_900 },
    { sessionId: "blocked", requestId: "req-2", kind: "blocked" as const, text: "Need access", title: "Worker", ownerTitle: "API", announcedAt: COCKPIT_NOW - 200, expiresAt: COCKPIT_NOW + 5_800 },
  ];
  for (const width of [40, 60, 99, 100, 119, 120, 159, 160]) {
    const layout = renderSessions(buildRenderModel({ sessions, width, height: 24, now: COCKPIT_NOW, attentionAnnouncements: announcements }));
    const line = stripAnsi(layout.lines[2] ?? "");
    assert.match(line, /\? 2 NEW/);
    assert.match(line, /Docs/);
    assert.match(line, /: locate/);
    assert.equal(layout.announcementRowTargets[2], "view:locate-attention:docs:req%2F1");
    assert.equal(visibleWidth(layout.lines[2] ?? ""), width);
    if (width < 100) assert.doesNotMatch(line, /Choose release target|\+1 more/);
    else assert.match(line, /Choose release target.*\+1 more/);
    if (width >= 160) assert.match(line, /6s/);
    else assert.doesNotMatch(line, /6s/);
  }

  const crowded = renderSessions(buildRenderModel({
    sessions,
    width: 100,
    height: 24,
    now: COCKPIT_NOW,
    attentionAnnouncements: [{ ...announcements[0]!, title: "A very long requesting session identity that must yield space" }, announcements[1]!],
  }));
  assert.match(stripAnsi(crowded.lines[2] ?? ""), /“Choose release target”.*\+1 more.*: locate/);

  const boundedRequest = "r".repeat(96);
  const widest = renderSessions(buildRenderModel({
    sessions,
    width: 160,
    height: 24,
    now: COCKPIT_NOW,
    attentionAnnouncements: [{ ...announcements[0]!, text: boundedRequest }],
  }));
  assert.match(stripAnsi(widest.lines[2] ?? ""), new RegExp(boundedRequest));

  const child = renderSessions(buildRenderModel({ sessions, width: 100, height: 24, now: COCKPIT_NOW, attentionAnnouncements: [announcements[1]!] }));
  assert.match(stripAnsi(child.lines[2] ?? ""), /! BLOCKED.*Worker → API.*Need access/);

  const short = renderSessions(buildRenderModel({ sessions, width: 100, height: 10, now: COCKPIT_NOW, attentionAnnouncements: announcements }));
  assert.doesNotMatch(short.lines.map(stripAnsi).join("\n"), /: locate/);
  assert.equal(short.announcementRowTargets.every((target) => target === undefined), true);
  const expired = renderSessions(buildRenderModel({ sessions, width: 100, height: 24, now: announcements[0]!.expiresAt, attentionAnnouncements: announcements }));
  assert.doesNotMatch(expired.lines.map(stripAnsi).join("\n"), /: locate/);
});

test("attention announcement remains available in workflow empty state and compacts in pin mode", () => {
  const backlog = { ...cockpitFleet()[0]!, bucket: "backlog" as const };
  const announcement = { sessionId: backlog.id, requestId: "req", kind: "ready" as const, text: "Review", title: backlog.title, announcedAt: 100, expiresAt: 6_100 };
  const board = renderSessions(buildRenderModel({ sessions: [backlog], grouping: "stage", width: 100, height: 20, now: 200, attentionAnnouncements: [announcement] }));
  assert.match(board.lines.map(stripAnsi).join("\n"), /✓ READY.*: locate/);
  assert.equal(board.announcementRowTargets[2], `view:locate-attention:${backlog.id}:req`);

  const pinned = renderSessions(buildRenderModel({ sessions: [backlog], width: 100, height: 20, now: 200, attentionAnnouncements: [announcement], pinSlots: [backlog.id], pinCapacity: 2 }));
  assert.match(stripAnsi(pinned.lines[2] ?? ""), /✓ READY.*: locate/);
  assert.doesNotMatch(stripAnsi(pinned.lines[2] ?? ""), /Review/);
  assert.doesNotMatch(stripAnsi(pinned.lines[3] ?? ""), /^│─/);
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
  assert.equal(model.cockpitNavigation.find((entry) => entry.tier === "health")?.firstOwnerId, "cycle-a");
  assert.equal(model.cockpitNavigation.find((entry) => entry.tier === "quiet")?.firstOwnerId, "cycle-b");
  assert.deepEqual(model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions.map((row) => row.id))), ["cycle-a", "cycle-b"]);
});

function cockpitFrame(width: 60 | 100 | 160, theme?: SessionsTheme): string {
  const sessions = cockpitFrameFleet();
  const selected = sessions.find((session) => session.id === "docs")!;
  const commands = buildDashboardCommands({ sessions, selectedId: selected.id, capabilities: { openSession: true, restart: true, sendMessage: true, pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, acknowledge: true }, pinState: { slots: [undefined, undefined, undefined, undefined], count: 0, capacity: width < 100 ? 0 : width < 160 ? 2 : 4, constrained: false } });
  const model = buildRenderModel({
    sessions,
    selectedId: "docs",
    width,
    height: 24,
    now: COCKPIT_NOW,
    workspaceCommands: selectWorkspaceCommands(selected, commands, 3),
    expandedProjectParentIds: new Set(["dashboard"]),
  });
  return renderSessions(model, theme).lines.map(stripAnsi).map((line) => line.trimEnd()).join("\n");
}

test("rendering and navigation expose the same cockpit tree order", () => {
  const sessions = cockpitFrameFleet();
  const expandedProjectParentIds = new Set(["dashboard"]);
  const projection = buildDashboardProjection({ sessions, expandedProjectParentIds });
  assert.deepEqual(projection.visible.map((row) => row.id), ["docs", "qa", "dashboard", "worker", "release", "quiet-parent", "mcp", "theme", "archive-new"]);

  const layout = renderSessions(buildRenderModel({
    sessions, selectedId: "docs", width: 60, height: 24, now: COCKPIT_NOW, expandedProjectParentIds,
  }));
  assert.deepEqual(layout.rowTargets.flatMap((target) => target?.kind === "session"
    ? [target.id]
    : target?.kind === "section-header" ? [`header:${target.section}`] : []),
  ["docs", "qa", "dashboard", "worker", "release", "quiet-parent", "mcp", "theme", "header:archived", "archive-new"]);
});

test("onboarding moments stay deterministic at 60, 100, and 160 columns", () => {
  const moments = cockpitOnboardingMoments();
  for (const width of [60, 100, 160] as const) {
    const rendered = Object.fromEntries(Object.entries(moments).map(([name, moment]) => {
      const lines = renderSessions(buildRenderModel({ ...moment, width, height: 24 })).lines;
      assert.equal(lines.every((line) => visibleWidth(line) === width), true, `${name} at ${width}`);
      return [name, lines.map(stripAnsi).join("\n")];
    }));
    assert.match(rendered.empty!, /NEEDS YOU.*an agent's explicit request/s);
    assert.match(rendered.first!, /API release.*Alt\+Q Return/s);
    assert.match(rendered.request!, /Which release channel\?.*Alt\+Q Return/s);
    assert.doesNotMatch(rendered.returned!, /an agent's explicit request lands here|Alt\+Q Return/);
    assert.match(rendered.updated!, /NEW DAILY LOOP/);
    assert.doesNotMatch(rendered.dismissed!, /NEW DAILY LOOP/);
  }
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
  const model = buildRenderModel({ sessions: [activeQuiet, promotedBacklog], width: 100 });
  const rows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));

  assert.equal(rows.find((row) => row.id === "mcp")?.cockpitTier, "quiet");
  assert.ok(rows.find((row) => row.id === "mcp")?.plan);
  assert.equal(rows.find((row) => row.id === "theme")?.cockpitTier, "active");
  assert.equal(rows.find((row) => row.id === "theme")?.section, "backlog");
  assert.equal(rows.find((row) => row.id === "theme")?.plan, undefined);
});
