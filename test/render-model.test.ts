import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { boardLaneRows, buildDashboardProjection, buildRenderModel, retainSelectionAfterRefresh, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { computeStatus } from "../src/core/status.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { renderSessions, workflowStepMarker } from "../src/tui/layout.js";
import { darkTheme, lightTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import type { ManagedSession, RuntimeSession, SessionStatus } from "../src/core/types.js";

function session(id: string, group: string, status: SessionStatus, title = id): ManagedSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group,
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

function modelRows(model: ReturnType<typeof buildRenderModel>) {
  return model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));
}

const workspaceCapabilities = {
  openSession: true, restart: true, sendMessage: true, deleteSession: true,
  pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, closeSidePane: true, resizeSidePane: true, acknowledge: true,
};

function workspaceModel(input: BuildRenderModelInput) {
  const selected = input.sessions.find((item) => item.id === input.selectedId) as RuntimeSession | undefined;
  if (!selected) return buildRenderModel(input);
  const pinSlots = input.pinSlots ?? [];
  const commands = buildDashboardCommands({
    sessions: input.sessions,
    selectedId: selected.id,
    capabilities: workspaceCapabilities,
    pinState: {
      slots: pinSlots,
      activeSessionId: input.activePinnedSessionId,
      count: pinSlots.filter(Boolean).length,
      capacity: input.pinCapacity ?? 2,
      constrained: input.pinConstrained ?? false,
    },
  });
  return buildRenderModel({
    ...input,
    workspaceCommands: selectWorkspaceCommands(selected, commands, input.width >= 160 || input.width < 120 ? 3 : 2),
    workspaceFullScreen: input.width < 120,
  });
}

test("dashboard projection supplies the same visible rows as rendering", () => {
  const sessions = [session("parent", "app", "running"), { ...session("child", "app", "running"), kind: "subagent" as const, parentId: "parent" }];
  const projection = buildDashboardProjection({ sessions, expandedProjectParentIds: new Set(["parent"]) });
  const model = buildRenderModel({ sessions, selectedId: "parent", width: 120, structuralProjection: projection, expandedProjectParentIds: new Set(["parent"]) });
  assert.deepEqual(modelRows(model).map((row) => row.id), projection.visible.map((row) => row.id));
});

test("collapsed owner trees report only hidden explicit child requests", () => {
  const attention = (kind: "ready" | "question" | "blocked", text: string) => ({ version: 1 as const, updatedAt: 2, attention: { kind, text } });
  const parent = session("parent", "app", "idle", "Parent");
  const question = { ...session("question", "app", "idle", "Question child"), kind: "subagent" as const, parentId: "parent", context: attention("question", "Choose") };
  const blocked = { ...session("blocked", "app", "waiting", "Blocked child"), kind: "subagent" as const, parentId: "parent", context: attention("blocked", "Unblock") };
  const ready = { ...session("ready", "app", "idle", "Ready child"), kind: "subagent" as const, parentId: "question", context: attention("ready", "Review") };
  const errorChild = { ...session("error", "app", "error", "Error child"), kind: "subagent" as const, parentId: "parent", context: attention("question", "Not visible while errored") };
  const sessions = [parent, question, blocked, ready, errorChild];

  const collapsed = buildRenderModel({ sessions, selectedId: "parent", width: 120 });
  const owner = modelRows(collapsed).find((row) => row.id === "parent");
  assert.equal(owner?.hiddenChildRequestCount, 3);
  assert.equal(owner?.cockpitTier, "quiet");
  assert.equal(owner?.attention, undefined);
  assert.equal(collapsed.sections.find((section) => section.key === "quiet")?.hiddenChildRequestCount, 3);

  const expanded = buildRenderModel({ sessions, selectedId: "parent", width: 120, expandedProjectParentIds: new Set(["parent"]) });
  assert.equal(modelRows(expanded).find((row) => row.id === "parent")?.hiddenChildRequestCount, undefined);
  assert.equal(expanded.sections.find((section) => section.key === "quiet")?.hiddenChildRequestCount, 0);

  const filtered = buildRenderModel({ sessions, selectedId: "question", width: 120, filter: "Question child" });
  assert.equal(modelRows(filtered).find((row) => row.id === "parent")?.hiddenChildRequestCount, 2);
  assert.equal(filtered.sections.find((section) => section.key === "quiet")?.hiddenChildRequestCount, 2);
});

test("hidden child requests attach only to the cockpit presentation owner", () => {
  const attention = { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } };
  const ancestor = session("ancestor", "app", "idle", "Ancestor");
  const linkedMain = { ...session("linked", "app", "idle", "Linked main"), parentId: "ancestor" };
  const child = { ...session("child", "app", "idle", "Child"), kind: "subagent" as const, parentId: "linked", context: attention };
  const model = buildRenderModel({ sessions: [ancestor, linkedMain, child], selectedId: "ancestor", width: 120 });
  const rows = modelRows(model);

  assert.equal(rows.find((row) => row.id === "ancestor")?.hiddenChildRequestCount, undefined);
  assert.equal(rows.find((row) => row.id === "linked")?.hiddenChildRequestCount, 1);
  assert.equal(model.sections.find((section) => section.key === "quiet")?.hiddenChildRequestCount, 1);
});

test("steady-state chrome names every mode and right-aligns primary owner signals", () => {
  const needs = { ...session("needs", "app", "waiting", "Needs"), context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } } };
  const health = session("health", "app", "error", "Health");
  const child = { ...session("child", "app", "idle", "Child"), kind: "subagent" as const, parentId: "needs" };
  const sessions = [needs, health, child];

  const project = renderSessions(buildRenderModel({ sessions, selectedId: "needs", width: 100 })).lines.map(stripAnsi);
  assert.match(project[1] ?? "", /^│FLEET\s+2 trees · 1 needs you · 1 health\s*│$/);

  const board = renderSessions(buildRenderModel({ sessions, selectedId: "needs", grouping: "stage", width: 100 })).lines.map(stripAnsi);
  assert.match(board[1] ?? "", /^│WORKFLOW\s+2 Active trees · 1 needs you · 1 health\s*│$/);

  const filteredBoard = renderSessions(buildRenderModel({ sessions, selectedId: "needs", grouping: "stage", width: 100, filter: "Needs" })).lines.map(stripAnsi);
  assert.match(filteredBoard[1] ?? "", /^│WORKFLOW\s+1\/2 Active trees · 1 needs you · filter: Needs\s*│$/);

  const allMatchedProject = renderSessions(buildRenderModel({ sessions: [needs, child], selectedId: "needs", width: 100, filter: "Needs" })).lines.map(stripAnsi);
  assert.match(allMatchedProject[1] ?? "", /^│FLEET\s+1\/1 trees · 1 needs you · filter: Needs\s*│$/);
  const allMatchedBoard = renderSessions(buildRenderModel({ sessions: [needs, child], selectedId: "needs", grouping: "stage", width: 100, filter: "Needs" })).lines.map(stripAnsi);
  assert.match(allMatchedBoard[1] ?? "", /^│WORKFLOW\s+1\/1 Active trees · 1 needs you · filter: Needs\s*│$/);

  const pinned = renderSessions(buildRenderModel({ sessions, selectedId: "needs", width: 100, pinSlots: ["needs"], pinCapacity: 2 })).lines.map(stripAnsi);
  assert.match(pinned[1] ?? "", /^│PINNED FLEET\s+2 trees · 1 pinned · 1 needs you · 1 health\s*│$/);

  const workspace = renderSessions(workspaceModel({ sessions, selectedId: "needs", width: 100 })).lines.map(stripAnsi);
  assert.match(workspace[1] ?? "", /^│WORKSPACE\s+Needs · NEEDS YOU\s*│$/);
});

test("selecting a parent or child paints the whole visible owner tree", () => {
  const parent = { ...session("parent", "app", "running", "Parent"), context: { version: 1 as const, updatedAt: 2, ticket: { id: "tree-001", subtitle: "Tree context" } } };
  const child = { ...session("child", "app", "running", "Child"), kind: "subagent" as const, parentId: "parent", agentName: "worker", taskPreview: "Inspect" };
  const sibling = session("sibling", "app", "running", "Sibling");
  const theme = { ...darkTheme, selectedBg: "#010203" };
  const selectedBg = "\u001b[48;2;1;2;3m";
  for (const selectedId of ["parent", "child"]) {
    const lines = renderSessions(buildRenderModel({
      sessions: [parent, child, sibling], selectedId, width: 100, expandedProjectParentIds: new Set(["parent"]),
    }), theme).lines;
    for (const title of ["Parent", "Tree context", "worker"]) {
      assert.ok((lines.find((line) => stripAnsi(line).includes(title)) ?? "").includes(selectedBg), `${title} uses selected background`);
    }
    assert.ok(!(lines.find((line) => stripAnsi(line).includes("Sibling")) ?? "").includes(selectedBg));
    const exact = lines.filter((line) => stripAnsi(line).includes("▌"));
    assert.equal(exact.length, 1);
    assert.match(stripAnsi(exact[0] ?? ""), new RegExp(selectedId === "parent" ? "Parent" : "worker"));
  }
});

test("rich owner trees use truthful gutters without changing compact rows", () => {
  const parent = { ...session("parent", "app", "running", "Parent"), context: { version: 1 as const, updatedAt: 2, ticket: { id: "tree-001", subtitle: "Tree context" } } };
  const child = { ...session("child", "app", "idle", "Child"), kind: "subagent" as const, parentId: "parent", agentName: "worker", taskPreview: "Inspect" };
  const backlog = { ...session("backlog", "app", "idle", "Backlog"), bucket: "backlog" as const };
  const project = renderSessions(buildRenderModel({
    sessions: [parent, child, backlog], selectedId: "child", width: 120, expandedProjectParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi);
  assert.match(project.find((line) => line.includes("Parent")) ?? "", /▌?│ ▾\s+● Parent/);
  assert.match(project.find((line) => line.includes("Tree context")) ?? "", / │ Tree context/);
  assert.match(project.find((line) => line.includes("worker")) ?? "", /▌└ └─\s+○ worker/);
  assert.match(project.find((line) => line.includes("Backlog")) ?? "", / ·\s+○ Backlog/);

  const narrow = renderSessions(buildRenderModel({
    sessions: [parent, child], selectedId: "parent", width: 60, expandedProjectParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(narrow, /[▌ ](?:│|└) [▾▸·├└]/);

  const pinned = renderSessions(buildRenderModel({ sessions: [parent, child], selectedId: "parent", width: 120, pinSlots: ["parent"], pinCapacity: 2 })).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(pinned, /[▌ ](?:│|└) [▾▸·├└]/);
});

test("tree gutters remain truthful after clipping and on the workflow board", () => {
  const parent = {
    ...session("parent", "app", "running", "Parent"),
    workflow: { ...WORKFLOW, activity: { id: "working", label: "Working" }, plan: { tasks: { completed: 0, total: 1 } } },
    context: { version: 1 as const, updatedAt: 2, ticket: { id: "tree-001", subtitle: "Tree context" } },
  };
  const child = { ...session("child", "app", "idle", "Child"), kind: "subagent" as const, parentId: "parent", agentName: "worker", taskPreview: "Inspect" };
  const clipped = renderSessions(buildRenderModel({
    sessions: [parent, child, ...Array.from({ length: 4 }, (_, index) => session(`s${index}`, "app", "idle"))],
    selectedId: "parent", width: 120, height: 7, expandedProjectParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi).join("\n");
  assert.match(clipped, /▌│ ▾.*Parent/);
  assert.doesNotMatch(clipped, /└/);

  const oneVisibleLine = renderSessions(buildRenderModel({
    sessions: [parent, child, ...Array.from({ length: 4 }, (_, index) => session(`n${index}`, "app", "idle"))],
    selectedId: "parent", width: 120, height: 6, expandedProjectParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi).find((line) => line.includes("Parent")) ?? "";
  assert.match(oneVisibleLine, /▌  ▾.*Parent/);
  assert.doesNotMatch(oneVisibleLine, /▌[│└]/);

  const board = renderSessions(buildRenderModel({
    sessions: [parent, child], selectedId: "child", grouping: "stage", width: 120, expandedBoardParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi);
  assert.match(board.find((line) => line.includes("Parent")) ?? "", /│ ▾\s+● Parent/);
  assert.match(board.find((line) => line.includes("worker")) ?? "", /▌└ └─\s+○ worker/);
});

test("tree gutter tones reuse warning and border theme tokens", () => {
  const attention = { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" }, ticket: { id: "tree-001", subtitle: "Tree context" } };
  const needs = { ...session("needs", "app", "waiting", "Needs"), context: attention };
  const quiet = { ...session("quiet", "app", "idle", "Quiet"), context: { version: 1 as const, updatedAt: 2, ticket: { id: "tree-002", subtitle: "Quiet context" } } };
  const theme = { ...darkTheme, warning: "#010203", border: "#040506" };
  const lines = renderSessions(buildRenderModel({ sessions: [needs, quiet], selectedId: "quiet", width: 120 }), theme).lines;
  assert.ok((lines.find((line) => stripAnsi(line).includes("Needs")) ?? "").includes(styleToken(theme, "warning", "│")));
  assert.ok((lines.find((line) => stripAnsi(line).includes("Quiet")) ?? "").includes(styleToken(theme, "border", "│")));
  assert.match(lines.map(stripAnsi).find((line) => line.includes("NEEDS YOU") && line.includes("·1")) ?? "", /─│ NEEDS YOU/);

  const active = { ...session("active", "app", "running", "Active"), context: { version: 1 as const, updatedAt: 2, ticket: { id: "active-001", subtitle: "Active context" } } };
  const clipped = renderSessions(buildRenderModel({ sessions: [needs, active, quiet], selectedId: "active", width: 100, height: 11 })).lines.map(stripAnsi);
  assert.match(clipped.find((line) => line.includes("NEEDS YOU") && line.includes("·1")) ?? "", /── NEEDS YOU/);
  assert.doesNotMatch(clipped.find((line) => line.includes("Needs")) ?? "", /[│└] · \? ◐ Needs/);
});

test("mode labels survive every 40-column signal combination", () => {
  const needs = { ...session("needs", "app", "waiting", "Needs"), context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } } };
  const health = session("health", "app", "error", "Health");
  const modes = [
    ["FLEET", buildRenderModel({ sessions: [needs, health], selectedId: "needs", width: 40, filter: "Needs" })],
    ["WORKFLOW", buildRenderModel({ sessions: [needs, health], selectedId: "needs", width: 40, grouping: "stage" })],
    ["PINNED FLEET", buildRenderModel({ sessions: [needs, health], selectedId: "needs", width: 40, pinSlots: ["needs"], pinCapacity: 0 })],
    ["WORKSPACE", workspaceModel({ sessions: [needs, health], selectedId: "needs", width: 40 })],
  ] as const;
  for (const [mode, model] of modes) {
    const header = stripAnsi(renderSessions(model).lines[1] ?? "");
    assert.match(header, new RegExp(`^│${mode}`));
    assert.equal(visibleWidth(header), 40);
  }
});

test("hidden child requests lead right-aligned parent signals and tier totals", () => {
  const attention = { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } };
  const parent = { ...session("parent", "app", "idle", "Parent"), lastActivityAt: 1, workflow: WORKFLOW };
  const request = { ...session("request", "app", "idle", "Request"), kind: "subagent" as const, parentId: "parent", context: attention };
  const worker = { ...session("worker", "app", "running", "Worker"), kind: "subagent" as const, parentId: "parent" };
  const collapsed = renderSessions(buildRenderModel({ sessions: [parent, request, worker], selectedId: "parent", width: 160, now: 8 * 60_000 + 1 })).lines.map(stripAnsi);
  assert.match(collapsed.find((line) => line.includes("── ACTIVE")) ?? "", /·1 · \?1 child/);
  assert.match(collapsed.find((line) => line.includes("Parent")) ?? "", /Parent\s+\?1 · ⚙︎1 · .*EX.* · 8m/);

  const expanded = renderSessions(buildRenderModel({
    sessions: [parent, request, worker], selectedId: "parent", width: 160, now: 8 * 60_000 + 1, expandedProjectParentIds: new Set(["parent"]),
  })).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(expanded, /\?1 child/);
  assert.doesNotMatch(expanded.split("\n").find((line) => line.includes("Parent")) ?? "", /\?1/);
});

const WORKFLOW = {
  steps: [
    { id: "plan-md", short: "PL", label: "Plan" },
    { id: "execute", short: "EX", label: "Execute" },
    { id: "review", short: "RV", label: "Review" },
    { id: "reflect", short: "RF", label: "Reflect" },
    { id: "commit", short: "CM", label: "Commit" },
  ],
  activeIndex: 1,
  ticketId: "auth-003",
  updatedAt: 1,
};

const FOCUSED_WORKFLOW = {
  ...WORKFLOW,
  activeMode: { id: "focus", short: "FOC", label: "Focus", detail: "turn 4" },
};

test("active workflow mode replaces the Execute short in rows and workspace workflow", () => {
  const focused = { ...session("focus", "agents", "waiting"), workflow: FOCUSED_WORKFLOW };
  const model = buildRenderModel({ sessions: [focused], selectedId: "focus", width: 110, now: 1_000 });
  assert.equal(model.selected?.workflow?.activeMode?.short, "FOC");
  const parentRow = renderSessions(model).lines.map(stripAnsi).find((line) => line.includes("focus")) ?? "";
  assert.match(parentRow, /FOC/);
  assert.doesNotMatch(parentRow, /EX/);

  const workspace = renderSessions(workspaceModel({ sessions: [focused], selectedId: "focus", width: 160, now: 1_000 })).lines.map(stripAnsi).join("\n");
  assert.match(workspace, /✓ PL─◉ FOC─· RV─· RF─· CM · auth-003/);
  assert.doesNotMatch(workspace, /mode\s+Focus/);
});

test("focused cards stay in Execute and preserve FOC without row group adornments", () => {
  const focused = { ...session("focus", "agents", "running", "focused-work"), workflow: FOCUSED_WORKFLOW };
  const wide = buildRenderModel({ sessions: [focused], selectedId: "focus", grouping: "stage", width: 120 });
  assert.deepEqual(wide.sections.map((section) => section.key), ["execute"]);
  assert.equal(wide.sections[0]?.title, "EXECUTE");
  const wideText = renderSessions(wide).lines.map(stripAnsi).join("\n");
  assert.match(wideText, /agents\s+·1/);
  assert.match(wideText, /focused-work.*FOC/);
  assert.doesNotMatch(wideText, /FOC · agents/);
  assert.doesNotMatch(wideText, /── FOCUS/);

  const narrow = renderSessions(buildRenderModel({
    sessions: [{ ...focused, group: "group-name-that-cannot-fit", title: "focused-title-that-needs-space" }],
    selectedId: "focus",
    grouping: "stage",
    width: 40,
  }));
  const narrowText = narrow.lines.map(stripAnsi).join("\n");
  assert.match(narrowText, /FOC/);
  const narrowCard = narrowText.split("\n").find((line) => /[┣┗].*focused-title/.test(line)) ?? "";
  assert.doesNotMatch(narrowCard, /group-name-that-cannot-fit/);
  for (const line of narrow.lines) assert.ok(visibleWidth(line) <= 40, line);

  const titleFirst = renderSessions(buildRenderModel({
    sessions: [{ ...focused, group: "agents", title: "focus-title-12345678" }],
    selectedId: "focus",
    grouping: "stage",
    width: 40,
  })).lines.map(stripAnsi).join("\n");
  assert.match(titleFirst, /focus-title-12345678/);
  assert.match(titleFirst, /FOC/);
  const titleCard = titleFirst.split("\n").find((line) => /[┣┗].*focus-title/.test(line)) ?? "";
  assert.doesNotMatch(titleCard, /agents/);
});

test("stopped focus snapshots render as ordinary Execute sessions", () => {
  const stopped = { ...session("focus", "agents", "stopped"), workflow: FOCUSED_WORKFLOW };
  const groupsText = renderSessions(workspaceModel({
    sessions: [stopped],
    selectedId: "focus",
    width: 160,
  })).lines.map(stripAnsi).join("\n");
  assert.match(groupsText, /✓ PL─◉ EX─· RV─· RF─· CM/);
  assert.doesNotMatch(groupsText, /FOC|mode\s+Focus/);

  const board = buildRenderModel({ sessions: [stopped], selectedId: "focus", grouping: "stage", width: 120 });
  assert.equal(board.sections[0]?.key, "execute");
  const boardText = renderSessions(board).lines.map(stripAnsi).join("\n");
  const boardCard = boardText.split("\n").find((line) => line.includes("focus")) ?? "";
  assert.match(boardText, /EXECUTE/);
  assert.match(boardText, /agents\s+·1/);
  assert.match(boardCard, /focus/);
  assert.doesNotMatch(boardCard, /agents/);
  assert.doesNotMatch(boardCard, /FOC/);
  assert.match(boardCard, /\bEX\b/);
  assert.doesNotMatch(boardText, /mode\s+Focus/);
});

test("focused workflow markers use accent and stay width-safe", () => {
  const theme = { ...darkTheme, accent: "#010203", muted: "#040506", border: "#070809" };
  const focused = { ...session("focus", "agents", "waiting", "focused-".repeat(8)), workflow: FOCUSED_WORKFLOW, lastActivityAt: 0 };
  for (const width of [40, 60, 110]) {
    const layout = renderSessions(buildRenderModel({ sessions: [focused], selectedId: "focus", width, now: 14 * 60_000 }), theme);
    const rendered = layout.lines.join("\n");
    assert.match(rendered, /\u001b\[38;2;1;2;3mFOC/);
    assert.doesNotMatch(rendered, /\u001b\[38;2;4;5;6mFOC/);
    for (const line of layout.lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
});

test("workflow markers are a pure positional cue", () => {
  const active = { ...WORKFLOW, activeIndex: 2 };
  assert.deepEqual(active.steps.map((_step, index) => workflowStepMarker(active, index)), ["✓", "✓", "◉", "·", "·"]);
  const complete = { ...active, currentStepComplete: true };
  assert.deepEqual(complete.steps.map((_step, index) => workflowStepMarker(complete, index)), ["✓", "✓", "✓", "·", "·"]);
});

test("workflow rail renders positional markers in parent rows and workspace", () => {
  const active = workspaceModel({ sessions: [{ ...session("a", "default", "running"), workflow: WORKFLOW }], selectedId: "a", width: 160 });
  const completeWorkflow = { ...WORKFLOW, currentStepComplete: true, activity: { id: "done", label: "Execute complete" } };
  const complete = workspaceModel({ sessions: [{ ...session("a", "default", "stopped"), workflow: completeWorkflow }], selectedId: "a", width: 160 });

  const activeLines = renderSessions(active).lines.map(stripAnsi);
  const activeRow = activeLines.find((line) => line.includes("● a"));
  assert.match(activeRow ?? "", /● a.*◉ EX/);
  assert.match(activeLines.join("\n"), /✓ PL─◉ EX─· RV─· RF─· CM · auth-003/);

  const completeLines = renderSessions(complete).lines.map(stripAnsi);
  const completeRow = completeLines.find((line) => line.includes("- a"));
  assert.match(completeRow ?? "", /- a.*✓ EX/);
  assert.match(completeLines.join("\n"), /✓ PL─✓ EX─· RV─· RF─· CM · auth-003/);
  for (const line of [...renderSessions(active).lines, ...renderSessions(complete).lines]) assert.ok(visibleWidth(line) <= 160, line);
});

test("board card markers are positional for direct, complete, terminal, and replacement snapshots", () => {
  const cases = [
    { activeIndex: 0, currentStepComplete: false, expected: "◉····", activity: "Planning" },
    { activeIndex: 2, currentStepComplete: false, expected: "✓✓◉··", activity: "Reviewing changes" },
    { activeIndex: 2, currentStepComplete: true, expected: "✓✓✓··", activity: "Review complete" },
    { activeIndex: 4, currentStepComplete: false, expected: "✓✓✓✓◉", activity: "Committing changes" },
    { activeIndex: 4, currentStepComplete: true, expected: "✓✓✓✓✓", activity: "Commit complete" },
  ];
  for (const item of cases) {
    const workflow = { ...WORKFLOW, activeIndex: item.activeIndex, currentStepComplete: item.currentStepComplete, activity: { id: "producer-state", label: item.activity } };
    const model = buildRenderModel({ sessions: [{ ...session("a", "default", "waiting"), workflow }], selectedId: "a", width: 110, grouping: "stage" });
    assert.equal(model.sections[0]?.key, workflow.steps[item.activeIndex]?.id);
    const text = renderSessions(model).lines.map(stripAnsi).join("\n");
    const activeMarker = item.expected[item.activeIndex];
    assert.match(text, new RegExp(`${activeMarker}${workflow.steps[item.activeIndex]?.short}[\\s\\S]*${item.activity}`));
  }

  const replaced = { ...WORKFLOW, activeIndex: 0, currentStepComplete: false, activity: { id: "start", label: "Inspecting" }, updatedAt: 2 };
  const text = renderSessions(buildRenderModel({ sessions: [{ ...session("a", "default", "waiting"), workflow: replaced }], selectedId: "a", width: 40 })).lines.map(stripAnsi).join("\n");
  assert.match(text, /◉PL/);
  assert.doesNotMatch(text, /✓CM|✓✓✓✓✓/);
});

test("sidebar workflow stages use the theme accent color", () => {
  const theme = { ...darkTheme, accent: "#010203", muted: "#040506" };
  const model = buildRenderModel({ sessions: [{ ...session("a", "default", "running"), workflow: WORKFLOW }], selectedId: "a", width: 70 });
  const row = renderSessions(model, theme).lines.find((line) => /^│▌/.test(stripAnsi(line))) ?? "";

  assert.match(row, /\u001b\[38;2;1;2;3mEX/);
  assert.doesNotMatch(row, /\u001b\[38;2;4;5;6mEX/);
});

test("project rows show group lifecycle workflow and age metadata by priority", () => {
  const now = 1_000_000;
  const sessions = [
    { ...session("running", "default", "running"), workflow: WORKFLOW, lastActivityAt: now - 14 * 60_000 },
    { ...session("waiting", "default", "waiting"), workflow: WORKFLOW, lastActivityAt: now - 14 * 60_000 },
    { ...session("focused", "default", "waiting"), workflow: FOCUSED_WORKFLOW, lastActivityAt: now - 14 * 60_000 },
    { ...session("idle", "default", "idle"), lastActivityAt: now - 14 * 60_000 },
    { ...session("backlog", "default", "waiting"), bucket: "backlog" as const, workflow: WORKFLOW, lastActivityAt: now - 14 * 60_000 },
  ];
  const lines = renderSessions(buildRenderModel({ sessions, selectedId: "running", width: 110, now })).lines.map(stripAnsi);
  const row = (title: string) => lines.find((line) => line.includes(title)) ?? "";
  const rendered = lines.join("\n");

  assert.match(row("running"), /◉EX/);
  assert.doesNotMatch(row("running"), /14m/);
  assert.match(row("waiting"), /◉EX/);
  assert.match(row("focused"), /◉FOC/);
  assert.doesNotMatch(row("idle"), /EX/);
  assert.match(row("backlog"), /backlog/);
  assert.match(rendered, /default/);
  assert.match(rendered, /14m/);
});

test("expanded details include the full workflow rail", () => {
  const model = workspaceModel({ sessions: [{ ...session("a", "default", "running"), workflow: { ...WORKFLOW, ticketId: undefined } }], selectedId: "a", width: 110 });
  const text = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(text, /✓ PL─◉ EX─· RV─· RF─· CM/);
  assert.doesNotMatch(text, /· auth-003/);
});

test("sessions without workflow render no rail", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "running")], selectedId: "a", width: 110 });
  const text = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(text, /4\/7/);
  assert.doesNotMatch(text, /PL─EX/);
});

test("archive age takes priority over the workflow rail", () => {
  const day = 24 * 60 * 60 * 1000;
  const archived = { ...session("a", "default", "stopped"), bucket: "archived" as const, bucketChangedAt: 100, lastActivityAt: 100 + day, workflow: WORKFLOW };
  const model = buildRenderModel({ sessions: [archived, session("b", "default", "running")], selectedId: "a", width: 110, now: 100 + 2 * day });
  const row = renderSessions(model).lines.map(stripAnsi).find((line) => line.includes("- a"));
  assert.match(row ?? "", /a\s+2d/);
  assert.doesNotMatch(row ?? "", /\[exp|EX/);
  assert.equal(model.selected?.archiveRetentionIn, "5d");
});

test("archive labels remain width-safe at sidebar widths and show retention eligibility", () => {
  const day = 24 * 60 * 60 * 1000;
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, "default", "stopped", `archive-${index}-${"long".repeat(8)}`),
    bucket: "archived" as const,
    bucketChangedAt: index === 0 ? 0 : day * (8 - index),
  }));
  for (const width of [40, 42]) {
    const lines = renderSessions(buildRenderModel({ sessions: archived, selectedId: "archive-0", width, now: 8 * day })).lines;
    assert.match(lines.map(stripAnsi).join("\n"), /… 2 older archived/);
    assert.doesNotMatch(lines.map(stripAnsi).join("\n"), /\[exp/);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  const expired = { ...session("expired", "default", "stopped"), bucket: "archived" as const, bucketChangedAt: 0 };
  const almostEligible = buildRenderModel({ sessions: [expired], selectedId: "expired", width: 100, now: 7 * day - 30_000 });
  assert.equal(almostEligible.selected?.archiveRetentionIn, "<1m");
});

test("workflow rail stays width-safe at narrow and wide sizes", () => {
  const sessions = [{ ...session("a", "default", "running", "long-title-".repeat(6)), workflow: WORKFLOW }];
  for (const width of [70, 100, 160]) {
    for (const line of renderSessions(buildRenderModel({ sessions, selectedId: "a", width })).lines) {
      assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
    }
  }
});

test("stage grouping keeps canonical workflow trees in producer lanes and every other Active tree in OTHER ACTIVE", () => {
  const parent = { ...session("p", "agents", "running"), workflow: WORKFLOW };
  const sub = { ...session("sub", "agents", "running"), kind: "subagent" as const, parentId: "p" };
  const planning = { ...session("x", "experiments", "running"), workflow: { ...WORKFLOW, activeIndex: 0, ticketId: undefined } };
  const none = session("z", "experiments", "idle");
  const backlog = { ...session("bk", "experiments", "idle"), bucket: "backlog" as const, bucketChangedAt: 1 };
  const model = buildRenderModel({ sessions: [parent, sub, planning, none, backlog], grouping: "stage", width: 120 });

  assert.deepEqual(model.sections.map((item) => item.key), ["plan-md", "execute", "other-active"]);
  assert.deepEqual(model.sections[1]?.groups.flatMap((group) => group.sessions.map((row) => row.id)), ["p"]);
  assert.deepEqual(model.sections[2]?.groups.flatMap((group) => group.sessions.map((row) => row.id)), ["z"]);
  assert.deepEqual(model.boardHidden, { nonActive: 1 });
  assert.equal(model.selected?.id, "x");

  const rendered = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(rendered, /PLAN.*·1/);
  assert.match(rendered, /EXECUTE.*·1/);
  assert.match(rendered, /OTHER ACTIVE.*·1/);
  assert.match(rendered, /experiments\s+·1/);
  assert.doesNotMatch(rendered, /NO WORKFLOW|without workflow/);
  assert.match(rendered, /1 backlog\/archived/);
  assert.match(rendered, /WORKFLOW\s+3 Active trees/);
});

test("board projection omits orphan and cyclic subagent rows from every lane", () => {
  const parent = { ...session("parent", "api", "running"), workflow: WORKFLOW };
  const orphan = { ...session("orphan", "orphans", "idle"), kind: "subagent" as const, parentId: "missing" };
  const cycleA = { ...session("cycle-a", "cycles", "idle"), kind: "subagent" as const, parentId: "cycle-b" };
  const cycleB = { ...session("cycle-b", "cycles", "idle"), kind: "subagent" as const, parentId: "cycle-a" };
  const rows = [parent, orphan, cycleA, cycleB];

  const lanes = boardLaneRows(rows, rows, { revealAll: true });
  assert.deepEqual(lanes.map((lane) => [lane.key, lane.rows.map((row) => row.id)]), [["execute", ["parent"]]]);

  const model = buildRenderModel({ sessions: rows, grouping: "stage", width: 80, expandedBoardParentIds: new Set(["parent"]) });
  assert.deepEqual(model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions.map((row) => row.id))), ["parent"]);
});

test("board rows nest under one group heading instead of repeating the group at right", () => {
  const model = buildRenderModel({ sessions: [{ ...session("p", "agents", "running"), workflow: WORKFLOW }], grouping: "stage", width: 120 });
  const row = renderSessions(model).lines.map(stripAnsi).find((line) => line.includes("● p"));
  const listCell = row ?? "";
  assert.match(renderSessions(model).lines.map(stripAnsi).join("\n"), /agents\s+·1/);
  assert.match(listCell, /● p/);
  assert.doesNotMatch(listCell, /agents|4\/7/);
  assert.match(listCell, /\bEX\b/);
});

test("board collapses descendant rows by default and reveals them through ephemeral expansion or filtering", () => {
  const parent = { ...session("parent", "api", "waiting", "Parent task"), workflow: WORKFLOW };
  const child = { ...session("child", "api", "idle"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const nested = { ...session("nested", "api", "running"), kind: "subagent" as const, parentId: "child", agentName: "nested-worker" };
  const sessions = [parent, child, nested];

  const collapsed = buildRenderModel({ sessions, selectedId: "parent", grouping: "stage", width: 60 });
  assert.deepEqual(collapsed.sections[0]?.groups[0]?.sessions.map((row) => row.id), ["parent"]);
  assert.equal(collapsed.selected?.boardDescendantCount, 2);
  assert.equal(collapsed.selected?.boardExpanded, false);
  const collapsedLayout = renderSessions(collapsed);
  assert.match(collapsedLayout.lines.map(stripAnsi).join("\n"), /▸\s+◐ Parent task.*⚙︎1/);
  assert.deepEqual(collapsedLayout.rowTargets.flatMap((target) => target?.kind === "session" ? [target.id] : []), ["parent"]);

  const expanded = buildRenderModel({ sessions, selectedId: "parent", grouping: "stage", width: 60, expandedBoardParentIds: new Set(["parent"]) });
  assert.deepEqual(expanded.sections[0]?.groups[0]?.sessions.map((row) => row.id), ["parent", "child", "nested"]);
  assert.equal(expanded.selected?.boardExpanded, true);
  assert.match(renderSessions(expanded).lines.map(stripAnsi).join("\n"), /▾\s+◐ Parent task.*⚙︎1/);

  const filtered = buildRenderModel({ sessions, selectedId: "parent", grouping: "stage", width: 60, filter: "nested-worker" });
  assert.deepEqual(filtered.sections[0]?.groups[0]?.sessions.map((row) => row.id), ["parent", "child", "nested"]);
  assert.equal(filtered.selected?.boardExpanded, true);

  const projectCollapsed = buildRenderModel({ sessions, selectedId: "parent", grouping: "project", width: 60 });
  assert.deepEqual(modelRows(projectCollapsed).map((row) => row.id), ["parent"]);
  assert.match(renderSessions(projectCollapsed).lines.map(stripAnsi).join("\n"), /▸\s+◐ Parent task/);

  const projectExpanded = buildRenderModel({ sessions, selectedId: "parent", grouping: "project", width: 60, expandedProjectParentIds: new Set(["parent"]) });
  assert.deepEqual(modelRows(projectExpanded).map((row) => row.id), ["parent", "child", "nested"]);
  assert.match(renderSessions(projectExpanded).lines.map(stripAnsi).join("\n"), /▾\s+◐ Parent task/);

  const projectFiltered = buildRenderModel({ sessions, selectedId: "parent", grouping: "project", width: 60, filter: "nested-worker" });
  assert.deepEqual(modelRows(projectFiltered).map((row) => row.id), ["parent", "child", "nested"]);
});

test("board groups child rows by their top-level parent and counts parent cards only", () => {
  const parent = { ...session("parent", "api", "waiting", "Parent task"), workflow: WORKFLOW };
  const child = { ...session("child", "different", "idle"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const model = buildRenderModel({ sessions: [parent, child], grouping: "stage", width: 60, expandedBoardParentIds: new Set(["parent"]) });
  const lane = model.sections[0];
  assert.deepEqual(lane?.groups.map((group) => [group.name, group.sessions.map((row) => row.id)]), [["api", ["parent", "child"]]]);
  assert.equal(lane?.sessionsTotal, 1);
  const layout = renderSessions(model);
  assert.match(layout.lines.map(stripAnsi).join("\n"), /── EXECUTE\s+·1/);
  assert.equal(layout.rowTargets.filter((target) => target?.kind === "session").length, 2);
});

test("board group order follows the already ordered lane rows used by navigation", () => {
  const sessions = [
    { ...session("a-execute", "alpha", "idle"), workflow: WORKFLOW },
    { ...session("a-review", "alpha", "error"), workflow: { ...WORKFLOW, activeIndex: 2 } },
    { ...session("b-execute", "beta", "running"), workflow: WORKFLOW },
  ];
  const model = buildRenderModel({ sessions, grouping: "stage", width: 60 });
  assert.deepEqual(model.sections.find((section) => section.key === "execute")?.groups.map((group) => group.name), ["alpha", "beta"]);
});

test("parent board rows show the count of starting and running descendants only", () => {
  const parent = { ...session("parent", "api", "waiting", "Parent task"), workflow: FOCUSED_WORKFLOW };
  const descendants = [
    { ...session("starting", "api", "starting"), kind: "subagent" as const, parentId: "parent" },
    { ...session("running", "api", "running"), kind: "subagent" as const, parentId: "starting" },
    { ...session("waiting", "api", "waiting"), kind: "subagent" as const, parentId: "parent" },
    { ...session("error", "api", "error"), kind: "subagent" as const, parentId: "parent" },
  ];
  const model = buildRenderModel({ sessions: [parent, ...descendants], selectedId: "parent", grouping: "stage", width: 60 });
  assert.equal(model.selected?.runningSubagentCount, 2);
  assert.equal(model.selected?.displayStatus, "waiting");
  const text = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(text, /▸\s+◐ Parent task.*⚙︎2.*FOC/);
  assert.doesNotMatch(text, /starting ⚙︎|running ⚙︎|waiting ⚙︎|error ⚙︎/);
  assert.equal(visibleWidth("⚙︎2"), 2);

  const zero = renderSessions(buildRenderModel({ sessions: [parent, descendants[2]!], selectedId: "parent", grouping: "stage", width: 40 })).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(zero, /⚙︎0|⚙︎1/);
});

test("descendant counts preserve parent links that continue through a main row", () => {
  const ancestor = { ...session("ancestor", "api", "waiting"), workflow: WORKFLOW };
  const parent = { ...session("parent", "api", "waiting"), parentId: "ancestor", workflow: WORKFLOW };
  const child = { ...session("child", "api", "running"), kind: "subagent" as const, parentId: "parent" };
  const model = buildRenderModel({ sessions: [ancestor, parent, child], grouping: "stage", width: 80 });
  const rows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));

  assert.equal(rows.find((row) => row.id === "parent")?.boardDescendantCount, 1);
  assert.equal(rows.find((row) => row.id === "ancestor")?.boardDescendantCount, 1);
  assert.equal(rows.find((row) => row.id === "ancestor")?.runningSubagentCount, 1);
});

test("board chooses the prevalent pipeline deterministically and uses its newest vocabulary", () => {
  const steps = [
    { id: "plan-md", short: "PL", label: "Old plan" },
    { id: "execute", short: "EX", label: "Execute" },
    { id: "review", short: "RV", label: "Review" },
  ];
  const currentSteps = steps.map((step) => step.id === "plan-md" ? { ...step, short: "PN", label: "Plan" } : step);
  const alternateSteps = [{ id: "discover", short: "DS", label: "Discover" }, ...steps];
  const sessions = [
    { ...session("alt-2", "alt", "waiting"), workflow: { steps: alternateSteps, activeIndex: 0, updatedAt: 50 } },
    { ...session("main-old", "main", "running"), workflow: { steps, activeIndex: 0, updatedAt: 10 } },
    { ...session("alt-1", "alt", "running"), workflow: { steps: alternateSteps, activeIndex: 1, updatedAt: 40 } },
    { ...session("main-new", "main", "idle"), workflow: { steps: currentSteps, activeIndex: 1, updatedAt: 20 } },
    { ...session("main-third", "main", "waiting"), workflow: { steps, activeIndex: 2, updatedAt: 15 } },
  ];
  const model = buildRenderModel({ sessions, grouping: "stage", width: 120 });

  assert.deepEqual(model.sections.map((section) => [section.key, section.title, section.sessionsTotal]), [
    ["plan-md", "PLAN", 1],
    ["execute", "EXECUTE", 1],
    ["review", "REVIEW", 1],
    ["other-active", "OTHER ACTIVE", 2],
  ]);
  assert.deepEqual(model.boardHidden, { nonActive: 0 });
  assert.deepEqual(model.sections.filter((section) => section.key !== "other-active").flatMap((section) => section.groups.flatMap((group) => group.sessions.filter((row) => row.kind !== "subagent").map((row) => row.id))), ["main-old", "main-new", "main-third"]);
  assert.deepEqual(model.sections.find((section) => section.key === "other-active")?.groups.flatMap((group) => group.sessions.map((row) => row.id)), ["alt-2", "alt-1"]);

  const tied = buildRenderModel({ sessions: sessions.slice(0, 4), grouping: "stage", width: 120 });
  assert.equal(tied.sections[0]?.key, "discover");
});

test("adaptive window does not orphan continuation lines around a micro selection", () => {
  const parent = session("parent", "agents", "idle", "Parent title");
  const child = { ...session("child", "agents", "idle", "Child title"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const siblings = Array.from({ length: 6 }, (_, index) => session(`other-${index}`, "agents", "idle", `Other ${index}`));
  const layout = renderSessions(buildRenderModel({ sessions: [parent, child, ...siblings], selectedId: "child", width: 60, height: 10, expandedProjectParentIds: new Set(["parent"]) }));
  const text = layout.lines.map(stripAnsi).join("\n");

  assert.match(text, /worker/);
  assert.equal(layout.rowTargets.filter((target) => target?.kind === "session" && target.id === "child").length, 1);

  const twoRowLayout = renderSessions(buildRenderModel({ sessions: [parent, child, ...siblings], selectedId: "child", width: 60, height: 7, expandedProjectParentIds: new Set(["parent"]) }));
  const twoRowText = twoRowLayout.lines.map(stripAnsi).join("\n");
  assert.equal(twoRowText.match(/worker/g)?.length, 1);
  assert.equal(twoRowLayout.rowTargets.filter((target) => target?.kind === "session" && target.id === "child").length, 1);
});

test("render model records named pin and focused identity", () => {
  const model = buildRenderModel({
    sessions: [session("api", "default", "running"), session("docs", "default", "idle")],
    width: 100,
    pinSlots: ["docs", "api", undefined, undefined],
    activePinnedSessionId: "api",
    pinCapacity: 2,
  });
  const api = modelRows(model).find((item) => item.id === "api");
  const docs = modelRows(model).find((item) => item.id === "docs");
  assert.deepEqual([api?.pinSlot, api?.pinned, api?.pinFocused, docs?.pinSlot, docs?.pinned], [2, true, true, 1, true]);
  assert.deepEqual(model.pinSummary, {
    slots: [{ slot: 1, title: "docs", active: false }, { slot: 2, title: "api", active: true }],
    constrained: false,
  });
  const text = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(text, /PINNED · ▢1 docs · ▣2 api/);
  assert.match(text, /● ▣2 api/);
  assert.match(text, /○ ▢1 docs/);
});

test("named pin summary reports constraint and unpinned rows gain title width", () => {
  const sessions = [session("api", "default", "running", "long-api-title"), session("docs", "default", "idle", "long-docs-title")];
  const pinned = renderSessions(buildRenderModel({ sessions, selectedId: "api", width: 40, pinSlots: ["api"], pinCapacity: 0, pinConstrained: true })).lines.map(stripAnsi).join("\n");
  const unpinned = renderSessions(buildRenderModel({ sessions, selectedId: "docs", width: 40 })).lines.map(stripAnsi).join("\n");
  assert.match(pinned, /PINNED · ▢1 long-api.*constrai/);
  assert.match(pinned, /▢1 long-api/);
  assert.match(unpinned, /long-docs/);
  assert.doesNotMatch(unpinned, /[▢▣]/);
});

test("named pin rendering remains ANSI width safe with workflow rails", () => {
  const sessions = [
    { ...session("api", "default", "running", "long-title-".repeat(6)), workflow: WORKFLOW },
    session("docs", "default", "idle", "docs-title-".repeat(6)),
  ];
  for (const width of [40, 60, 100, 120, 160]) {
    for (const line of renderSessions(buildRenderModel({ sessions, selectedId: "api", width, pinSlots: ["api", "docs"], activePinnedSessionId: "docs", pinCapacity: width >= 160 ? 4 : 2 })).lines) {
      assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
    }
  }
});

test("pinned cockpit uses deterministic decision strip pruning and visible exact targets", () => {
  const selected = {
    ...session("api", "default", "running", "api"),
    context: { version: 1 as const, updatedAt: 2, ticket: { id: "cockpit-008", subtitle: "Adaptive cockpit" } },
  };
  const renderAt = (height: number, evidence = false) => renderSessions(workspaceModel({
    sessions: [selected], selectedId: "api", width: 100, height,
    pinSlots: ["api"], activePinnedSessionId: "api", pinCapacity: 2,
    workspaceEvidenceVisible: evidence,
  }));

  const three = renderAt(11);
  const threeText = three.lines.map(stripAnsi).join("\n");
  assert.match(threeText, /running · ACTIVE/);
  assert.match(threeText, /no explicit request/);
  assert.match(threeText, /Enter Open · : Actions/);
  assert.deepEqual(three.workspaceRowTargets.filter(Boolean), ["action:api:open"]);
  assert.equal(three.rowTargets.filter((target) => target?.kind === "session-continuation").length, 0);
  const evidenceText = renderAt(11, true).lines.map(stripAnsi).join("\n");
  assert.match(evidenceText, /tmux|heartbeat/i);
  assert.doesNotMatch(evidenceText, /no explicit request/);
  assert.deepEqual(renderAt(11, true).workspaceRowTargets.filter(Boolean), []);

  const twoText = renderAt(9).lines.map(stripAnsi).join("\n");
  assert.doesNotMatch(twoText, /running · ACTIVE/);
  assert.match(twoText, /no explicit request[\s\S]*Enter Open/);
  const one = renderAt(8);
  assert.doesNotMatch(one.lines.map(stripAnsi).join("\n"), /no explicit request|running · ACTIVE/);
  assert.deepEqual(one.workspaceRowTargets.filter(Boolean), ["action:api:open"]);
  const none = renderAt(7);
  assert.deepEqual(none.workspaceRowTargets.filter(Boolean), []);
  assert.equal(none.lines.length, 7);
  assert.match(stripAnsi(none.lines.at(-2) ?? ""), /1–4 Assign/);
});

test("layout hit map marks only rendered session rows", () => {
  const sessions = [
    session("active", "default", "idle", "active-api"),
    { ...session("backlog", "default", "running", "backlog-docs"), bucket: "backlog" as const, bucketChangedAt: 1 },
    { ...session("archived", "work", "stopped", "archived-worker"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "backlog", width: 70, now: 100 }));

  assert.equal(layout.lines.length, layout.rowTargets.length);
  for (const [index, target] of layout.rowTargets.entries()) {
    const text = stripAnsi(layout.lines[index] ?? "");
    if (target?.kind !== "session") {
      assert.doesNotMatch(text, /active-api|backlog-docs|archived-worker/);
      continue;
    }
    const title = sessions.find((item) => item.id === target.id)?.title;
    assert.ok(title, `unknown session id ${target.id}`);
    assert.match(text, new RegExp(title));
  }
  assert.equal(layout.rowTargets[0], undefined);
  assert.equal(layout.rowTargets.at(-1), undefined);
});

test("workspace uses frozen responsive geometry", () => {
  const planned = { ...session("planned", "default", "idle"), workflow: WORKFLOW };
  assert.equal(renderSessions(buildRenderModel({ sessions: [planned], selectedId: "planned", width: 100 })).listWidth, 81);
  assert.equal(renderSessions(workspaceModel({ sessions: [planned], selectedId: "planned", width: 120 })).listWidth, 65);
  assert.equal(renderSessions(workspaceModel({ sessions: [planned], selectedId: "planned", width: 160 })).listWidth, 95);
});

test("layout hit maps handle empty and persistent workspace layouts", () => {
  const empty = renderSessions(buildRenderModel({ sessions: [], width: 80 }));
  assert.ok(empty.rowTargets.every((target) => target === undefined));
  assert.equal(empty.listWidth, 0);

  const wide = renderSessions(workspaceModel({ sessions: [session("a", "default", "idle")], selectedId: "a", width: 120 }));
  assert.equal(wide.lines.length, wide.rowTargets.length);
  assert.equal(wide.lines.length, wide.workspaceRowTargets.length);
  assert.equal(wide.listWidth, 65);
  assert.ok(wide.workspaceRowTargets.some(Boolean));
});

function manySessions(count: number): ManagedSession[] {
  return Array.from({ length: count }, (_, index) => session(`s${index}`, "default", "idle", `session-${index}`));
}

function renderedSessionIds(layout: ReturnType<typeof renderSessions>): string[] {
  return layout.rowTargets.flatMap((target) => target?.kind === "session" ? [target.id] : []);
}

test("height-bounded layout clips long lists to terminal rows", () => {
  const layout = renderSessions(buildRenderModel({ sessions: manySessions(20), selectedId: "s10", width: 80, height: 15 }));

  assert.equal(layout.lines.length, 15);
  assert.equal(layout.rowTargets.length, 15);
  assert.ok(layout.rowTargets.some((target) => target?.kind === "session" && target.id === "s10"));
  for (const line of layout.lines) assert.ok(visibleWidth(line) <= 80, line);
});

test("height-bounded empty and no-match states fit terminal rows", () => {
  const empty = renderSessions(buildRenderModel({ sessions: [], width: 80, height: 15 }));
  const noMatches = renderSessions(buildRenderModel({ sessions: manySessions(3), filter: "zzz", width: 80, height: 15 }));

  assert.equal(empty.lines.length, 15);
  assert.equal(noMatches.lines.length, 15);
  assert.equal(empty.rowTargets.length, 15);
  assert.equal(noMatches.rowTargets.length, 15);
  const shortNoMatch = renderSessions(buildRenderModel({ sessions: manySessions(3), filter: "zzz", width: 80, height: 6 }));
  assert.match(shortNoMatch.lines.map(stripAnsi).join("\n"), /No sessions match "zzz"/);
});

test("height-bounded list keeps a top selection and nearby titles", () => {
  const layout = renderSessions(buildRenderModel({ sessions: manySessions(20), selectedId: "s0", width: 80, height: 15 }));
  assert.deepEqual(renderedSessionIds(layout), manySessions(9).map((item) => item.id));
});

test("height-bounded list keeps a bottom selection and nearby titles", () => {
  const layout = renderSessions(buildRenderModel({ sessions: manySessions(20), selectedId: "s19", width: 80, height: 15 }));
  assert.deepEqual(renderedSessionIds(layout), manySessions(20).slice(11).map((item) => item.id));
});

test("height-bounded list centers a middle selection among nearby titles", () => {
  const layout = renderSessions(buildRenderModel({ sessions: manySessions(20), selectedId: "s10", width: 80, height: 15 }));
  assert.deepEqual(renderedSessionIds(layout), manySessions(20).slice(6, 15).map((item) => item.id));
});

test("height-bounded list handles exact and one-over capacity", () => {
  const exact = renderSessions(buildRenderModel({ sessions: manySessions(9), selectedId: "s0", width: 80, height: 15 }));
  assert.equal(exact.listScrollTop, 0);
  assert.doesNotMatch(exact.lines.map(stripAnsi).join("\n"), /[↑↓] \d+ more/);
  assert.deepEqual(renderedSessionIds(exact), manySessions(9).map((item) => item.id));

  const oneOver = renderSessions(buildRenderModel({ sessions: manySessions(10), selectedId: "s0", width: 80, height: 15 }));
  assert.deepEqual(renderedSessionIds(oneOver), manySessions(9).map((item) => item.id));
});

test("height-bounded list derives its adaptive window from selection", () => {
  const sessions = manySessions(30);
  const first = renderSessions(buildRenderModel({ sessions, selectedId: "s10", width: 80, height: 15 }));
  const next = renderSessions(buildRenderModel({ sessions, selectedId: "s11", width: 80, height: 15, listScrollTop: 99 }));

  assert.deepEqual(renderedSessionIds(first), manySessions(30).slice(6, 15).map((item) => item.id));
  assert.deepEqual(renderedSessionIds(next), manySessions(30).slice(7, 16).map((item) => item.id));
});

test("project view defaults to cockpit tiers with Backlog as row metadata", () => {
  const backlog = { ...session("bk", "experiments", "idle"), bucket: "backlog" as const, bucketChangedAt: 1 };
  const model = buildRenderModel({ sessions: [session("a", "default", "idle"), backlog], width: 120 });
  const rendered = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.deepEqual(model.sections.map((section) => section.key), ["quiet"]);
  assert.match(rendered, /QUIET/);
  assert.match(rendered, /backlog · experiments/);
  assert.doesNotMatch(rendered, /view lanes|── BACKLOG/);
});

test("empty state rendering includes first-run prompts", () => {
  const lines = renderSessions(buildRenderModel({ sessions: [], width: 64 })).lines;
  assert.match(lines.join("\n"), /No managed Pi sessions yet/);
  assert.match(lines.join("\n"), /▶ n  create a session/);
  assert.match(lines.join("\n"), /  q  quit/);
});

test("grouping order and status counts", () => {
  const model = buildRenderModel({
    sessions: [session("b", "work", "idle"), session("a", "default", "waiting"), session("e", "default", "error")],
    width: 120,
  });
  assert.deepEqual(model.sections.map((section) => [section.key, section.statusCounts]), [
    ["health", { running: 0, waiting: 0, idle: 0, error: 1, stopped: 0 }],
    ["quiet", { running: 0, waiting: 1, idle: 1, error: 0, stopped: 0 }],
  ]);
  const rendered = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(rendered, /── HEALTH[\s\S]*× e[\s\S]*default[\s\S]*── QUIET[\s\S]*◐ a[\s\S]*default[\s\S]*○ b[\s\S]*work/);
  assert.doesNotMatch(rendered, /1 waiting · 1 error/);
});

test("groups keep stable order and expose unacknowledged waiting counts", () => {
  const sessions = [
    { ...session("default-waiting", "default", "waiting"), lastActivityAt: 100 },
    { ...session("default-idle", "default", "idle"), lastActivityAt: 300 },
    { ...session("work-waiting", "work", "waiting"), acknowledgedAt: 50, lastActivityAt: 400 },
    { ...session("z-waiting", "z", "waiting"), lastActivityAt: 200 },
  ];
  const model = buildRenderModel({ sessions, width: 120 });

  const rows = modelRows(model);
  assert.deepEqual([...new Set(rows.map((row) => row.group))], ["default", "work", "z"]);
  assert.equal(rows.find((row) => row.id === "default-waiting")?.needsAttention, true);
  assert.equal(rows.find((row) => row.id === "work-waiting")?.needsAttention, false);

  const rendered = renderSessions(buildRenderModel({ sessions, width: 40 })).lines.map(stripAnsi).join("\\n");
  assert.match(rendered, /QUIET/);
  assert.match(rendered, /default-waiting.*default/);
  assert.doesNotMatch(rendered, /default.*◐1/);
});

test("groups are rendered by newest waiting or idle activity", () => {
  const model = buildRenderModel({
    sessions: [
      { ...session("default-idle", "default", "idle"), lastActivityAt: 100 },
      { ...session("work-idle", "work", "idle"), lastActivityAt: 200 },
      { ...session("work-waiting", "work", "waiting"), lastActivityAt: 300 },
      { ...session("z-waiting", "z", "waiting"), lastActivityAt: 400 },
      { ...session("z-idle", "z", "idle"), lastActivityAt: 50 },
    ],
    width: 120,
  });

  assert.deepEqual([...new Set(modelRows(model).map((row) => row.group))], ["default", "work", "z"]);
});

test("cockpit flattens groups into row tags and keeps Archived chronological", () => {
  const day = 24 * 60 * 60 * 1000;
  const backlog = { ...session("backlog", "default", "idle"), bucket: "backlog" as const, bucketChangedAt: 100 };
  const archiveOld = { ...session("archive-old", "default", "stopped"), bucket: "archived" as const, bucketChangedAt: 100 };
  const archiveNew = { ...session("archive-new", "work", "stopped"), bucket: "archived" as const, bucketChangedAt: 100 + day };
  const model = buildRenderModel({ sessions: [archiveOld, session("active", "default", "idle"), backlog, archiveNew], selectedId: "archive-new", width: 120, now: 100 + 2 * day });

  assert.deepEqual(model.sections.map((section) => [section.key, section.groups.map((group) => group.name)]), [["quiet", [""]], ["archived", [""]]]);
  assert.deepEqual(model.sections[1]?.groups[0]?.sessions.map((row) => row.id), ["archive-new", "archive-old"]);
  assert.equal(model.selected?.archivedAge, "1d");
  assert.equal(model.selected?.archiveRetentionIn, "6d");
  assert.match(model.footer, /: Actions/);

  const rendered = renderSessions(model).lines.map(stripAnsi).join("\n");
  assert.match(rendered, /QUIET/);
  assert.match(rendered, /backlog · default/);
  assert.match(rendered, /ARCHIVED/);
  assert.doesNotMatch(rendered, /── BACKLOG|\[exp/);
});

test("Archived collapses after five parent cascades and filtering reveals matches", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, index % 2 ? "work" : "default", "stopped"),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const child = { ...session("child", "default", "stopped"), kind: "subagent" as const, parentId: "archive-0", agentName: "scout" };

  const collapsed = buildRenderModel({ sessions: [...archived, child], width: 80, now: 800 });
  const archiveSection = collapsed.sections.find((section) => section.key === "archived");
  assert.equal(archiveSection?.sessionsTotal, 7);
  assert.equal(archiveSection?.archiveDisclosure?.hiddenParents, 2);
  assert.deepEqual(archiveSection?.groups[0]?.sessions.map((row) => row.id), ["archive-0", "archive-1", "archive-2", "archive-3", "archive-4"]);
  assert.match(renderSessions(collapsed).lines.map(stripAnsi).join("\n"), /… 2 older archived/);

  const treeExpanded = buildRenderModel({ sessions: [...archived, child], width: 80, now: 800, expandedProjectParentIds: new Set(["archive-0"]) });
  assert.deepEqual(treeExpanded.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.map((row) => row.id), ["archive-0", "child", "archive-1", "archive-2", "archive-3", "archive-4"]);

  const expanded = buildRenderModel({ sessions: [...archived, child], width: 80, now: 800, archiveExpanded: true, archiveDisclosureSelected: true });
  assert.equal(expanded.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.length, 7);
  assert.match(renderSessions(expanded).lines.map(stripAnsi).join("\n"), /▌ ⌃ show fewer/);

  const filtered = buildRenderModel({ sessions: [...archived, child], width: 80, filter: "archive-6", now: 800 });
  assert.deepEqual(filtered.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.map((row) => row.id), ["archive-6"]);
  assert.equal(filtered.sections.find((section) => section.key === "archived")?.archiveDisclosure, undefined);
});

test("an ephemeral reveal exposes only its collapsed older Archived cascade", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, "default", "stopped"),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const child = { ...session("old-child", "default", "stopped"), kind: "subagent" as const, parentId: "archive-6", agentName: "worker" };
  const model = buildRenderModel({
    sessions: [...archived, child],
    selectedId: "old-child",
    width: 80,
    collapsedSections: new Set(["archived"] as const),
    expandedProjectParentIds: new Set(["archive-6"]),
    revealedSessionId: "old-child",
  });

  const rows = model.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.map((row) => row.id);
  assert.deepEqual(rows, ["archive-6", "old-child"]);
  assert.doesNotMatch(renderSessions(model).lines.map(stripAnsi).join("\n"), /archive-5/);
});

test("late-created descendants inherit Archived presentation and stay out of the board", () => {
  const parent = { ...session("parent", "default", "stopped"), bucket: "archived" as const, bucketChangedAt: 100 };
  const child = { ...session("child", "default", "running"), kind: "subagent" as const, parentId: "parent", agentName: "worker", workflow: WORKFLOW };

  const groups = buildRenderModel({ sessions: [parent, child], width: 100, now: 200 });
  assert.deepEqual(groups.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.map((row) => [row.id, row.section]), [["parent", "archived"]]);
  const groupsExpanded = buildRenderModel({ sessions: [parent, child], width: 100, now: 200, expandedProjectParentIds: new Set(["parent"]) });
  assert.deepEqual(groupsExpanded.sections.find((section) => section.key === "archived")?.groups[0]?.sessions.map((row) => [row.id, row.section]), [["parent", "archived"], ["child", "archived"]]);

  const board = buildRenderModel({ sessions: [parent, child], width: 100, grouping: "stage", now: 200 });
  assert.equal(board.sections.length, 0);
  assert.deepEqual(board.boardHidden, { nonActive: 1 });
});

test("single-tier dashboards keep the cockpit tier visible", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 120 });
  assert.match(renderSessions(model).lines.join("\n"), /QUIET/);
});

test("session order puts unread waiting before running and idle rows", () => {
  const model = buildRenderModel({
    sessions: [
      { ...session("worker", "default", "idle", "zzz"), lastActivityAt: 200 },
      session("api", "default", "error", "aaa"),
      { ...session("docs", "default", "waiting", "mmm"), lastActivityAt: 100 },
    ],
    width: 120,
  });
  assert.deepEqual(modelRows(model).map((item) => item.id), ["api", "docs", "worker"]);
});

test("narrow layout hides preview and uses readable compact footer", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 42 });
  assert.equal(model.showWorkspace, false);
  assert.equal(model.footer, "↑↓ · / Filter · : Actions · ? Help");
});


test("wide footer groups keys by intent", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle")], width: 120 });
  assert.equal(model.footer, "↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help");
});

test("wide footer stays stable for worktree sessions", () => {
  const model = buildRenderModel({
    sessions: [{ ...session("a", "default", "idle"), worktreeOwnedByHub: true, worktreePath: "/tmp/wt" }],
    width: 120,
  });
  assert.equal(model.footer, "↑↓ Move · Enter Open · n New · / Filter · S Board · : Actions · ? Help");
});

test("long titles/cwd truncate without exceeding width", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "a".repeat(100))], width: 60 });
  for (const line of renderSessions(model).lines) assert.ok(visibleWidth(line) <= 60, line);
});


test("top summary shows visible totals attention counts and filter", () => {
  const model = buildRenderModel({
    sessions: [session("api", "default", "running"), session("docs", "default", "waiting"), session("web", "default", "error")],
    width: 120,
    filter: "doc",
  });

  assert.equal(model.summary.total, 3);
  assert.equal(model.summary.visibleTotal, 1);
  assert.deepEqual(model.summary.statusCounts, { running: 0, waiting: 1, idle: 0, error: 0, stopped: 0 });
  assert.match(renderSessions(model).lines.join("\n"), /FLEET\s+1\/3 trees · filter: doc/);
  assert.doesNotMatch(renderSessions(model).lines.join("\n"), /◐1/);
});


test("error reason appears in selected metadata", () => {
  const broken = { ...session("a", "default", "error", "api"), error: "MCP failed" };
  const lines = renderSessions(workspaceModel({ sessions: [broken], selectedId: "a", width: 120 })).lines;
  assert.match(lines.join("\n"), /error · MCP failed/);
});

test("selected and stopped rows have distinct treatments with stopped rows last", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "stopped", "api"), session("b", "default", "idle", "docs")], selectedId: "b", width: 100 });
  const lines = renderSessions(model).lines.join("\n");
  assert.match(lines, /▌│ ·\s+○ docs[\s\S]*│ ·\s+- api/);
  assert.doesNotMatch(lines, /Stopped/);
});

test("lifecycle muting stays independent from cockpit tier color", () => {
  const theme = { ...darkTheme, error: "#010203", muted: "#040506" };
  const sessions = [
    session("active", "default", "error", "active-error"),
    { ...session("backlog", "default", "error", "backlog-error"), bucket: "backlog" as const },
    { ...session("archived", "default", "error", "archived-error"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const lines = renderSessions(buildRenderModel({ sessions, width: 120 }), theme).lines;
  const row = (title: string) => lines.find((line) => stripAnsi(line).includes(title)) ?? "";

  assert.match(row("active-error"), /\u001b\[38;2;1;2;3m×/);
  for (const title of ["backlog-error", "archived-error"]) {
    assert.match(row(title), /\u001b\[38;2;4;5;6m×/);
    assert.doesNotMatch(row(title), /\u001b\[38;2;1;2;3m×/);
  }
  const health = lines.find((line) => stripAnsi(line).includes("HEALTH")) ?? "";
  assert.match(health, /\u001b\[38;2;1;2;3m.*HEALTH/);
  const archived = lines.find((line) => stripAnsi(line).includes("ARCHIVED")) ?? "";
  assert.match(archived, /\u001b\[38;2;4;5;6m.*ARCHIVED/);
});

test("Archived remains the only collapsible cockpit section", () => {
  const sessions = [
    session("active", "default", "running", "active"),
    { ...session("backlog", "default", "idle", "backlog"), bucket: "backlog" as const },
    { ...session("archived", "default", "stopped", "archived"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const archivedState = buildRenderModel({ sessions, selectedId: "active", collapsedSections: new Set(["archived"]), width: 100 });
  assert.equal(archivedState.sections.find((section) => section.key === "archived")?.collapsed, true);
  assert.equal(archivedState.sections.find((section) => section.key === "archived")?.sessionsTotal, 1);
  assert.equal(archivedState.sections.find((section) => section.key === "archived")?.groups.length, 0);
  assert.match(renderSessions(archivedState).lines.map(stripAnsi).join("\n"), /▸ ARCHIVED/);
});

test("cockpit tier headers keep a shared title column", () => {
  const sessions = [
    session("active", "default", "running", "active"),
    session("quiet", "default", "idle", "quiet"),
    { ...session("archived", "default", "stopped", "archived"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const lines = renderSessions(buildRenderModel({ sessions, width: 100 })).lines.map(stripAnsi);
  const active = lines.find((line) => line.includes("── ACTIVE")) ?? "";
  const quiet = lines.find((line) => line.includes("── QUIET")) ?? "";
  const archived = lines.find((line) => line.includes("ARCHIVED") && /─[▾▸] /.test(line)) ?? "";
  assert.equal(active.indexOf("── ACTIVE"), quiet.indexOf("── QUIET"));
  assert.equal(active.indexOf("── ACTIVE"), archived.indexOf("─▾ ARCHIVED"));
  assert.match(active, /── ACTIVE/);
  assert.match(quiet, /── QUIET/);
  assert.match(archived, /─▾ ARCHIVED/);
});

test("filter reveals rows in collapsed lifecycle sections without changing state", () => {
  const archived = { ...session("archived", "default", "stopped", "needle"), bucket: "archived" as const, bucketChangedAt: 1 };
  const model = buildRenderModel({ sessions: [archived], selectedId: "archived", collapsedSections: new Set(["archived"]), filter: "needle", width: 100 });
  assert.equal(model.sections[0]?.collapsed, true);
  assert.equal(model.sections[0]?.groups[0]?.sessions[0]?.title, "needle");
  assert.match(renderSessions(model).lines.map(stripAnsi).join("\n"), /needle/);
});

test("filter matches across title group cwd basename and status", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api"), session("b", "work", "waiting", "docs")], width: 100, filter: "wait" });
  assert.deepEqual(modelRows(model).map((row) => row.id), ["b"]);
});

test("board filter matches workflow ticket ids after compact titles replace ticket-prefixed names", () => {
  const model = buildRenderModel({
    sessions: [{ ...session("a", "default", "idle", "Rich workflow board"), workflow: WORKFLOW }],
    selectedId: "a",
    grouping: "stage",
    width: 60,
    filter: "auth-003",
  });
  assert.equal(model.noMatches, false);
  assert.equal(model.selected?.id, "a");
});

test("multi-repo pinned sessions keep repo and worktree row identity", () => {
  const multi = {
    ...session("a", "default", "idle", "api"),
    cwd: "/repo/api",
    additionalCwds: ["/repo/web", "/repo/shared"],
    workspaceCwd: "/state/workspaces/a",
    worktreeBranch: "feature/api",
  };
  const model = workspaceModel({ sessions: [multi], selectedId: "a", width: 120, filter: "shared", pinSlots: ["a"] });

  assert.equal(model.selected?.repoCount, 3);
  const rendered = renderSessions(model, { ...darkTheme, accent: "#010203" }).lines.join("\n");
  const plain = stripAnsi(rendered);
  assert.match(plain, /○ ▢1 ⎇ api ⧉ 3/);
  assert.doesNotMatch(plain, /\[3 repos\]/);
  assert.match(rendered, /\u001b\[38;2;1;2;3m⎇/);
  assert.doesNotMatch(rendered, /extra\s+\/repo\/web/);
  assert.doesNotMatch(rendered, /runtime\s+\/state\/workspaces\/a/);
});


test("selected title and status render inline on the same line", () => {
  const model = workspaceModel({ sessions: [session("a", "default", "running", "c-bridge")], selectedId: "a", width: 200 });
  const rendered = renderSessions(model).lines.map(stripAnsi).join("\n");
  const titleLine = rendered.split("\n").find((line) => /│c-bridge\s+● running/.test(line));
  assert.ok(titleLine, "expected an inline title row in the right pane");
  assert.match(titleLine!, /c-bridge\s{1,}● running/);
});


test("long selected title preserves inline status", () => {
  const model = workspaceModel({ sessions: [session("a", "default", "waiting", "selected-title-".repeat(10))], selectedId: "a", width: 80 });
  const lines = renderSessions(model).lines;
  const titleLine = lines.find((line) => line.includes("◐ waiting") && !line.includes("▌"));
  assert.ok(titleLine, "expected selected details to keep the status badge");
  assert.match(stripAnsi(titleLine!), /…\s+◐ waiting/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 80, line);
});


test("model.height pads body rows so the box fills the terminal", () => {
  const lines = renderSessions(buildRenderModel({
    sessions: [session("a", "default", "idle", "api")],
    selectedId: "a",
    width: 120,
    height: 30,
  })).lines;
  assert.equal(lines.length, 30);
});


test("narrow rows drop oversized group metadata before the session title", () => {
  const group = "long-group-name-that-overflows-".repeat(4);
  const sessions = [
    { ...session("a", group, "running", "running-title"), cwd: "/r/a" },
    { ...session("b", group, "waiting", "waiting-title"), cwd: "/r/b" },
    { ...session("c", group, "error", "error-title"), cwd: "/r/c" },
  ];
  const lines = renderSessions(buildRenderModel({ sessions, width: 50 })).lines.map(stripAnsi);
  assert.ok(lines.some((line) => line.includes("running-title")));
  assert.ok(lines.some((line) => line.includes("waiting-title")));
  assert.ok(lines.some((line) => line.includes("error-title")));
  assert.equal(lines.some((line) => line.includes(group)), false);
  for (const line of lines) assert.ok(visibleWidth(line) <= 50, line);
});


test("fixed row badges cannot preserve metadata by crowding out the title", () => {
  const parent = {
    ...session("parent", "engineering-x", "waiting", "Authoritative title"),
    additionalCwds: ["/repo/two", "/repo/three"],
    worktreeBranch: "feature/cockpit",
    context: { version: 1 as const, updatedAt: 1, attention: { kind: "question" as const, text: "Review this" } },
  };
  const child = { ...session("child", "engineering-x", "idle", "worker"), kind: "subagent" as const, parentId: "parent" };
  const lines = renderSessions(buildRenderModel({
    sessions: [parent, child], selectedId: "parent", width: 40,
    pinSlots: ["parent"],
  })).lines.map(stripAnsi);
  const row = lines.find((line) => line.includes("Authoritative title")) ?? "";

  assert.match(row, /Authoritative title/);
  assert.doesNotMatch(row, /engineering-x/);
  assert.equal(visibleWidth(row), 40);
});


test("group row tags remain visible when space permits", () => {
  const group = "release-group";
  const lines = renderSessions(buildRenderModel({ sessions: [session("a", group, "idle", "release")], width: 100 })).lines.map(stripAnsi);
  const titleIndex = lines.findIndex((line) => /▌│ ·\s+○ release/.test(line));
  assert.notEqual(titleIndex, -1);
  assert.match(lines.slice(titleIndex, titleIndex + 2).join("\n"), /release[\s\S]*release-group/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 100, line);
});


test("filter with zero matches renders no-match state", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "idle", "api")], width: 100, filter: "zzz" });
  assert.equal(model.noMatches, true);
  const rendered = renderSessions(model).lines.join("\n");
  assert.match(rendered, /FLEET\s+0\/1 trees · filter: zzz/);
  assert.match(rendered, /No sessions match/);
  assert.match(rendered, /▶ Use the footer controls below/);
});

test("starting displays and counts as running", () => {
  const model = buildRenderModel({ sessions: [session("a", "default", "starting")], width: 100 });
  assert.equal(model.selected?.displayStatus, "running");
  assert.deepEqual(model.summary.statusCounts, { running: 1, waiting: 0, idle: 0, error: 0, stopped: 0 });
});

test("selection retention chooses next sibling without jumping groups", () => {
  const previous = [session("a", "default", "idle"), session("b", "default", "idle"), session("c", "work", "idle")];
  const next = [session("a", "default", "idle"), session("c", "work", "idle")];
  assert.equal(retainSelectionAfterRefresh(previous, next, "b"), "a");
});

test("subagent rows render directly under their parent", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "scout child"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "scout",
    taskPreview: "read auth.ts",
  };
  const sibling = session("sibling", "default", "idle", "web");
  const model = buildRenderModel({ sessions: [parent, sibling, child], width: 120, expandedProjectParentIds: new Set(["parent"]) });

  assert.deepEqual(modelRows(model).map((item) => item.id), ["parent", "child", "sibling"]);
  assert.equal(modelRows(model)[1]?.depth, 1);
  const lines = renderSessions(model).lines.join("\n");
  assert.match(lines, /└─\s+● scout/);
  assert.match(lines, /scout read auth\.ts/);
});

test("nested subagent rows render under their subagent parent", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "worker"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "worker",
  };
  const grandchild = {
    ...session("grandchild", "default", "waiting", "critic"),
    kind: "subagent" as const,
    parentId: "child",
    agentName: "code-critic",
  };
  const model = buildRenderModel({ sessions: [parent, grandchild, child], width: 120, expandedProjectParentIds: new Set(["parent"]) });

  assert.deepEqual(modelRows(model).map((item) => item.id), ["parent", "child", "grandchild"]);
  assert.equal(modelRows(model)[1]?.depth, 1);
  assert.equal(modelRows(model)[2]?.depth, 2);
  assert.match(renderSessions(model).lines.join("\n"), /└─\s+● worker[\s\S]*│└\s+◐ code-critic/);
});

test("filtering by nested child includes ancestor context", () => {
  const parent = session("parent", "default", "idle", "api");
  const child = {
    ...session("child", "default", "running", "scout child"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "scout",
  };
  const grandchild = {
    ...session("grandchild", "default", "waiting", "critic child"),
    kind: "subagent" as const,
    parentId: "child",
    agentName: "code-critic",
    taskPreview: "unique nested task",
  };
  const model = buildRenderModel({ sessions: [parent, child, grandchild, session("other", "default", "idle", "web")], width: 120, filter: "unique" });

  assert.deepEqual(modelRows(model).map((item) => item.id), ["parent", "child", "grandchild"]);
});

test("producer plan projection stays Active-main-only", () => {
  const withPlan = (row: ReturnType<typeof session>, completed: number) => ({
    ...row,
    workflow: { ...WORKFLOW, plan: { tasks: { completed, total: 3 }, nextStep: `Next ${row.id}` } },
  });
  const active = withPlan(session("active", "agents", "waiting", "Stored active title"), 2);
  const sibling = withPlan(session("sibling", "agents", "idle", "Stored sibling title"), 1);
  const child = { ...withPlan(session("child", "agents", "idle", "Child title"), 1), kind: "subagent" as const, parentId: "active", agentName: "worker" };
  const backlog = { ...withPlan(session("backlog", "agents", "idle", "Backlog title"), 1), bucket: "backlog" as const };

  const model = buildRenderModel({ sessions: [active, sibling, child, backlog], selectedId: "active", width: 120 });
  const rows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));
  assert.deepEqual(rows.find((row) => row.id === "active")?.plan?.tasks, { completed: 2, total: 3 });
  assert.deepEqual(rows.find((row) => row.id === "sibling")?.plan?.tasks, { completed: 1, total: 3 });
  assert.equal(rows.find((row) => row.id === "child")?.plan, undefined);
  assert.equal(rows.find((row) => row.id === "backlog")?.plan, undefined);
});

test("adaptive richness stays Active-main-only and ANSI width safe", () => {
  const rich = (row: ReturnType<typeof session>, label: string) => ({
    ...row,
    workflow: { ...WORKFLOW, ticketId: `${row.id}-001`, activity: { id: `activity-${row.id}`, label } },
    context: { version: 1 as const, updatedAt: 2, ticket: { id: `${row.id}-001`, subtitle: `${label} subtitle` } },
  });
  const parent = rich(session("parent", "agents", "waiting", "Parent title"), "Parent activity");
  const child = { ...rich(session("child", "agents", "idle", "Child title"), "Child activity"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const backlog = { ...rich(session("backlog", "agents", "idle", "Backlog title"), "Backlog activity"), bucket: "backlog" as const };
  const archived = { ...rich(session("archived", "agents", "stopped", "Archived title"), "Archived activity"), bucket: "archived" as const, bucketChangedAt: 1 };

  for (const width of [40, 60, 80, 120]) {
    const layout = renderSessions(buildRenderModel({ sessions: [parent, child, backlog, archived], selectedId: "parent", width, expandedProjectParentIds: new Set(["parent"]) }), darkTheme);
    const text = layout.lines.map(stripAnsi).join("\n");
    assert.match(text, /Parent activity|#parent-001/);
    assert.doesNotMatch(text, /Child activity|Backlog activity|Archived activity|#child-001|#backlog-001|#archived-001/);
    assert.match(text, width >= 100 ? /▌│ ▾\s+◐ Parent title/ : /▌ ▾\s+◐ Parent title/);
    assert.match(text, /└─\s+○ worker/);
    assert.match(text, /·\s+○ Backlog/);
    assert.match(text, /- Archived title/);
    for (const line of layout.lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
});

test("adaptive list preserves selected height-neighbor windowing", () => {
  const sessions = Array.from({ length: 6 }, (_, index) => ({
    ...session(`s${index}`, "agents", "running", `Stored session ${index}`),
    workflow: { ...WORKFLOW, ticketId: `scan-${index}`, activity: { id: `scan-${index}`, label: `Activity ${index}` } },
  }));
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "s3", width: 120, height: 12 }));
  const text = layout.lines.map(stripAnsi).join("\n");
  assert.equal(layout.listWidth, 100);
  assert.match(text, /Stored session 3/);
  assert.match(text, /Stored session [24]/);
  assert.equal(layout.rowTargets.filter((target) => target?.kind === "session" && target.id === "s3").length, 1);
  assert.equal(layout.rowTargets.filter((target) => target?.kind === "session-continuation" && target.id === "s3").length, 1);
  assert.equal(layout.lines.length, 12);

  const clipped = renderSessions(buildRenderModel({ sessions: [sessions[0]!], selectedId: "s0", width: 60, height: 8 }));
  assert.match(clipped.lines.map(stripAnsi).join("\n"), /Stored session 0/);
  assert.equal(clipped.rowTargets.filter((target) => target?.kind === "session-continuation" && target.id === "s0").length, 0);

  const spare = renderSessions(buildRenderModel({ sessions: sessions.slice(0, 2), selectedId: "s0", width: 60, height: 12 }));
  const spareText = spare.lines.map(stripAnsi).join("\n");
  assert.match(spareText, /Stored session 1/);
  assert.doesNotMatch(spareText, /Activity 1/);
  const crossGroup = sessions.slice(0, 2).map((row, index) => ({ ...row, group: index ? "beta-project" : "alpha-project" }));
  const grouped = renderSessions(buildRenderModel({ sessions: crossGroup, selectedId: "s1", width: 60, height: 10 }));
  const groupedText = grouped.lines.map(stripAnsi).join("\n");
  assert.match(groupedText, /Stored session 1/);
  assert.doesNotMatch(groupedText, /beta-project/);
});

test("generic attention is gated to waiting/idle and stays searchable on its own subagent", () => {
  const attention = (kind: "ready" | "question" | "blocked", text: string) => ({ version: 1 as const, updatedAt: 2, attention: { kind, text } });
  const sessions = [
    { ...session("ready", "agents", "waiting"), workflow: WORKFLOW, context: attention("ready", "Ready for review") },
    { ...session("question", "agents", "idle"), workflow: WORKFLOW, context: attention("question", "Choose rollout order") },
    { ...session("running", "agents", "running"), workflow: WORKFLOW, context: attention("ready", "Must stay hidden") },
    { ...session("stopped", "agents", "stopped"), workflow: WORKFLOW, context: attention("blocked", "Must stay hidden") },
  ];
  const model = buildRenderModel({ sessions, grouping: "stage", width: 80 });
  const rows = model.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));
  assert.equal(rows.find((row) => row.id === "ready")?.attention?.kind, "ready");
  assert.equal(rows.find((row) => row.id === "question")?.attention?.kind, "question");
  assert.equal(rows.find((row) => row.id === "running")?.attention, undefined);
  assert.equal(rows.find((row) => row.id === "stopped")?.attention, undefined);
  const output = renderSessions(model, darkTheme).lines.map(stripAnsi).join("\n");
  assert.match(output, /✓ ◐ ready/);
  assert.match(output, /\? ○ question/);
  assert.doesNotMatch(output, /✓ ● running|! - stopped/);

  const projectCompact = renderSessions(buildRenderModel({ sessions, grouping: "project", width: 80 }), darkTheme).lines.map(stripAnsi).join("\n");
  assert.match(projectCompact, /✓ ◐ ready/);
  assert.match(projectCompact, /\? ○ question/);
  const projectCards = renderSessions(buildRenderModel({ sessions, grouping: "project", width: 80 }), darkTheme).lines.map(stripAnsi).join("\n");
  assert.match(projectCards, /✓ ◐ ready/);
  assert.match(projectCards, /\? ○ question/);

  const parent = { ...session("parent", "agents", "waiting"), workflow: WORKFLOW };
  const child = { ...session("child", "agents", "waiting"), kind: "subagent" as const, parentId: "parent", agentName: "worker", context: attention("blocked", "Needs sandbox access") };
  const filtered = buildRenderModel({ sessions: [parent, child], filter: "sandbox", grouping: "stage", width: 80 });
  const filteredRows = filtered.sections.flatMap((section) => section.groups.flatMap((group) => group.sessions));
  assert.equal(filteredRows.find((row) => row.id === "parent")?.attention, undefined);
  assert.equal(filteredRows.find((row) => row.id === "child")?.attention?.text, "Needs sandbox access");
});

test("workflowless Active board keeps generic attention and distinct empty states", () => {
  const workflowless = { ...session("plain", "default", "idle"), context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose API version" } } };
  const plain = buildRenderModel({ sessions: [workflowless], grouping: "stage", width: 60 });
  assert.equal(plain.noBoardSessions, false);
  assert.deepEqual(plain.sections.map((section) => section.key), ["other-active"]);
  assert.match(renderSessions(plain).lines.map(stripAnsi).join("\n"), /WORKFLOW\s+1 Active tree · 1 needs you[\s\S]*OTHER ACTIVE[\s\S]*\? ○ plain/);

  const sessions = [{ ...session("backlog", "default", "idle"), bucket: "backlog" as const, workflow: WORKFLOW }];
  const empty = buildRenderModel({ sessions, grouping: "stage", width: 60 });
  assert.equal(empty.noBoardSessions, true);
  assert.match(renderSessions(empty).lines.map(stripAnsi).join("\n"), /No Active sessions[\s\S]*S  return to project view/);
  const filtered = buildRenderModel({ sessions, grouping: "stage", width: 60, filter: "backlog" });
  assert.equal(filtered.noMatches, true);
  assert.match(renderSessions(filtered).lines.map(stripAnsi).join("\n"), /No sessions match "backlog"/);
});

test("filter matches generic context and deterministic producer plan", () => {
  const context = buildRenderModel({
    sessions: [{ ...session("a", "default", "idle", "api"), context: { version: 1 as const, updatedAt: 2, ticket: { id: "context-001", description: "Implement generic context filtering" } } }, session("b", "default", "idle", "docs")],
    width: 100, filter: "generic context",
  });
  assert.equal(modelRows(context)[0]?.id, "a");
  const plan = buildRenderModel({
    sessions: [{ ...session("a", "default", "idle", "api"), workflow: { ...WORKFLOW, plan: { phase: { title: "Render cards", index: 2, count: 3 }, nextStep: "Check narrow widths" } } }, session("b", "default", "idle", "docs")],
    width: 100, filter: "narrow",
  });
  assert.equal(modelRows(plan)[0]?.id, "a");
});

test("action workspace follows frozen Layer 05 order across responsive widths", () => {
  const now = 120_000;
  const parent = {
    ...session("parent", "Release", "waiting", "Release decision"),
    context: {
      version: 1 as const,
      updatedAt: now - 12_000,
      ticket: { id: "release-019", subtitle: "Package the macOS release", description: "Ship once notarization and installer smoke checks pass." },
      attention: { kind: "question" as const, text: "Approve the package rollout?" },
    },
    workflow: WORKFLOW,
  };
  const child = { ...session("child", "Release", "running", "designer"), kind: "subagent" as const, parentId: "parent", agentName: "frontend-designer", taskPreview: "Review cockpit geometry" };

  for (const width of [40, 60, 100, 120, 160]) {
    const model = workspaceModel({ sessions: [parent, child], selectedId: "parent", width, now, workspaceEvidenceVisible: true });
    const layout = renderSessions(model, darkTheme);
    const text = layout.lines.map(stripAnsi).join("\n");
    const positions = ["SELECTED SESSION", "? QUESTION", "RECOMMENDED NEXT", "CONTEXT", "STATE", "LIVE EVIDENCE", "WORKFLOW", "TREE"].map((label) => text.indexOf(label));
    assert.ok(positions.every((position) => position >= 0), `${width}: ${positions.join(",")}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${width}: block order`);
    assert.match(text, /producer context · 12s ago/);
    assert.doesNotMatch(text, /context.*stale|raw pane|preview/i);
    assert.ok(layout.workspaceRowTargets.filter(Boolean).length >= 3);
    for (const line of layout.lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
});

test("workspace evidence preserves workflow provenance without duplicating Explain status", () => {
  const selected = {
    ...session("api", "default", "error", "api"),
    error: "build failed",
    workflow: WORKFLOW,
    statusEvidence: {
      observedAt: 20_000,
      reason: "heartbeat-error" as const,
      tmux: { state: "present" as const },
      heartbeat: { freshness: "fresh" as const, state: "error" as const, updatedAt: 19_000 },
      acknowledgement: { state: "not-applicable" as const },
      workflow: { source: "retained" as const, activeIndex: 1, stepCount: 5, stepLabel: "Execute" },
    },
  };
  const text = renderSessions(workspaceModel({ sessions: [selected], selectedId: "api", width: 160, now: 20_000, workspaceEvidenceVisible: true })).lines.map(stripAnsi).join("\n");
  assert.equal(text.match(/Explain status/g)?.length, 1);
  assert.match(text, /workflow  · producer step 2\/5 · Execute ·[\s\S]*retained from last fresh heartbeat/);
});

test("attention-only producer context reports provenance instead of absence", () => {
  const now = 30_000;
  const selected = {
    ...session("api", "default", "waiting", "api"),
    context: { version: 1 as const, updatedAt: 20_000, attention: { kind: "question" as const, text: "Choose the rollout" } },
  };
  const text = renderSessions(workspaceModel({ sessions: [selected], selectedId: "api", width: 160, now })).lines.map(stripAnsi).join("\n");
  assert.match(text, /CONTEXT · bounded producer fields/);
  assert.match(text, /producer context · 10s ago/);
  assert.doesNotMatch(text, /no producer context/);
});

test("subagent workspace keeps producer task and owner context without promotion", () => {
  const owner = { ...session("owner", "agents", "idle", "Owner session"), workflow: WORKFLOW };
  const child = { ...session("child", "agents", "idle", "worker"), kind: "subagent" as const, parentId: "owner", agentName: "worker", taskPreview: "Inspect the API boundary" };
  const layout = renderSessions(workspaceModel({ sessions: [owner, child], selectedId: "child", width: 160, expandedProjectParentIds: new Set(["owner"]) }));
  const text = layout.lines.map(stripAnsi).join("\n");
  assert.match(text, /CONTEXT · subagent task/);
  assert.match(text, /Inspect the API boundary/);
  assert.match(text, /subagent of Owner session/);
  assert.match(text, /Let the owner coordinate this task/);
  assert.match(text, /✓ PL─◉ EX─· RV─· RF─· CM · auth-003/);
  assert.doesNotMatch(text, /idle · NEEDS YOU/);
});

test("workspace height pruning removes hidden action targets", () => {
  const selected = session("api", "default", "idle", "api");
  for (const height of [8, 12, 18]) {
    const layout = renderSessions(workspaceModel({ sessions: [selected], selectedId: "api", width: 60, height, workspaceEvidenceVisible: true }));
    assert.equal(layout.lines.length, height);
    const text = layout.lines.map(stripAnsi).join("\n");
    assert.match(text, /Open/);
    assert.match(text, /next[: ·]/);
    if (height === 8) assert.match(text, /live evidence unavailable/);
    else assert.match(text, /LIVE EVIDENCE/);
    if (height >= 12) assert.match(text, /Actions/);
    assert.equal(layout.lines.length, layout.workspaceRowTargets.length);
    for (const [index, target] of layout.workspaceRowTargets.entries()) {
      if (target) assert.match(stripAnsi(layout.lines[index] ?? ""), /Open|Send text|Archive|Actions/);
    }
  }
});

test("generic context and producer attention define canonical parent hierarchy", () => {
  const named = {
    ...session("named", "agents", "waiting", "Canonical Name"),
    workflow: {
      ...WORKFLOW,
      ticketId: "metadata-redesign-001",
      activity: { id: "critic-review", label: "Reviewing implementation", pass: 2 },
      plan: { phase: { title: "Hub bridge", index: 2, count: 4 }, tasks: { completed: 8, total: 11 } },
    },
    context: {
      version: 1 as const,
      updatedAt: 2,
      ticket: { id: "metadata-redesign-001", subtitle: "Simplify session context", description: "Use one generic contract across the dashboard." },
      attention: { kind: "question" as const, text: "Choose the rollout order" },
    },
  };
  const model = workspaceModel({ sessions: [named], selectedId: "named", width: 160, grouping: "project", now: 2 });
  const output = stripAnsi(renderSessions(model, darkTheme).lines.join("\n"));
  assert.match(output, /Canonical Name/);
  assert.match(output, /#metadata-redesign-001 · agents/);
  assert.match(output, /Simplify session context/);
  assert.doesNotMatch(output, /Reviewing implementation \(pass 2\)/);
  assert.doesNotMatch(output, /ticket:/);
  assert.match(output, /CONTEXT · bounded producer fields/);
  assert.match(output, /Use one generic contract/);
  assert.match(output, /\? QUESTION[\s\S]*Choose the rollout order/);
});

test("activity-free alternate producer workflows show the adaptive plan grid", () => {
  const neutral = {
    ...session("neutral", "agents", "idle", "Neutral workflow"),
    workflow: {
      steps: [{ id: "draft", short: "DR", label: "Draft" }, { id: "ship", short: "SH", label: "Ship" }],
      activeIndex: 1,
      plan: { tasks: { completed: 3, total: 4 }, phases: [{ completed: 2, total: 2 }, { completed: 1, total: 2 }] },
      updatedAt: 2,
    },
  };
  const output = stripAnsi(renderSessions(buildRenderModel({ sessions: [neutral], selectedId: "neutral", grouping: "stage", width: 100 }), darkTheme).lines.join("\n"));
  assert.match(output, /■■■■■■□□ 3\/4/);

  const large = {
    ...neutral,
    workflow: { ...neutral.workflow, plan: { tasks: { completed: 5_000, total: 10_000 }, phases: Array.from({ length: 100 }, () => ({ completed: 50, total: 100 })) } },
  };
  const fallback = stripAnsi(renderSessions(buildRenderModel({ sessions: [large], selectedId: "neutral", grouping: "stage", width: 60 }), darkTheme).lines.join("\n"));
  assert.doesNotMatch(fallback, /■|□|5000\/10000/);
});

test("ticket mismatch suppresses generic subtitle and activity-free workflow shows plan progress", () => {
  const named = {
    ...session("named", "agents", "idle", "Canonical Name"),
    workflow: { ...WORKFLOW, ticketId: "runtime-001", plan: { phase: { title: "Bridge", index: 2, count: 3 }, tasks: { completed: 5, total: 8 }, phases: [{ completed: 3, total: 3 }, { completed: 2, total: 3 }, { completed: 0, total: 2 }] } },
    context: { version: 1 as const, updatedAt: 2, ticket: { id: "other-001", subtitle: "Must not combine" } },
  };
  const model = buildRenderModel({ sessions: [named], selectedId: "named", grouping: "stage", width: 100 });
  const output = stripAnsi(renderSessions(model, darkTheme).lines.join("\n"));
  assert.match(output, /#runtime-001/);
  assert.doesNotMatch(output, /Must not combine/);
  assert.match(output, /■■■■■□□□ 5\/8/);
});
test("adaptive cockpit uses full parents, micro children, and single lifecycle rows", () => {
  const parent = {
    ...session("parent", "agents", "waiting", "Release decision"),
    workflow: { ...WORKFLOW, ticketId: "cockpit-008" },
    context: { version: 1 as const, updatedAt: 2, ticket: { id: "cockpit-008", subtitle: "Unify the adaptive cockpit" }, attention: { kind: "question" as const, text: "Use the approved card hierarchy?" } },
  };
  const child = { ...session("child", "agents", "running", "worker"), kind: "subagent" as const, parentId: "parent", agentName: "frontend-designer", taskPreview: "Review cockpit hierarchy geometry", workflow: WORKFLOW };
  const backlog = { ...session("backlog", "experiments", "idle", "Theme spike"), bucket: "backlog" as const, workflow: WORKFLOW };
  const archived = { ...session("archived", "docs", "stopped", "Old notes"), bucket: "archived" as const, bucketChangedAt: 1, workflow: WORKFLOW };
  const model = buildRenderModel({ sessions: [parent, child, backlog, archived], selectedId: "parent", width: 100, expandedProjectParentIds: new Set(["parent"]) });
  const text = stripAnsi(renderSessions(model, darkTheme).lines.join("\n"));

  assert.match(text, /▌│ ▾ \? ◐ .*Release decision/);
  assert.match(text, /“Use the approved card hierarchy\?”/);
  assert.match(text, /#cockpit-008 · agents/);
  assert.match(text, /└─  .*● .*frontend-designer Review cockpit hierarchy geometry/);
  assert.doesNotMatch(text, /frontend-designer.*EX|frontend-designer.*agents/);
  assert.equal(text.match(/Theme spike/g)?.length, 1);
  assert.equal(text.match(/Old notes/g)?.length, 1);
});

test("project tier navigator is independent, responsive, and keeps zero tiers", () => {
  const needs = { ...session("needs", "docs", "waiting", "Needs answer"), context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } } };
  const active = session("active", "default", "running", "Active work");
  const model = buildRenderModel({ sessions: [needs, active], selectedId: "active", width: 100 });
  assert.deepEqual(model.cockpitNavigation.map((entry) => [entry.tier, entry.ownerCount, entry.selected]), [
    ["needs-you", 1, false], ["health", 0, false], ["active", 1, true], ["quiet", 0, false], ["archived", 0, false],
  ]);
  const layout = renderSessions(model, darkTheme);
  const text = stripAnsi(layout.lines.join("\n"));
  assert.equal(layout.navigatorWidth, 16);
  assert.equal(layout.listStartX, 19);
  assert.equal(layout.listWidth, 81);
  assert.match(text, /FLEET/);
  assert.match(text, /NEEDS YOU\s+1/);
  assert.match(text, /HEALTH\s+0/);

  const wide = renderSessions(workspaceModel({ sessions: [needs, active], selectedId: "active", width: 120 }), darkTheme);
  assert.equal(wide.navigatorWidth, 17);
  assert.equal(wide.listStartX, 20);
  assert.equal(wide.listWidth, 65);
  assert.equal(wide.workspaceStartX, 86);
  const ultra = renderSessions(workspaceModel({ sessions: [needs, active], selectedId: "active", width: 160 }), darkTheme);
  assert.equal(ultra.navigatorWidth, 17);
  assert.equal(ultra.listWidth, 95);
  assert.equal(ultra.workspaceStartX, 116);

  const narrow = renderSessions(buildRenderModel({ sessions: [needs, active], selectedId: "active", width: 60 }), darkTheme);
  assert.equal(narrow.navigatorWidth, 0);
  assert.equal(narrow.listStartX, 2);
  for (const [width, expected] of [[40, 0], [59, 0], [60, 0], [99, 0], [100, 16], [119, 16], [120, 17], [159, 17], [160, 17]] as const) {
    const responsive = renderSessions(buildRenderModel({ sessions: [needs, active], selectedId: "active", width }), darkTheme);
    assert.equal(responsive.navigatorWidth, expected, `width ${width}`);
    for (const line of responsive.lines) assert.equal(visibleWidth(line), width, `width ${width}: ${line}`);
  }
  assert.equal(renderSessions(buildRenderModel({ sessions: [needs, active], selectedId: "active", grouping: "stage", width: 100 })).navigatorWidth, 0);
  assert.equal(renderSessions(buildRenderModel({ sessions: [needs, active], selectedId: "active", pinSlots: ["active"], width: 100 })).navigatorWidth, 0);
  assert.equal(renderSessions(workspaceModel({ sessions: [needs, active], selectedId: "active", width: 100 })).navigatorWidth, 0);
});

test("tier navigator stays composed for filtered no-match and standalone subagent owners", () => {
  const parent = session("parent", "default", "idle", "Parent");
  const orphan = { ...session("orphan", "default", "running", "Orphan"), kind: "subagent" as const, parentId: "missing", agentName: "scout", taskPreview: "Inspect orphan handling" };
  const orphanModel = buildRenderModel({ sessions: [parent, orphan], selectedId: "parent", width: 100 });
  const active = orphanModel.cockpitNavigation.find((entry) => entry.tier === "active");
  assert.equal(active?.ownerCount, 1);
  assert.equal(active?.firstOwnerId, "orphan");

  const filtered = buildRenderModel({ sessions: [parent, orphan], selectedId: "parent", width: 100, filter: "no-such-session" });
  assert.equal(filtered.noMatches, true);
  assert.deepEqual(filtered.cockpitNavigation.map((entry) => entry.ownerCount), [0, 0, 0, 0, 0]);
  const layout = renderSessions(filtered, darkTheme);
  const text = stripAnsi(layout.lines.join("\n"));
  assert.equal(layout.navigatorWidth, 16);
  assert.match(text, /FLEET/);
  assert.match(text, /No sessions match "no-such-session"/);
});

test("workflow board uses activity plus an eight-cell square progress bar", () => {
  const row = {
    ...session("release", "release", "running", "Release checks"),
    workflow: {
      ...WORKFLOW,
      ticketId: "release-008",
      activity: { id: "verify", label: "Verify package" },
      plan: { tasks: { completed: 3, total: 4 } },
    },
  };
  const wide = stripAnsi(renderSessions(buildRenderModel({ sessions: [row], grouping: "stage", width: 100 }), darkTheme).lines.join("\n"));
  assert.match(wide, /Verify package.*■■■■■■□□ 3\/4/);
  const longActivity = { ...row, workflow: { ...row.workflow, activity: { id: "long", label: "Verify a very long package compatibility matrix before release" } } };
  const longText = stripAnsi(renderSessions(buildRenderModel({ sessions: [longActivity], grouping: "stage", width: 100 }), darkTheme).lines.join("\n"));
  assert.match(longText, /Verify a very long.*■■■■■■□□ 3\/4/);
  const narrow = stripAnsi(renderSessions(buildRenderModel({ sessions: [row], grouping: "stage", width: 60 }), darkTheme).lines.join("\n"));
  assert.doesNotMatch(narrow, /Verify package|■|□|release-008/);

  const progressOnly = { ...row, workflow: { ...row.workflow, activity: undefined, plan: { tasks: { completed: 1, total: 3 } } } };
  const progressText = stripAnsi(renderSessions(buildRenderModel({ sessions: [progressOnly], grouping: "stage", width: 100 }), darkTheme).lines.join("\n"));
  assert.match(progressText, /■■■□□□□□ 1\/3/);

  const noTotal = { ...row, workflow: { ...row.workflow, activity: undefined, plan: { tasks: { completed: 0, total: 0 } } } };
  const noTotalText = stripAnsi(renderSessions(buildRenderModel({ sessions: [noTotal], grouping: "stage", width: 100 }), darkTheme).lines.join("\n"));
  assert.doesNotMatch(noTotalText, /■|□|0\/0/);
});
