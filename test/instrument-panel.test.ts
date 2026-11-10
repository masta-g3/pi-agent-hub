import test from "node:test";
import assert from "node:assert/strict";
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
  const lines = render(fleet).lines;
  for (const title of ["Ready agent", "Blocked agent"]) {
    const line = lines.find((candidate) => stripAnsi(candidate).includes(title))!;
    assert.ok(line.includes(tone("warning")), `${title} is not warning: ${JSON.stringify(line)}`);
    assert.ok(!line.includes(tone("error")), `${title} reads as a fault`);
  }
  const selected = render(fleet, { selectedId: "blocked" }).lines.find((line) => stripAnsi(line).includes("Blocked agent"))!;
  assert.ok(selected.startsWith(tone("warning")) || selected.includes(`${tone("warning")}▌`), JSON.stringify(selected));
});

test("accent marks controls: the mode label, selection stripe and keycaps", () => {
  const lines = render(fleet).lines;
  assert.ok(lines[0]!.includes(styleToken(mocha, "accent", "FLEET")), "mode label");
  assert.ok(lines.some((line) => line.includes(`${tone("accent")}▌`)), "selection stripe");
  const footer = lines.at(-1)!;
  assert.ok(footer.includes(tone("accent")), "footer keycaps");
});

test("healthy quota bars in the fleet header are not success-colored", () => {
  const usage = mergeUsageSnapshots([parseUsageSnapshot(usageFixture(), USAGE_NOW)!]);
  const header = render(fleet, { usage, width: 200 }).lines[0]!;
  assert.match(stripAnsi(header), /Codex/);
  assert.ok(!header.includes(tone("success")));
});

const faults = ["Catalog Sync", "Map Tiles Export"].map((title, index) =>
  session(`fault${index}`, { title, status: "error", error: index ? "tmux pane dead" : "pi exited 1: ENOSPC" }));

test("tier headings are ruled, with the count in the tier's signal tone", () => {
  for (const width of [120, 46]) {
    const layout = render([...faults, ...fleet], { width });
    const plain = layout.lines.map((line) => stripAnsi(line).trimEnd());
    for (const [label, count] of [["NEEDS YOU", 2], ["HEALTH", 2], ["ACTIVE", 1]] as const) {
      const index = plain.findIndex((line, row) => row > 0 && line.includes(` ${label} ${count} `));
      assert.ok(index >= 0, `${width}: ${label}\n${plain.join("\n")}`);
      assert.match(plain[index]!, new RegExp(`^.── ${label} ${count} ─+$`));
      assert.ok(layout.lines[index]!.length > 0);
    }
    const heading = (label: string) => layout.lines[plain.findIndex((line, row) => row > 0 && line.includes(` ${label} `))]!;
    assert.ok(heading("NEEDS YOU").includes(styleToken(mocha, "warning", "2")));
    assert.ok(heading("HEALTH").includes(styleToken(mocha, "error", "2")));
  }
});

test("a collapsed HEALTH tier folds to its heading like every other tier", () => {
  const layout = render([...faults, ...fleet], { collapsedSections: new Set(["health"]) });
  const plain = layout.lines.map((line) => stripAnsi(line).trimEnd());
  assert.match(plain.find((line, row) => row > 0 && line.includes(" HEALTH 2 "))!, /^ ▸─ HEALTH 2 ─+$/);
  assert.ok(!plain.some((line) => /Catalog Sync|Map Tiles Export|ERR/.test(line)), plain.join("\n"));
});

const steps = [["plan", "PL"], ["execute", "EX"], ["review", "RV"], ["reflect", "RF"], ["commit", "CM"]].map(([id, short]) => ({ id: id!, short: short!, label: id! }));
const panelWorkflow = (activeIndex: number, extra: Record<string, unknown> = {}) => ({ version: 1 as const, source: "test", activeIndex, updatedAt: NOW, steps, ...extra });
const asking = session("asking", {
  title: "Tile Review", status: "waiting", lastActivityAt: NOW - 600_000,
  context: { version: 1, updatedAt: NOW, attention: { kind: "question", requestId: "q1", text: "Which neighborhood tiles should come first? There are several candidate areas with different data quality and coverage.", recommendation: "North Beach, then Chinatown" } },
  workflow: panelWorkflow(1, { plan: { phase: { title: "Tests", index: 2, count: 5 }, tasks: { completed: 3, total: 8 } } }),
});
const working = session("working", { title: "Tile export", lastActivityAt: NOW - 600_000, workflow: panelWorkflow(2, { activity: { id: "r", label: "rendering tiles" } }) });
const failing = session("failing", { title: "Catalog Sync", status: "error", error: "pi exited 1: ENOSPC", workflow: panelWorkflow(1, { activity: { id: "x", label: "stale activity" } }) });
const resting = session("resting", { title: "Job Status", status: "idle", acknowledgedAt: NOW, workflow: panelWorkflow(4) });
const picked = session("picked", { title: "Picked agent", workflow: panelWorkflow(1, { activity: { id: "w", label: "writing tests" }, plan: { phase: { title: "T", index: 5, count: 5 }, tasks: { completed: 19, total: 19 } } }) });
const panelFleet = [picked, asking, working, failing, resting];

/** The docked card's rows below the dock rule. */
function dockLines(layout: ReturnType<typeof render>): string[] {
  const plain = layout.lines.map((line) => stripAnsi(line).trimEnd());
  const rule = plain.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line));
  return rule < 0 ? [] : plain.slice(rule + 1).filter((line, index) => layout.rowTargets[rule + 1 + index]?.kind === "session-continuation");
}

function moduleLines(layout: ReturnType<typeof render>, id: string): string[] {
  const plain = layout.lines.map((line) => stripAnsi(line).trimEnd());
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

test("an unselected request keeps three lines with its recommendation", () => {
  const lines = moduleLines(render(panelFleet, { width: 80 }), "asking");
  assert.match(lines[1]!, /^ +ASK {3}Which neighborhood/);
  assert.equal(lines.filter((line) => !/^ +(STEP|NOW|SUB)\b/.test(line)).length - 1, 3, lines.join("\n"));
  assert.match(lines[3]!, /→ North Beach, then Chinatown/);
  const valueColumn = lines[1]!.indexOf("Which");
  assert.equal(lines[2]!.search(/\S/), valueColumn);
});

test("ERR replaces NOW, and the readout drops PHASE, the meter, then TASK as width shrinks", () => {
  const failed = moduleLines(render(panelFleet), "failing");
  assert.ok(failed.some((line) => /ERR {3}pi exited 1: ENOSPC/.test(line)));
  assert.ok(!failed.some((line) => /NOW|stale activity/.test(line)), failed.join("\n"));
  const wide = moduleLines(render(panelFleet, { width: 120 }), "asking").find((line) => line.includes("STEP"))!;
  assert.match(wide, /STEP {2}PL✓ EX◉ RV· RF· CM· {3}TASK ▰▰▰▱▱▱▱▱ 3\/8 {3}PHASE 2\/5/);
  const narrow = moduleLines(render(panelFleet, { width: 46 }), "asking").find((line) => line.includes("STEP"))!;
  assert.match(narrow, /STEP {2}execute {3}TASK ▰▰▰▱▱▱▱▱ 3\/8$/);
  const tiny = moduleLines(render(panelFleet, { width: 30 }), "asking").find((line) => line.includes("STEP"))!;
  assert.doesNotMatch(tiny, /PHASE|▰/);
});

test("module title rows end with the age, and only the selection is plated", () => {
  const layout = render(panelFleet);
  assert.match(moduleLines(layout, "working")[0]!, /Tile export .* {2,}10m$/);
  const plate = `\u001b[48;2;49;50;68m`;
  for (const id of ["asking", "working", "failing"]) {
    const rows = layout.rowTargets.flatMap((target, index) => target && "id" in target && target.id === id ? [layout.lines[index]!] : []);
    assert.ok(rows.length > 1 && rows.every((row) => !row.includes("\u001b[48;")), id);
  }
  const selectedRows = layout.rowTargets.flatMap((target, index) => target && "id" in target && target.id === "picked" ? [layout.lines[index]!] : []);
  assert.ok(selectedRows.every((row) => row.includes(plate)));
});

test("quiet agents are modules, archived rows stay one line, and SUB names running subagents only while collapsed", () => {
  const parent = session("parent", { status: "idle", title: "Tile review", acknowledgedAt: NOW });
  const child = (id: string, agentName: string, taskPreview: string) => session(id, { kind: "subagent", parentId: "parent", agentName, taskPreview });
  const sessions = [picked, parent, child("c1", "code-critic", "Review the pixel map diff"), child("c2", "scout", "Find tile loaders"), resting];
  const lines = moduleLines(render(sessions), "parent");
  assert.ok(lines.some((line) => /SUB {3}code-critic · Review the pixel map diff · \+1 more/.test(line)), lines.join("\n"));
  assert.ok(moduleLines(render(sessions), "resting").some((line) => /STEP {2}PL✓ EX✓ RV✓ RF✓ CM◉/.test(line)));
  const archived = session("old", { title: "Old work", status: "stopped", bucket: "archived", bucketChangedAt: NOW - 1_000, workflow: panelWorkflow(1) });
  assert.equal(moduleLines(render([picked, archived]), "old").length, 1);
});

test("the selected module shows the LCD strip at 100+ and a one-line readout below", () => {
  const layout = render(panelFleet, { width: 120 });
  const lines = dockLines(layout);
  const labels = lines.findIndex((line) => /STEP +TASK +PHASE/.test(line));
  assert.ok(labels > 0, lines.join("\n"));
  assert.equal(lines[labels]!.indexOf("TASK"), lines[labels + 1]!.indexOf("▰"));
  assert.match(lines[labels + 1]!, /PL✓ EX◉ RV· RF· CM· +▰{8} 19\/19 +5\/5/);
  const lcd = `\u001b[48;2;29;30;41m`;
  const raw = layout.lines.filter((line) => /STEP +TASK/.test(stripAnsi(line)) || /19\/19/.test(stripAnsi(line)));
  // The list module keeps its one-line readout; the dock draws the LCD strip.
  assert.equal(raw.filter((line) => line.includes(lcd)).length, 2);
  const narrow = dockLines(render(panelFleet, { width: 80 }));
  assert.ok(narrow.some((line) => /STEP {2}PL✓ EX◉ RV· RF· CM· {3}TASK ▰{8} 19\/19 {3}PHASE 5\/5/.test(line)), narrow.join("\n"));
  assert.ok(!narrow.some((line) => /STEP +TASK +PHASE$/.test(line.trim())));
});

test("without color the LCD keeps labels above values and selection keeps its stripe and keys", () => {
  process.env.NO_COLOR = "1";
  try {
    const layout = render(panelFleet, { width: 120 });
    const lines = dockLines(layout);
    assert.ok(lines.some((line) => /STEP +TASK +PHASE/.test(line)), lines.join("\n"));
    assert.ok(lines.every((line) => line.startsWith("▌")));
    assert.ok(lines.some((line) => line.includes("Open in Pi")));
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
    for (const rows of [moduleLines(layout, "long"), dockLines(layout)]) {
      assert.match(rows.join("\n"), /STEP009/, `${width}: ${rows.join("\n")}`);
    }
  }
});

test("moving the selection never moves list rows or the footer: the card docks below the list", () => {
  // Windows tall enough for the whole list; a longer list still scrolls to keep the selection visible.
  for (const [width, height] of [[120, 40], [80, 40], [46, 46]] as const) {
    const positions = (input: Partial<BuildRenderModelInput>) => {
      const layout = render(panelFleet, { width, height, ...input });
      return {
        rows: panelFleet.map((item) => layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === item.id)),
        footer: layout.footerRow,
        text: layout.lines.map(stripAnsi),
      };
    };
    const first = positions({ selectedId: "picked" });
    for (const selectedId of ["asking", "working", "failing", "resting"]) {
      const next = positions({ selectedId });
      assert.deepEqual(next.rows, first.rows, `${width}x${height} ${selectedId}`);
      assert.equal(next.footer, first.footer, `${width}x${height} ${selectedId}`);
    }
    assert.deepEqual(positions({ selectedSection: "quiet" }).footer, first.footer, "a header selection keeps the dock's rows");
    const rule = first.text.findIndex((line, index) => index > 0 && /^─{20,}$/u.test(line.trim()));
    assert.match(first.text[rule + 1]!, /Picked agent/);
  }
});
