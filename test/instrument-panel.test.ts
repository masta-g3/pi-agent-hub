import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { mergeUsageSnapshots, parseUsageSnapshot } from "../src/core/usage.js";
import { darkTheme, stripAnsi, styleToken, type SessionsTheme } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";
import { usageFixture, USAGE_NOW } from "./usage-fixture.js";

const NOW = USAGE_NOW;
const mocha: SessionsTheme = {
  ...darkTheme, text: "#cdd6f4", muted: "#a6adc8", dim: "#7f849c", border: "#7f849c",
  accent: "#89b4fa", success: "#a6e3a1", warning: "#f9e2af", error: "#f38ba8", selectedBg: "#313244", statusLineBg: "",
};
const tone = (token: "accent" | "success" | "warning" | "error") => styleToken(mocha, token, "x").split("x")[0]!;

const workflow = {
  version: 1 as const, source: "test", activeIndex: 1, updatedAt: NOW,
  steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }],
};

function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title: `Session ${id}`, cwd: "/tmp/hub-repo", group: "panel", tmuxSession: `pi-agent-hub-${id}`,
    status: "running", createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW, ...overrides,
  };
}

function request(kind: "question" | "ready" | "blocked", text: string): Partial<RuntimeSession> {
  return { status: "waiting", context: { version: 1, updatedAt: NOW, attention: { kind, requestId: `r-${kind}`, text } } };
}

const fleet = [
  session("busy", { title: "Busy agent", workflow: { ...workflow, activity: { id: "tests", label: "implementing tests" } } }),
  session("ready", { title: "Ready agent", ...request("ready", "Work is ready for review") }),
  session("blocked", { title: "Blocked agent", ...request("blocked", "Needs a token") }),
  session("done", { title: "Done agent", status: "idle", bucket: "archived", bucketChangedAt: NOW - 1_000, closure: "done" }),
];

function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}, theme: SessionsTheme = mocha) {
  const selectedId = input.selectedId ?? sessions[0]!.id;
  const selected = sessions.find((candidate) => candidate.id === selectedId)!;
  const commands = buildDashboardCommands({ sessions, selectedId, capabilities: { openSession: true, sendMessage: true } });
  return renderSessions(buildRenderModel({
    sessions, selectedId, width: 120, height: 60, now: NOW, guidanceHidden: true,
    workspaceCommands: selectWorkspaceCommands(selected, commands, 3), ...input,
  }), theme);
}

/** Below 100 columns no side pane shares the rows, so the roster is the whole line. */
function sidePane(layout: ReturnType<typeof render>): boolean {
  return layout.lines.some((line, index) => index > 0 && stripAnsi(sliceByColumn(line, layout.listWidth, 1)) === "│")
    && !layout.lines.some((line, index) => index > 0 && /^─{20,}$/u.test(stripAnsi(line).trim()));
}

/** The roster's own part of every line, with its styling; at 100+ the selected card's pane sits right of `│`. */
function rosterRaw(layout: ReturnType<typeof render>): string[] {
  return sidePane(layout) ? layout.lines.map((line) => sliceByColumn(line, 0, layout.listWidth)) : layout.lines;
}

function rosterPlain(layout: ReturnType<typeof render>): string[] {
  return rosterRaw(layout).map((line) => stripAnsi(line).trimEnd());
}

/** The side pane's text per body row (blank rows kept), or undefined when the card docks below the roster. */
function paneLines(layout: ReturnType<typeof render>): string[] | undefined {
  if (!sidePane(layout)) return undefined;
  return layout.lines.map((line) => stripAnsi(sliceByColumn(line, layout.listWidth, visibleWidth(line))))
    .flatMap((line) => line.startsWith("│") ? [line.slice(1).trimEnd()] : []);
}

/** The selected session's card: the side pane at 100+, else the docked rows below the rule. */
function cardText(layout: ReturnType<typeof render>): string[] {
  return paneLines(layout)?.filter((line) => line.trim()) ?? dockLines(layout);
}

/** The roster row of one session, with styling. */
function rosterRow(layout: ReturnType<typeof render>, id: string): string {
  return rosterRaw(layout)[layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id)]!;
}

test("the fleet panel keeps success for live work only", () => {
  const sessions = [
    ...fleet,
    session("child", { kind: "subagent", parentId: "done", agentName: "worker" }),
    session("checked", { title: "Checked agent", status: "idle", acknowledgedAt: NOW, workflow: { ...workflow, activeIndex: 2 } }),
  ];
  const lines = render(sessions).lines;
  const row = (title: string) => lines.find((line) => stripAnsi(line).includes(title))!;
  // Running work stays success: the spinner or dot and running-subagent counts.
  assert.ok(row("Busy agent").includes(tone("success")), "running glyph lost success");
  // Finished marks read as plain text: workflow checks and closed archive rows.
  assert.ok(!lines.filter((line) => stripAnsi(line).includes("✓")).some((line) => line.includes(`${tone("success")}✓`)), "a check mark uses success");
  const board = render(fleet, { grouping: "stage" }).lines.join("\n");
  assert.ok(board.includes(tone("success")), "board lost success");
});

test("every request kind reads as the one signal color in the fleet", () => {
  const layout = render(fleet);
  for (const id of ["ready", "blocked"]) {
    const title = `${id[0]!.toUpperCase()}${id.slice(1)} agent`;
    const line = rosterRow(layout, id);
    assert.ok(line.includes(tone("warning")), `${title} is not warning: ${JSON.stringify(line)}`);
    assert.ok(!line.includes(tone("error")), `${title} reads as a fault`);
  }
  const selected = rosterRow(render(fleet, { selectedId: "blocked" }), "blocked");
  assert.ok(selected.startsWith(tone("warning")) || selected.includes(`${tone("warning")}▌`), JSON.stringify(selected));
});

test("accent marks controls: the mode label, selection stripe and keycaps", () => {
  const lines = render(fleet).lines;
  assert.ok(lines[0]!.includes(styleToken(mocha, "accent", "FLEET")), "mode label");
  assert.ok(lines.some((line) => line.includes(`${tone("accent")}▌`)), "selection stripe");
  const footer = lines.at(-1)!;
  assert.ok(footer.includes(tone("accent")), "footer keycaps");
});

test("quota bars in the fleet header keep the unmodified theme's success color", () => {
  const usage = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
  const header = render(fleet, { usage, width: 200 }).lines[0]!;
  assert.match(stripAnsi(header), /Codex/);
  // The panel palette maps success to text for the fleet; account quotas read in the theme's own tones.
  assert.ok(header.includes(tone("success")), JSON.stringify(header));
});

const faults = ["Catalog Sync", "Map Tiles Export"].map((title, index) =>
  session(`fault${index}`, { title, status: "error", error: index ? "tmux pane dead" : "pi exited 1: ENOSPC" }));

test("tier headings are ruled, with the count in the tier's signal tone", () => {
  for (const width of [120, 46]) {
    const layout = render([...faults, ...fleet], { width });
    const plain = rosterPlain(layout);
    const raw = rosterRaw(layout);
    for (const [label, count] of [["NEEDS YOU", 2], ["HEALTH", 2], ["ACTIVE", 1]] as const) {
      const index = plain.findIndex((line, row) => row > 0 && line.includes(` ${label} ${count} `));
      assert.ok(index >= 0, `${width}: ${label}\n${plain.join("\n")}`);
      assert.match(plain[index]!, new RegExp(`^.── ${label} ${count} ─+$`));
      assert.ok(raw[index]!.length > 0);
    }
    const heading = (label: string) => raw[plain.findIndex((line, row) => row > 0 && line.includes(` ${label} `))]!;
    assert.ok(heading("NEEDS YOU").includes(styleToken(mocha, "warning", "2")));
    assert.ok(heading("HEALTH").includes(styleToken(mocha, "error", "2")));
  }
});

test("a collapsed HEALTH tier folds to its heading like every other tier", () => {
  const layout = render([...faults, ...fleet], { collapsedSections: new Set(["health"]) });
  const plain = rosterPlain(layout);
  assert.match(plain.find((line, row) => row > 0 && line.includes(" HEALTH 2 "))!, /^ ▸─ HEALTH 2 ─+$/);
  assert.ok(!plain.some((line) => /Catalog Sync|Map Tiles Export|ERR/.test(line)), plain.join("\n"));
});

const steps = [["plan", "PL"], ["execute", "EX"], ["review", "RV"], ["reflect", "RF"], ["commit", "CM"]].map(([id, short]) => ({ id: id!, short: short!, label: id! }));
const panelWorkflow = (activeIndex: number, extra: Record<string, unknown> = {}) => ({ version: 1 as const, source: "test", activeIndex, updatedAt: NOW, steps, ...extra });
type Stage = { label: string; state: "done" | "active" | "pending" };
const stagesAt = (labels: string[], active: number): Stage[] => labels.map((label, index) => ({ label, state: index < active ? "done" : index === active ? "active" : "pending" }));
const phases = (count: number, active: number) => stagesAt(Array.from({ length: count }, (_, index) => String(index + 1)), active);
const asking = session("asking", {
  title: "Tile Review", status: "waiting", lastActivityAt: NOW - 600_000,
  context: { version: 1, updatedAt: NOW, attention: { kind: "question", requestId: "q1", text: "Which neighborhood tiles should come first? There are several candidate areas with different data quality and coverage.", recommendation: "North Beach, then Chinatown" } },
  workflow: panelWorkflow(1, { plan: { phase: { title: "Tests", index: 2, count: 5 }, tasks: { completed: 3, total: 8 } },
    lens: { doing: "Write the tile tests", stages: phases(5, 1), progress: { completed: 3, total: 8, unit: "tasks" } } }),
});
const working = session("working", { title: "Tile export", lastActivityAt: NOW - 600_000,
  workflow: panelWorkflow(2, { activity: { id: "r", label: "rendering tiles" }, lens: { doing: "rendering tiles", stages: stagesAt(["review", "fix", "done"], 0) } }) });
const failing = session("failing", { title: "Catalog Sync", status: "error", error: "pi exited 1: ENOSPC", workflow: panelWorkflow(1, { activity: { id: "x", label: "stale activity" } }) });
const resting = session("resting", { title: "Job Status", status: "idle", acknowledgedAt: NOW, workflow: panelWorkflow(4) });
const picked = session("picked", { title: "Picked agent", workflow: panelWorkflow(1, { plan: { phase: { title: "T", index: 5, count: 5 }, tasks: { completed: 19, total: 19 } },
  lens: { stages: phases(5, 5), progress: { completed: 19, total: 19, unit: "tasks" } } }) });
const panelFleet = [picked, asking, working, failing, resting];

/** The docked card's rows below the dock rule. */
function dockLines(layout: ReturnType<typeof render>): string[] {
  const plain = layout.lines.map((line) => stripAnsi(line).trimEnd());
  const rule = plain.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line));
  return rule < 0 ? [] : plain.slice(rule + 1).filter((line, index) => layout.rowTargets[rule + 1 + index]?.kind === "session-continuation");
}

function moduleLines(layout: ReturnType<typeof render>, id: string): string[] {
  const plain = rosterPlain(layout);
  const title = layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id);
  const lines = [plain[title]!];
  for (let index = title + 1; layout.rowTargets[index]?.kind === "session-continuation"; index += 1) lines.push(plain[index]!);
  return lines;
}

test("modules align their field labels and show a field only with a value", () => {
  for (const width of [120, 80, 46]) {
    const layout = render(panelFleet, { width });
    const fields = ["asking", "working", "failing"].flatMap((id) => moduleLines(layout, id).slice(1));
    const labelColumns = new Set(fields.flatMap((line) => {
      const match = /^( *)(ASK|RDY|BLK|ERR|NOW|STEP|SUB)\b/.exec(line);
      return match ? [match[1]!.length] : [];
    }));
    assert.equal(labelColumns.size, 1, `${width}:\n${fields.join("\n")}`);
    for (const line of fields) assert.doesNotMatch(line, /^ *(ASK|RDY|BLK|ERR|NOW|STEP|TASK|PHASE|SUB) *$/);
  }
});

test("an unselected request wraps to a second line and leaves its recommendation to the card", () => {
  const layout = render(panelFleet, { width: 80 });
  const lines = moduleLines(layout, "asking");
  assert.equal(lines.length, 3, lines.join("\n"));
  assert.match(lines[1]!, /^ +ASK {4}Which neighborhood/);
  assert.ok(!lines.some((line) => line.includes("North Beach")), lines.join("\n"));
  const valueColumn = lines[1]!.indexOf("Which");
  assert.equal(lines[2]!.search(/\S/), valueColumn);
  const card = cardText(render(panelFleet, { width: 80, selectedId: "asking" }));
  assert.ok(card.some((line) => /→ North Beach, then Chinatown/.test(line)), card.join("\n"));
});

test("ERR replaces NOW, and WHERE drops the mode, pass, meter, stages, then count as width shrinks", () => {
  const failed = moduleLines(render(panelFleet), "failing");
  assert.ok(failed.some((line) => /ERR {4}pi exited 1: ENOSPC/.test(line)));
  assert.ok(!failed.some((line) => /NOW|stale activity/.test(line)), failed.join("\n"));
  const failedCard = cardText(render(panelFleet, { selectedId: "failing" }));
  assert.ok(failedCard.some((line) => /ERR {4}pi exited 1: ENOSPC/.test(line)), failedCard.join("\n"));
  assert.ok(!failedCard.some((line) => /stale activity/.test(line)), failedCard.join("\n"));
  const where = (width: number, extra: Record<string, unknown> = {}) => {
    const subject = session("where", { title: "Where agent", workflow: panelWorkflow(2, {
      activeMode: { id: "focus", short: "FOC" },
      lens: { doing: "Fixing findings", stages: stagesAt(["review", "fix", "done"], 1), progress: { completed: 3, total: 8 }, pass: 2 }, ...extra }) });
    return cardText(render([subject], { width, selectedId: "where", workspaceEvidenceVisible: true })).find((line) => /^\W*WHERE /.test(line))?.replace(/^▌/u, " ").trim() ?? "";
  };
  // The side pane narrows with the window, so each width shows one more piece dropped.
  assert.equal(where(130), "WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  ▰▰▰▱▱▱▱▱ 3/8  pass 2  FOC");
  assert.equal(where(120), "WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  ▰▰▰▱▱▱▱▱ 3/8  pass 2");
  assert.equal(where(100), "WHERE  PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done·  3/8");
  // Below 80 the rail is the plain step, which names the mode.
  assert.equal(where(60), "WHERE  FOC │ review✓ fix◉ done·  ▰▰▰▱▱▱▱▱ 3/8  pass 2");
  assert.equal(where(46), "WHERE  FOC │ review✓ fix◉ done·  3/8");
  assert.equal(where(30), "WHERE  FOC  3/8");
  // Without a lens WHERE shows the rail only, and DONE/NEXT keep the DOING line's place.
  const bare = session("bare", { title: "Bare", context: { version: 1, updatedAt: NOW, progress }, workflow: panelWorkflow(1, { plan: { tasks: { completed: 3, total: 8 } }, activity: { id: "a", label: "Reviewing" } }) });
  const card = cardText(render([bare], { width: 130, selectedId: "bare" }));
  assert.ok(card.some((line) => /^ *WHERE {2}PL✓ EX◉ RV· RF· CM·$/.test(line)), card.join("\n"));
  assert.ok(card.some((line) => /^ *DONE {3}Roster rows work/.test(line)) && card.some((line) => /^ *NEXT {3}Build the detail pane/.test(line)), card.join("\n"));
  assert.ok(!card.some((line) => /DOING|PLAN|Reviewing|3\/8/.test(line)), card.join("\n"));
  // The roster never carries WHERE.
  for (const width of [120, 80, 46]) {
    const layout = render(panelFleet, { width });
    const dock = dockStart(layout);
    const roster = rosterPlain(layout).slice(0, dock < 0 ? layout.footerRow : dock - 1);
    assert.ok(!roster.some((line) => /WHERE|STEP/.test(line)), `${width}\n${roster.join("\n")}`);
  }
});

test("module title rows end with the age, and only the selection is plated", () => {
  const layout = render(panelFleet);
  assert.match(moduleLines(layout, "working")[0]!, /Tile export .* {2,}10m$/);
  const plate = `\u001b[48;2;49;50;68m`;
  const raw = rosterRaw(layout);
  for (const id of ["asking", "working", "failing"]) {
    const rows = layout.rowTargets.flatMap((target, index) => target && "id" in target && target.id === id ? [raw[index]!] : []);
    assert.ok(rows.length > 1 && rows.every((row) => !row.includes("\u001b[48;")), id);
  }
  const selectedRows = layout.rowTargets.flatMap((target, index) => target && "id" in target && target.id === "picked" ? [raw[index]!] : []);
  assert.ok(selectedRows.length > 1 && selectedRows.every((row) => row.includes(plate)));
  // The side pane is not plated.
  const pane = layout.lines.slice(1, layout.footerRow).map((line) => line.slice(line.lastIndexOf("│")));
  assert.ok(!pane.some((line) => line.includes(plate)), "the side pane sits on the base background");
});

test("quiet agents are modules, archived rows stay one line, and SUB names running subagents only while collapsed", () => {
  const parent = session("parent", { status: "idle", title: "Tile review", acknowledgedAt: NOW });
  const child = (id: string, agentName: string, taskPreview: string) => session(id, { kind: "subagent", parentId: "parent", agentName, taskPreview });
  const sessions = [picked, parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders"), resting];
  const lines = moduleLines(render(sessions), "parent");
  assert.ok(lines.some((line) => /SUB {4}code-critic Review the pixel map/.test(line)), lines.join("\n"));
  const parentCard = cardText(render(sessions, { selectedId: "parent" }));
  assert.ok(parentCard.some((line) => /SUB {4}code-critic · Review the pixel map diff · \+1 more/.test(line)), parentCard.join("\n"));
  const expanded = moduleLines(render(sessions, { expandedProjectParentIds: new Set(["parent"]) }), "parent");
  assert.ok(!expanded.some((line) => /SUB/.test(line)), expanded.join("\n"));
  // A quiet module is its title row with the step short; its card shows where the workflow stands.
  const restingRows = moduleLines(render(sessions), "resting");
  assert.equal(restingRows.length, 1, restingRows.join("\n"));
  assert.match(restingRows[0]!, /Job Status .* CM +now$/);
  assert.ok(cardText(render(sessions, { selectedId: "resting" })).some((line) => /WHERE {2}PL✓ EX✓ RV✓ RF✓ CM◉/.test(line)));
  const archived = session("old", { title: "Old work", status: "stopped", bucket: "archived", bucketChangedAt: NOW - 1_000, workflow: panelWorkflow(1) });
  assert.equal(moduleLines(render([picked, archived]), "old").length, 1);
});

test("the selected card shows DOING and one WHERE line with the producer's stages and count", () => {
  const layout = render(panelFleet, { width: 120, selectedId: "asking" });
  const lines = cardText(layout);
  const ask = lines.findIndex((line) => /^ *ASK /.test(line));
  const doing = lines.findIndex((line) => /^ *DOING {2}Write the tile tests$/.test(line));
  const where = lines.findIndex((line) => /^ *WHERE {2}PL✓ EX◉ RV· RF· CM· │ 1✓ 2◉ 3· 4· 5· {2}▰{3}▱{5} 3\/8$/.test(line));
  assert.ok(ask >= 0 && doing > ask && where > doing, lines.join("\n"));
  assert.ok(!lines.some((line) => /STEP|TASK|PHASE/.test(line)), lines.join("\n"));
  const raw = layout.lines.find((line) => stripAnsi(line).includes("DOING  Write the tile tests"))!;
  assert.ok(raw.includes("\u001b[1m"), "DOING is bold");
  const narrow = dockLines(render(panelFleet, { width: 80, selectedId: "picked" }));
  assert.ok(narrow.some((line) => /WHERE {2}PL✓ EX◉ RV· RF· CM· │ 1✓ 2✓ 3✓ 4✓ 5✓ {2}▰{8} 19\/19/.test(line)), narrow.join("\n"));
});

test("a stopped session with a stale heartbeat keeps its DOING, WHERE and list", () => {
  const stopped = { ...mission, status: "stopped" as const, activity: undefined };
  const card = cardText(render([stopped, ...panelFleet], { width: 130, height: 60, selectedId: "mission" }));
  assert.ok(card.some((line) => /^ *DOING {2}Render the detail pane beside the roster$/.test(line)), card.join("\n"));
  assert.ok(card.some((line) => /^ *WHERE {2}PL✓ EX◉ .* 8\/17$/.test(line)), card.join("\n"));
  assert.ok(card.some((line) => /^ *PLAN {3}Roster and detail pane$/.test(line)), card.join("\n"));
  assert.match(moduleLines(render([picked, stopped], { width: 80 }), "mission")[1]!, /^ +DOING {2}Render the detail pane.* 8\/17$/);
});

test("a lens under any step id renders fully: the card checks no step name", () => {
  const custom = session("custom", { title: "Custom pipeline", workflow: { activeIndex: 0, updatedAt: NOW,
    steps: [{ id: "build", short: "BLD" }, { id: "ship", short: "SHP" }],
    lens: { doing: "Compiling assets", stages: stagesAt(["fetch", "compile"], 1), progress: { completed: 2, total: 4 },
      list: { label: "TARGET", head: "Web bundle", items: [{ state: "done", text: "css" }, { state: "active", text: "js" }, { state: "attention", text: "wasm" }, { state: "skipped", text: "legacy" }], before: 0, after: 0 } } } });
  const card = cardText(render([custom], { width: 130, selectedId: "custom" }));
  assert.ok(card.some((line) => /^ *DOING {2}Compiling assets$/.test(line)), card.join("\n"));
  assert.ok(card.some((line) => /^ *WHERE {2}BLD◉ SHP· │ fetch✓ compile◉ {2}▰{4}▱{4} 2\/4$/.test(line)), card.join("\n"));
  assert.deepEqual(field(card, "TARGET").map((line) => line.trim()), ["TARGET Web bundle", "✓ css", "◉ js", "! wasm", "– legacy"]);
  assert.match(moduleLines(render([picked, custom], { width: 80 }), "custom")[1]!, /^ +DOING {2}Compiling assets.* 2\/4$/);
});

// Lenses as Rules publishes them for Plan during critic review and for a completed two-repo Commit.
const planLens = { doing: "Reviewing plan", stages: stagesAt(["inspect", "scope", "write", "critic", "ready"], 3),
  list: { label: "PLAN", head: "3 phases · 10 tasks · 5 criteria", items: [{ state: "done" as const, text: "4 answered" },
    { state: "attention" as const, text: "1 waiting: Keep the \"Use as reply\" button?" }, { state: "active" as const, text: "critic pass 1" }], before: 0, after: 0 } };
const commitLens = { doing: "Commit complete", stages: stagesAt(["archive", "commit"], 2),
  list: { label: "CLOSE", head: "2 commits", items: [{ state: "done" as const, text: "Plan archived" }, { state: "done" as const, text: "Ticket card-lens-002 done" },
    { state: "done" as const, text: "pi-agent-hub 3f9c2e1 Add step lens contract" }, { state: "done" as const, text: "rules a1b2c3d Publish the workflow lens" }], before: 0, after: 0 } };

test("Plan and completed Commit lenses render their lists at 100 and 160 columns", () => {
  const planning = session("planning", { title: "Plan lenses", status: "waiting", workflow: panelWorkflow(0, { activity: { id: "reviewing-plan", label: "Reviewing plan" }, lens: planLens }) });
  const closed = session("closed", { title: "Commit lenses", status: "idle", workflow: panelWorkflow(4, { currentStepComplete: true, activity: { id: "commit-complete", label: "Commit complete" }, lens: commitLens }) });
  for (const width of [100, 160]) {
    const plan = cardText(render([planning, closed], { width, selectedId: "planning" }));
    assert.ok(plan.some((line) => /^ *DOING {2}Reviewing plan$/.test(line)), plan.join("\n"));
    // The 100-column side pane is too narrow for the stages, so WHERE keeps the rail.
    const planWhere = width === 160 ? / │ inspect✓ scope✓ write✓ critic◉ ready·$/ : /CM·$/;
    assert.ok(plan.some((line) => /^ *WHERE {2}PL◉ EX· RV· RF· CM·/.test(line) && planWhere.test(line)), plan.join("\n"));
    assert.deepEqual(field(plan, "PLAN").map((line) => line.trim()), ["PLAN   3 phases · 10 tasks · 5 criteria", "✓ 4 answered", "! 1 waiting: Keep the \"Use as reply\" button?", "◉ critic pass 1"]);

    const commit = cardText(render([planning, closed], { width, selectedId: "closed" }));
    assert.ok(commit.some((line) => /^ *DOING {2}Commit complete$/.test(line)), commit.join("\n"));
    assert.ok(commit.some((line) => /^ *WHERE {2}PL✓ EX✓ RV✓ RF✓ CM✓ │ archive✓ commit✓$/.test(line)), commit.join("\n"));
    assert.deepEqual(field(commit, "CLOSE").map((line) => line.trim()), ["CLOSE  2 commits", "✓ Plan archived", "✓ Ticket card-lens-002 done",
      "✓ pi-agent-hub 3f9c2e1 Add step lens contract", "✓ rules a1b2c3d Publish the workflow lens"]);
  }
});

// Lenses as Rules publishes them from set_workflow_activity items while fixing findings and while applying candidates.
const reviewLens = { doing: "Parser stall on long backtick runs", stages: stagesAt(["review", "fix", "done"], 1), pass: 2,
  list: { label: "FOUND", head: "2 fixed · 2 open · 1 deferred", items: [{ state: "done" as const, text: "Retry after unknown delivery showed twice" },
    { state: "done" as const, text: "Lost history cursor on empty session" }, { state: "active" as const, text: "Parser stall on long backtick runs" },
    { state: "pending" as const, text: "Failed read dropped loaded history" }, { state: "skipped" as const, text: "Login in a link: deferred" }], before: 0, after: 0 } };
const reflectLens = { doing: "STRUCTURE.md: Markdown safety rule", stages: stagesAt(["review", "update", "done"], 1),
  list: { label: "CANDS", head: "1 applied · 1 now · 1 needs you · 1 no action", items: [{ state: "done" as const, text: "STRUCTURE.md: transcript source" },
    { state: "active" as const, text: "STRUCTURE.md: Markdown safety rule" }, { state: "attention" as const, text: "New ticket: keyboard dock check" },
    { state: "skipped" as const, text: "Retry wording: no change" }], before: 0, after: 0 } };

test("Review and Reflect lenses render their item lists at 100 and 160 columns", () => {
  const reviewing = session("reviewing", { title: "Review lenses", workflow: panelWorkflow(2, { activity: { id: "fixing-review-findings", label: "Fixing findings", pass: 2 }, lens: reviewLens }) });
  const reflecting = session("reflecting", { title: "Reflect lenses", workflow: panelWorkflow(3, { activity: { id: "updating-guidance", label: "Updating guidance" }, lens: reflectLens }) });
  for (const width of [100, 160]) {
    const review = cardText(render([reviewing, reflecting], { width, selectedId: "reviewing" }));
    assert.ok(review.some((line) => /^ *DOING {2}Parser stall on long backtick runs$/.test(line)), review.join("\n"));
    assert.ok(review.some((line) => /^ *WHERE {2}PL✓ EX✓ RV◉ RF· CM· │ review✓ fix◉ done· {2}pass 2$/.test(line)), review.join("\n"));
    assert.deepEqual(field(review, "FOUND").map((line) => line.trim()), ["FOUND  2 fixed · 2 open · 1 deferred", "✓ Retry after unknown delivery showed twice",
      "✓ Lost history cursor on empty session", "◉ Parser stall on long backtick runs", "· Failed read dropped loaded history", "– Login in a link: deferred"]);

    const reflect = cardText(render([reviewing, reflecting], { width, selectedId: "reflecting" }));
    assert.ok(reflect.some((line) => /^ *DOING {2}STRUCTURE\.md: Markdown safety rule$/.test(line)), reflect.join("\n"));
    assert.ok(reflect.some((line) => /^ *WHERE {2}PL✓ EX✓ RV✓ RF◉ CM· │ review✓ update◉ done·$/.test(line)), reflect.join("\n"));
    assert.deepEqual(field(reflect, "CANDS").map((line) => line.trim()), ["CANDS  1 applied · 1 now · 1 needs you · 1 no action", "✓ STRUCTURE.md: transcript source",
      "◉ STRUCTURE.md: Markdown safety rule", "! New ticket: keyboard dock check", "– Retry wording: no change"]);
  }
});

test("without color the LCD keeps labels above values and selection keeps its stripe and keys", () => {
  process.env.NO_COLOR = "1";
  try {
    const layout = render(panelFleet, { width: 120 });
    const card = cardText(layout);
    assert.ok(card.some((line) => /WHERE {2}PL✓ EX◉ RV· RF· CM· │ 1✓ 2✓ 3✓ 4✓ 5✓/.test(line)), card.join("\n"));
    assert.ok(card.some((line) => line.includes("Open in Pi")));
    // The roster row carries the stripe; the side pane has none.
    assert.ok(moduleLines(layout, "picked").every((line) => line.startsWith("▌")), moduleLines(layout, "picked").join("\n"));
    assert.ok(!card.some((line) => line.includes("▌")));
    const docked = dockLines(render(panelFleet, { width: 80 }));
    assert.ok(docked.length && docked.every((line) => line.startsWith("▌")), docked.join("\n"));
    assert.ok(docked.some((line) => line.includes("Open in Pi")));
  } finally {
    delete process.env.NO_COLOR;
  }
});

test("the header fleet meter draws one cell per agent by tier, and each group is its tier chip", () => {
  const layout = render(panelFleet, { width: 120 });
  const header = stripAnsi(layout.lines[0]!);
  assert.match(header, /FLEET .* ● × ◐◐ · {2}5 sessions$/);
  for (const chip of layout.tierChips) {
    const text = header.slice(chip.x - 1, chip.x - 1 + chip.width);
    assert.equal(text, { "needs-you": "●", health: "×", active: "◐◐", quiet: "·" }[chip.tier as string], chip.tier);
  }
  assert.deepEqual(layout.tierChips.map((chip) => chip.tier), ["needs-you", "health", "active", "quiet"]);
  assert.ok(layout.lines[0]!.includes(styleToken(mocha, "warning", "●")));
  assert.ok(layout.lines[0]!.includes(styleToken(mocha, "error", "×")));
});

test("the fleet meter shortens large groups, then everything, before dropping tiers", () => {
  const many = Array.from({ length: 14 }, (_, index) => session(`q${index}`, { status: "idle", acknowledgedAt: NOW, title: `Quiet ${index}` }));
  const sessions = [...panelFleet, ...many];
  assert.match(stripAnsi(render(sessions, { width: 120 }).lines[0]!), /● × ◐◐ ·15 {2}19 sessions$/);
  assert.match(stripAnsi(render(sessions, { width: 30 }).lines[0]!), /FLEET +1 1 2 15 {2}19 sessions$|FLEET +.*19 sessions$/);
  for (const width of [230, 120, 80, 46, 30]) {
    const layout = render(sessions, { width });
    const header = stripAnsi(layout.lines[0]!);
    for (const chip of layout.tierChips) assert.ok(header.slice(chip.x - 1, chip.x - 1 + chip.width).trim().length === chip.width, `${width} ${chip.tier}`);
  }
});

test("crowded modules allocate list details independently of selection", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => session(`s${index}`, {
    workflow: { ...workflow, activity: { id: "work", label: "Working on tests" } },
  }));
  const positions = (selectedId: string) => {
    const layout = render(sessions, { selectedId, width: 120, height: 28 });
    return sessions.map(({ id }) => layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id));
  };
  const first = positions("s0");
  assert.ok(first.every((row) => row >= 0), "every title fits");
  for (const { id } of sessions) assert.deepEqual(positions(id), first, id);
});

test("over-wide workflow readouts retain the current step in the list and dock", () => {
  const steps = Array.from({ length: 10 }, (_, index) => ({ id: `step${index}`, short: `STEP00${index}`, label: `Step ${index}` }));
  const selected = session("long", { workflow: { ...workflow, steps, activeIndex: 9 } });
  for (const width of [80, 100, 120]) {
    const layout = render([selected], { width });
    for (const rows of [moduleLines(layout, "long"), width < 100 ? dockLines(layout) : paneLines(layout)!]) {
      assert.match(rows.join("\n"), /STEP009/, `${width}: ${rows.join("\n")}`);
    }
  }
});

const act = (tool: string, detail: string, ago: number) => ({ tool, detail, at: NOW - ago * 1_000 });
const checklist = ["Sketch roster rows", "Pick status precedence", "Add the heartbeat activity", "Roster rows show one status line",
  "Publish live tool calls in the heartbeat", "Render the detail pane beside the roster", "Show the plan checklist",
  "Keep Answer and Reply inside the pane", "Cap the agent message", "Check every width"].map((text, index) => ({ done: index < 5, text }));
const missionPlan = { phase: { title: "Roster and detail pane", index: 2, count: 4 }, tasks: { completed: 8, total: 17 } };
const missionLens = {
  doing: "Render the detail pane beside the roster", stages: phases(4, 1), progress: { completed: 8, total: 17, unit: "tasks" },
  list: { label: "PLAN", head: "Roster and detail pane", before: 3, after: 4,
    items: checklist.map((task, index) => ({ state: task.done ? "done" as const : index === 5 ? "active" as const : "pending" as const, text: task.text })) },
};
const progress = { done: "Roster rows work end to end.", next: "Build the detail pane.", updatedAt: NOW };
/** A running agent executing its plan: workflow activity, a live tool call, four finished calls and a progress note. */
const mission = session("mission", {
  title: "Mission control",
  workflow: panelWorkflow(1, { plan: missionPlan, lens: missionLens }),
  context: { version: 1, updatedAt: NOW, ticket: { id: "fleet-design-004", subtitle: "Two-pane mission control" }, progress },
  activity: {
    current: act("bash", "npm run typecheck", 3),
    recent: [act("edit", "src/tui/layout.ts", 21), act("read", "src/tui/render-model.ts", 48), act("bash", "node --test dist/test/x.test.js", 95), act("edit", "src/core/heartbeat.ts", 160)],
  },
});
const critic = session("critic", { kind: "subagent", parentId: "mission", agentName: "code-critic", taskPreview: "Review layout changes" });
const missionFleet = [mission, critic, ...panelFleet];
const said = "Roster rows are in. Each agent shows **one status line**.";
const longSaid = Array.from({ length: 30 }, (_, index) => `Line ${index + 1} of the agent message.`).join("\n");
const replyPanel = { kind: "reply" as const, body: ["Reply to Mission control", { value: "Keep the checklist short", cursor: 24 }], keyLine: "Enter Send · Tab Steer · Esc Close", offset: 0 };

/** Card lines from a label to the next label (or the end), with the label's own row first. */
function field(card: string[], label: string): string[] {
  const start = card.findIndex((line) => new RegExp(`^ *${label}\\b`).test(line));
  if (start < 0) return [];
  const end = card.findIndex((line, index) => index > start && (/^ *[A-Z]{3,5}\b/.test(line) || !line.trim() || /Open in Pi/.test(line)));
  return card.slice(start, end < 0 ? undefined : end);
}

test("moving the selection never moves list rows or the footer: the card sits beside the roster at 100+, below it otherwise", () => {
  // Windows tall enough for the whole list; a longer list still scrolls to keep the selection visible.
  for (const [width, height] of [[130, 40], [120, 40], [80, 40], [46, 46]] as const) {
    const positions = (input: Partial<BuildRenderModelInput>) => {
      const layout = render(missionFleet, { width, height, selectedMessage: said, ...input });
      const roster = rosterPlain(layout);
      // The roster ends at the footer beside a side pane, or at the dock rule below 100 columns.
      const end = sidePane(layout) ? layout.footerRow! : dockStart(layout) - 1;
      return {
        // Every roster row keeps its target and its text; selection adds only the stripe and the live spinner.
        rows: Array.from({ length: end }, (_, index) => {
          const target = layout.rowTargets[index];
          return `${target?.kind ?? ""}:${target && "id" in target ? target.id : ""}:${roster[index]!.replace(/^▌/u, " ").replace(/[\u2800-\u28ff]/gu, "●")}`;
        }),
        footer: layout.footerRow,
        layout,
      };
    };
    const first = positions({ selectedId: "mission" });
    assert.ok(first.footer !== undefined && first.rows.length > 10, `${width}x${height}`);
    for (const selectedId of ["asking", "working", "failing", "resting", "picked"]) {
      const next = positions({ selectedId });
      assert.equal(next.footer, first.footer, `${width}x${height} ${selectedId}`);
      assert.deepEqual(next.rows, first.rows, `${width}x${height} ${selectedId}`);
    }
    assert.deepEqual(positions({ selectedSection: "quiet" }).footer, first.footer, "a header selection keeps the card's rows");
    if (width >= 100) {
      assert.ok(sidePane(first.layout), `${width}: side pane`);
      assert.equal(dockStart(first.layout), -1, `${width}: no dock rule`);
      assert.match(paneLines(first.layout)![0]!, /Mission control/);
    } else {
      assert.ok(!sidePane(first.layout));
      assert.match(stripAnsi(first.layout.lines[dockStart(first.layout)]!), /Mission control/);
    }
  }
});

/** The first row below the dock rule, or -1 when the card does not dock. */
function dockStart(layout: ReturnType<typeof render>): number {
  const rule = layout.lines.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(stripAnsi(line).trim()));
  return rule < 0 ? -1 : rule + 1;
}

test("roster status lines take the first of ASK/RDY/BLK, ERR, DOING, NOW tool, SUB, then DONE", () => {
  const lens = { doing: "Render the detail pane", progress: { completed: 8, total: 17 } };
  const busy = { workflow: panelWorkflow(1, { activity: { id: "build", label: "building the pane" } }), activity: { current: act("bash", "npm run typecheck", 3) } };
  const lensed = { ...busy, workflow: panelWorkflow(1, { lens }) };
  const withProgress = { context: { version: 1 as const, updatedAt: NOW, progress } };
  const child = (parentId: string) => session(`${parentId}-child`, { kind: "subagent", parentId, agentName: "scout", taskPreview: "Find tile loaders" });
  const cases: { row: RuntimeSession; children?: RuntimeSession[]; label: string; text: RegExp; tone: string }[] = [
    { row: session("ask", { ...lensed, status: "waiting", context: { version: 1, updatedAt: NOW, progress, attention: { kind: "question", requestId: "q", text: "Ship it today?" } } }), children: [child("ask")], label: "ASK", text: /Ship it today\?/, tone: "warning" },
    { row: session("rdy", { ...lensed, status: "idle", context: { version: 1, updatedAt: NOW, progress, attention: { kind: "ready", requestId: "r", text: "Ready for review" } } }), label: "RDY", text: /Ready for review/, tone: "warning" },
    { row: session("blk", { ...lensed, status: "waiting", context: { version: 1, updatedAt: NOW, progress, attention: { kind: "blocked", requestId: "b", text: "Needs a token" } } }), label: "BLK", text: /Needs a token/, tone: "warning" },
    { row: session("err", { ...lensed, ...withProgress, status: "error", error: "pi exited 1" }), children: [child("err")], label: "ERR", text: /pi exited 1/, tone: "error" },
    { row: session("doing", { ...lensed, ...withProgress }), children: [child("doing")], label: "DOING", text: /Render the detail pane .* ▰{4}▱{4} 8\/17$/, tone: "success" },
    { row: session("paused", { ...lensed, ...withProgress, status: "idle" }), children: [child("paused")], label: "DOING", text: /Render the detail pane/, tone: "muted" },
    { row: session("tool", { ...busy, ...withProgress }), children: [child("tool")], label: "NOW", text: /bash {4}npm run typecheck/, tone: "success" },
    { row: session("sub", { ...busy, ...withProgress, status: "idle" }), children: [child("sub")], label: "SUB", text: /scout Find tile loaders/, tone: "success" },
    { row: session("done", { ...busy, ...withProgress, status: "idle" }), label: "DONE", text: /Roster rows work end to end\./, tone: "muted" },
  ];
  for (const item of cases) {
    const layout = render([session("selected", { status: "idle" }), item.row, ...(item.children ?? [])], { width: 80 });
    const lines = moduleLines(layout, item.row.id);
    assert.equal(lines.length, 2, `${item.row.id}:\n${lines.join("\n")}`);
    assert.match(lines[1]!, new RegExp(`^ +${item.label} +`), item.row.id);
    assert.match(lines[1]!, item.text, item.row.id);
    const raw = rosterRaw(layout)[layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === item.row.id) + 1]!;
    const label = item.tone === "success" ? styleToken(mocha, "success", item.label) : styleToken(mocha, item.tone as "warning" | "error" | "muted", item.label);
    assert.ok(raw.includes(label), `${item.row.id}: ${item.label} is not ${item.tone}: ${JSON.stringify(raw)}`);
  }
  // The workflow activity label never fills the line: without a lens or a note the module is its title row alone.
  const quiet = moduleLines(render([session("selected"), session("plain", { status: "idle", workflow: panelWorkflow(1, { activity: { id: "a", label: "building the pane" } }) })], { width: 80 }), "plain");
  assert.equal(quiet.length, 1, quiet.join("\n"));
});

test("a lens's status line carries its progress at the right edge, the count alone when narrow", () => {
  for (const width of [130, 80]) {
    const line = moduleLines(render(missionFleet, { width, selectedId: "picked" }), "mission")[1]!;
    assert.match(line, /^ +DOING {2}Render the detail pa.* {2}▰{4}▱{4} 8\/17$/, `${width}: ${line}`);
  }
  const narrow = moduleLines(render(missionFleet, { width: 40, selectedId: "picked" }), "mission")[1]!;
  assert.match(narrow, /DOING .* 8\/17$/);
  assert.doesNotMatch(narrow, /▰/);
  // A fault takes the line and its meter; a finished step publishes no lens.
  const failed = moduleLines(render([picked, { ...mission, status: "error", error: "boom" }], { width: 80 }), "mission");
  assert.ok(!failed.some((line) => /8\/17/.test(line)), failed.join("\n"));
  const complete = { ...mission, workflow: { ...mission.workflow!, currentStepComplete: true, lens: undefined } };
  assert.ok(!moduleLines(render([picked, complete], { width: 80 }), "mission").some((line) => /8\/17/.test(line)));
});

test("the side pane orders the card's fields and windows the PLAN checklist around the current task", () => {
  const layout = render(missionFleet, { width: 130, height: 60, selectedId: "mission", selectedMessage: said });
  const pane = paneLines(layout)!;
  const card = pane.filter((line) => line.trim());
  assert.match(card[0]!, /▸ .* Mission control ↳1 +panel/);
  assert.match(card[1]!, /^ +hub-repo$/);
  assert.match(card[2]!, /^ +Two-pane mission control$/);
  // The producer's DOING leads in place of the progress note; the instruments follow; the message closes the card.
  const order = ["DOING", "WHERE", "PLAN", "NOW", "LOG", "SUB", "── SAID ─", "Enter Open in Pi"]
    .map((label) => card.findIndex((line) => new RegExp(`^ *${label}`).test(line)));
  assert.ok(order.every((index) => index > 2), `${order.join(",")}\n${card.join("\n")}`);
  assert.deepEqual([...order].sort((left, right) => left - right), order, card.join("\n"));
  assert.ok(!card.some((line) => /^ *(DONE|NEXT)\b/.test(line)), card.join("\n"));
  assert.match(card[order[1]!]!, /WHERE {2}PL✓ EX◉ RV· RF· CM· │ 1✓ 2◉ 3· 4· {2}▰{4}▱{4} 8\/17$/);
  // Blank rows separate position, the list, activity and message.
  for (const label of ["PLAN", "NOW", "── SAID"]) {
    const index = pane.findIndex((line) => new RegExp(`^ *${label}\\b`).test(line));
    assert.equal(pane[index - 1]!.trim(), "", `${label} follows a blank row`);
  }
  // Two tasks before the current one, then pending tasks up to seven; the producer's and the window's skips are counted.
  assert.deepEqual(field(card, "PLAN").map((line) => line.trim()), [
    "PLAN   Roster and detail pane",
    "✓ 6 earlier",
    "✓ Roster rows show one status line",
    "✓ Publish live tool calls in the heartbeat",
    "◉ Render the detail pane beside the roster",
    "· Show the plan checklist",
    "· Keep Answer and Reply inside the pane",
    "· Cap the agent message",
    "· Check every width",
    "· 4 more",
  ]);
  const raw = layout.lines.map((line) => line.slice(line.lastIndexOf("│")));
  const current = raw.find((line) => stripAnsi(line).includes("◉ Render the detail pane"))!;
  assert.ok(current.includes(styleToken(mocha, "accent", "◉")), JSON.stringify(current));
  assert.ok(current.includes("\u001b[1m"), "the current task is bold");
  assert.ok(raw.find((line) => stripAnsi(line).includes("✓ Roster rows show"))!.includes(styleToken(mocha, "muted", "✓")));
  // The docked card keeps the phase and the current task only.
  const docked = dockLines(render(missionFleet, { width: 80, height: 40, selectedId: "mission" }));
  const plan = field(docked.map((line) => line.replace(/^▌/u, " ")), "PLAN").map((line) => line.trim());
  assert.deepEqual(plan, ["PLAN   Roster and detail pane", "◉ Render the detail pane beside the roster"]);
  assert.ok(!docked.some((line) => /earlier|more$/.test(line.trim())), docked.join("\n"));
});

test("the card's NOW shows only the live tool call and LOG at most three finished calls, each with its age", () => {
  const activityMission = { ...mission, workflow: { ...mission.workflow!, activity: { id: "build", label: "building the pane" } } };
  const card = cardText(render([activityMission, critic, ...panelFleet], { width: 130, height: 60, selectedId: "mission" }));
  assert.deepEqual(field(card, "NOW").map((line) => line.trim().replace(/ {2,}/gu, "  ")), [
    "NOW  3s  bash  npm run typecheck",
  ]);
  assert.ok(!card.some((line) => line.includes("building the pane")), card.join("\n"));
  assert.deepEqual(field(card, "LOG").map((line) => line.trim().replace(/ {2,}/gu, "  ")), [
    "LOG  21s edit  src/tui/layout.ts",
    "48s read  src/tui/render-model.ts",
    "1m  bash  node --test dist/test/x.test.js",
  ]);
  assert.ok(!card.some((line) => line.includes("heartbeat.ts")), "a fourth finished call is not shown");
  // Ages share one column, so tool names line up under each other.
  const tools = [...field(card, "NOW"), ...field(card, "LOG")].map((line) => line.search(/bash|edit|read/));
  assert.equal(new Set(tools).size, 1, card.join("\n"));
  // A session that is not running shows no live call.
  const idle = cardText(render([{ ...mission, status: "idle" }, ...panelFleet], { width: 130, height: 60 }));
  assert.ok(!idle.some((line) => line.includes("npm run typecheck")), idle.join("\n"));
});

test("SAID renders the selected session's latest message as markdown and caps it", () => {
  const card = cardText(render(missionFleet, { width: 130, height: 60, selectedId: "mission", selectedMessage: said }));
  // The side pane rules the message off and starts it at the label column, with its emphasis kept.
  const rule = card.findIndex((line) => /^ *── SAID ─+$/.test(line));
  assert.ok(rule > 0, card.join("\n"));
  assert.equal(card[rule + 1]!.trim(), "Roster rows are in. Each agent shows one status line.");
  assert.equal(card[rule + 1]!.search(/\S/), card[rule]!.search(/\S/));
  const rawSaid = render(missionFleet, { width: 130, height: 60, selectedId: "mission", selectedMessage: said }).lines.find((line) => stripAnsi(line).includes("Each agent shows"))!;
  assert.match(rawSaid, /\u001b\[1m(?:\u001b\[[0-9;]*m)*one status line/u);
  // Only the selected session's message: another selection shows none.
  assert.ok(!cardText(render(missionFleet, { width: 130, height: 60, selectedId: "picked" })).some((line) => /SAID/.test(line)));
  const long = cardText(render(missionFleet, { width: 130, height: 80, selectedId: "mission", selectedMessage: longSaid }));
  const start = long.findIndex((line) => /^ *── SAID/.test(line)) + 1;
  const end = long.findIndex((line) => /Open in Pi/.test(line));
  const shown = long.slice(start, end);
  assert.equal(shown.length, 15, shown.join("\n"));
  assert.match(shown[0]!, /^ +Line 1 of the agent message\./);
  assert.match(shown[13]!, /Line 14 of the agent message\./);
  assert.match(shown[14]!, /… \d+ more lines · C Full message/);
  assert.ok(!long.some((line) => line.includes("Line 15")));
});

test("with a reply panel open the pane keeps request, DOING and SAID, drops position, the list and activity, and keeps the panel whole", () => {
  const asking = { ...mission, status: "waiting" as const, context: { ...mission.context!, attention: { kind: "question" as const, requestId: "q", text: "Should the checklist window be seven rows?", recommendation: "Keep seven" } } };
  const running = { ...mission, workflow: panelWorkflow(1, { plan: missionPlan }), context: { ...mission.context! } };
  for (const subject of [asking, running]) {
    const sessions = [subject, critic, ...panelFleet];
    const tall = cardText(render(sessions, { width: 130, height: 60, selectedId: "mission", selectedMessage: said, cardPanel: replyPanel }));
    for (const label of ["WHERE", "PLAN", "NOW", "LOG", "SUB"]) assert.ok(!tall.some((line) => new RegExp(`^ *${label}\\b`).test(line)), `${label}\n${tall.join("\n")}`);
    // A lens's DOING stays; without one the progress note does.
    if (subject === asking) assert.ok(tall.some((line) => /^ *DOING {2}Render the detail pane/.test(line)), tall.join("\n"));
    else assert.ok(tall.some((line) => /^ *DONE {3}Roster rows work/.test(line)), tall.join("\n"));
    // NEXT steps aside while a request says what comes next.
    assert.equal(tall.some((line) => /^ *NEXT\b/.test(line)), subject === running, tall.join("\n"));
    assert.ok(tall.some((line) => /^ *── SAID ─/.test(line)) && tall.some((line) => /^ *Roster rows are in/.test(line)), tall.join("\n"));
    if (subject === asking) assert.ok(tall.some((line) => /^ *ASK {4}Should the checklist/.test(line)), tall.join("\n"));
    // At 24 rows context is cut from its end; the panel's input and keys stay.
    const short = render(sessions, { width: 130, height: 24, selectedId: "mission", selectedMessage: longSaid, cardPanel: replyPanel });
    assert.equal(short.lines.length, 24);
    const pane = paneLines(short)!;
    const input = pane.findIndex((line) => line.includes("Keep the checklist short"));
    const keys = pane.findIndex((line) => /Enter Send +Tab Steer +Esc Close/.test(line));
    assert.ok(input > 0 && keys > input, pane.join("\n"));
    assert.match(pane[0]!, /Mission control/);
    if (subject === asking) assert.ok(pane.some((line) => /ASK {4}Should the checklist/.test(line)), pane.join("\n"));
  }
});

test("every line fits the terminal width with and without a theme", () => {
  const sessions = [...missionFleet, session("long", { title: "x".repeat(200), group: "g".repeat(80), worktreeBranch: "b".repeat(300), status: "waiting",
    context: { version: 1, updatedAt: NOW, attention: { kind: "blocked", requestId: "b", text: "word ".repeat(80), recommendation: "r".repeat(300), artifact: "/".repeat(200) }, progress: { done: "d".repeat(400), next: "n".repeat(400), updatedAt: NOW } } })];
  for (const width of [30, 46, 80, 100, 130, 200]) {
    for (const selectedId of ["mission", "long", "asking", "failing"]) {
      for (const input of [{}, { cardPanel: replyPanel }] as Partial<BuildRenderModelInput>[]) {
        const model = { sessions, selectedId, width, height: 40, now: NOW, guidanceHidden: true, selectedMessage: longSaid, ...input };
        const commands = buildDashboardCommands({ sessions, selectedId, capabilities: { openSession: true, sendMessage: true } });
        const built = buildRenderModel({ ...model, workspaceCommands: selectWorkspaceCommands(sessions.find((item) => item.id === selectedId)!, commands, 3) });
        for (const layout of [renderSessions(built, mocha), renderSessions(built)]) {
          const wide = layout.lines.filter((line) => visibleWidth(line) > width);
          assert.deepEqual(wide, [], `${width} ${selectedId} ${JSON.stringify(Object.keys(input))}`);
          assert.ok(layout.lines.length <= 40);
        }
      }
    }
  }
});

test("the side pane maps its card rows to the selected session and leaves its blank rows untargeted", () => {
  const layout = render(panelFleet, { width: 130, height: 40, selectedId: "picked" });
  assert.ok(layout.pane);
  assert.equal(layout.pane.x, layout.listStartX + layout.listWidth + 1);
  const rows = layout.pane.targets.flatMap((target, row) => target ? [row] : []);
  assert.ok(rows.length >= 3);
  for (const row of rows) assert.deepEqual(layout.pane.targets[row], { kind: "session-continuation", id: "picked" });
  const paneText = (row: number) => stripAnsi(layout.lines[row]!).slice(layout.listWidth + 1).trim();
  assert.match(paneText(rows[0]!), /Picked agent/);
  assert.match(paneText(rows.at(-1)!), /All actions/);
  // The empty rows between the card's content and its keys target nothing, and a docked layout has no pane.
  assert.ok(layout.pane.targets.some((target, row) => !target && row > rows[0]! && row < rows.at(-1)!));
  assert.equal(render(panelFleet, { width: 80, height: 40, selectedId: "picked" }).pane, undefined);
  assert.equal(render(panelFleet, { width: 130, height: 40, selectedSection: "quiet" }).pane, undefined);
});

test("C shows the whole message in the card and folds it back; paragraph breaks do not shorten the fold", () => {
  const paragraphs = Array.from({ length: 20 }, (_, index) => `Paragraph ${index + 1}.`).join("\n\n");
  const folded = cardText(render(missionFleet, { width: 130, height: 80, selectedId: "mission", selectedMessage: paragraphs }));
  // Fourteen text lines show, whatever blank lines separate them.
  assert.ok(folded.some((line) => line.includes("Paragraph 14.")));
  assert.ok(!folded.some((line) => line.includes("Paragraph 15.")));
  assert.ok(folded.some((line) => /… \d+ more lines · C Full message/.test(line)), folded.join("\n"));
  const expanded = cardText(render(missionFleet, { width: 130, height: 80, selectedId: "mission", selectedMessage: paragraphs, selectedMessageExpanded: true }));
  assert.ok(expanded.some((line) => line.includes("Paragraph 20.")), expanded.join("\n"));
  assert.ok(expanded.some((line) => /C Fold · c Conversation/.test(line)));
  // Expanded below 100, the docked card grows like Details, keeping one roster row.
  const docked = render(missionFleet, { width: 80, height: 40, selectedId: "mission", selectedMessage: paragraphs, selectedMessageExpanded: true });
  assert.ok(docked.rowTargets.some((target) => target?.kind === "session"));
  assert.ok(docked.lines.every((line) => visibleWidth(line) <= 80));
});

test("quiet roster rows say what the agent last reported, else its task, else nothing", () => {
  const quiet = (id: string, values: Partial<RuntimeSession>) => session(id, { status: "idle", acknowledgedAt: 2, ...values });
  const handoff = quiet("handoff", { title: "Read handoff", context: { version: 1, updatedAt: 1, attention: { kind: "ready", text: "Shipped the export job; homepage feeds again." } } });
  const ticketed = quiet("ticketed", { title: "Ticketed", context: { version: 1, updatedAt: 1, ticket: { id: "t-1", subtitle: "Tidy the export queue" } } });
  const progress = quiet("progress", { title: "Progressed", context: { version: 1, updatedAt: 3, progress: { done: "Merged the queue cleanup.", updatedAt: 3 } } });
  const bare = quiet("bare", { title: "Bare" });
  const layout = render([picked, handoff, ticketed, progress, bare], { width: 130, height: 40 });
  assert.match(moduleLines(layout, "handoff")[1]!, /SAID {3}Shipped the export job/);
  assert.match(moduleLines(layout, "ticketed")[1]!, /TASK {3}Tidy the export queue/);
  assert.match(moduleLines(layout, "progress")[1]!, /DONE {3}Merged the queue cleanup\./);
  assert.equal(moduleLines(layout, "bare").length, 1);
  // At 160+ the title row names the task, so the fallback does not repeat it.
  assert.equal(moduleLines(render([picked, ticketed], { width: 200, height: 40 }), "ticketed").length, 1);
});

test("short windows keep requests and faults before quiet notes", () => {
  const quiet = Array.from({ length: 10 }, (_, index) => session(`q${index}`, { status: "idle", acknowledgedAt: 2, title: `Quiet ${index}`, context: { version: 1, updatedAt: 1, attention: { kind: "ready", text: `Old note ${index}` } } }));
  const failing = session("failing", { status: "error", error: "provider returned 529", title: "Failing" });
  const layout = render([picked, ...quiet, failing], { width: 130, height: 24 });
  assert.match(moduleLines(layout, "failing")[1] ?? "", /ERR {4}provider returned 529/);
});

test("a running agent between tool calls says Thinking and does not repeat a handoff it has moved past", () => {
  const thinking = session("thinking", { title: "Thinker", status: "running", acknowledgedAt: 2, context: { version: 1, updatedAt: 1, attention: { kind: "ready", text: "Old handoff text." } } });
  const card = cardText(render([thinking, ...panelFleet], { width: 130, height: 40, selectedId: "thinking" }));
  assert.ok(card.some((line) => /^ *NOW {4}Thinking…$/.test(line.trimEnd())), card.join("\n"));
  assert.ok(!card.some((line) => /SAID|Old handoff/.test(line)), card.join("\n"));
  // Its text since your message shows as soon as there is some.
  const speaking = cardText(render([thinking, ...panelFleet], { width: 130, height: 40, selectedId: "thinking", selectedMessage: "Checking the parser first." }));
  assert.ok(speaking.some((line) => line.includes("Checking the parser first.")));
});
