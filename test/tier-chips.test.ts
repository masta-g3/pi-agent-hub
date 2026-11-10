import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { renderSessions } from "../src/tui/layout.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import { cockpitFrameFleet, COCKPIT_NOW } from "./fixtures/cockpit.js";

const fleet = () => cockpitFrameFleet();

function modelWithWorkspace(input: BuildRenderModelInput) {
  const selected = input.sessions.find(row => row.id === input.selectedId)!;
  const commands = buildDashboardCommands({ sessions: input.sessions, selectedId: selected.id, capabilities: { openSession: true } });
  return buildRenderModel({ ...input, workspaceCommands: selectWorkspaceCommands(selected, commands, 3) });
}

test("Status header meter shows one cell per owner in tier order with exact hit ranges", () => {
  for (const width of [120, 160]) {
    const layout = renderSessions(buildRenderModel({ sessions: fleet(), selectedId: "docs", width, now: COCKPIT_NOW }), darkTheme);
    const header = stripAnsi(layout.lines[layout.tierChipRow!]!);
    assert.match(header, /● × ◐◐ ··· · {2}8 sessions$/);
    assert.deepEqual(layout.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width)), ["●", "×", "◐◐", "···", "·"]);
    // Cells take their tier's signal tone: warning for NEEDS YOU, error for HEALTH.
    assert.ok(layout.lines[layout.tierChipRow!]!.includes(styleToken(darkTheme, "warning", "●")));
    assert.ok(layout.lines[layout.tierChipRow!]!.includes(styleToken(darkTheme, "error", "×")));
    const heading = layout.lines.find(line => / NEEDS YOU 1 /.test(stripAnsi(line)) && line !== layout.lines[0])!;
    // Module tiers name their step on each title row, so their heading is a plain rule up to the side pane.
    assert.match(sliceByColumn(stripAnsi(heading), 0, layout.listWidth), /^ ── NEEDS YOU 1 ─+$/);
  }
  const layout = renderSessions(buildRenderModel({ sessions: fleet().filter(row => row.id === "docs"), width: 160 }));
  assert.deepEqual(layout.tierChips.map(chip => chip.tier), ["needs-you"]);
  assert.match(stripAnsi(layout.lines[0]!), /FLEET +● {2}1 session$/);
});

test("the NEW cell sits after HEALTH in text tone and drops after ACTIVE", () => {
  const withNew = (rows: ReturnType<typeof fleet>) => [...rows, { ...rows.find(row => row.id === "release")!, id: "fresh", title: "Fresh fork", status: "idle" as const, unopened: true as const }];
  const header = renderSessions(buildRenderModel({ sessions: withNew(fleet()), width: 160, now: COCKPIT_NOW }), darkTheme);
  assert.match(stripAnsi(header.lines[header.tierChipRow!]!), /● × ◉ ◐◐ ··· · {2}9 sessions$/);
  assert.ok(!header.lines[header.tierChipRow!]!.includes(styleToken(darkTheme, "accent", "◉")));

  const sessions = Array.from({ length: 10 }, (_, i) => withNew(fleet()).map(row => ({ ...row, id: `${row.id}-${i}`, ...(row.parentId ? { parentId: `${row.parentId}-${i}` } : {}) }))).flat();
  const seen: string[][] = [];
  for (let width = 160; width >= 30; width -= 1) {
    const tiers = renderSessions(buildRenderModel({ sessions, width, now: COCKPIT_NOW })).tierChips.map(chip => chip.tier);
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(tiers)) seen.push(tiers);
  }
  // Every shape shortens with the same tiers before any tier drops.
  assert.deepEqual(seen, [
    ["needs-you", "health", "new", "active", "quiet", "archived"],
    ["needs-you", "health", "new", "active", "archived"],
    ["needs-you", "health", "new", "active"],
  ]);
});

test("the meter shortens large groups, then every group, then shows counts before dropping tiers", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => fleet().map(row => ({ ...row, id: `${row.id}-${i}`, ...(row.parentId ? { parentId: `${row.parentId}-${i}` } : {}) }))).flat();
  const chips = (width: number) => {
    const layout = renderSessions(buildRenderModel({ sessions, width, now: COCKPIT_NOW }));
    assert.ok(layout.lines.every(line => visibleWidth(line) === width));
    const header = stripAnsi(layout.lines[0]!);
    assert.match(header, /80 sessions/);
    return layout.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width));
  };
  assert.deepEqual(chips(120), ["●".repeat(10), "×".repeat(10), "◐20", "·30", "·".repeat(10)]);
  assert.deepEqual(chips(50), ["●10", "×10", "◐20", "·30", "·10"]);
  assert.deepEqual(chips(36), ["10", "10", "20", "30", "10"]);
  assert.deepEqual(chips(31), ["10", "10", "20", "10"]);
});

test("list reclaims the navigator columns without changing workspace geometry", () => {
  for (const width of [30, 60, 80, 100, 120, 160]) {
    const model = modelWithWorkspace({ sessions: fleet(), width, selectedId: "docs", now: COCKPIT_NOW });
    const layout = renderSessions(model);
    assert.doesNotMatch(layout.lines.join("\n"), /TIERS/);
    assert.equal(layout.listStartX, 1);
    // Below 100 the roster takes the full width; from 100 the side pane takes the rest after a one-cell rule.
    assert.equal(layout.listWidth, ({ 100: 38, 120: 46, 160: 61 } as Record<number, number>)[width] ?? width);
    assert.equal(layout.workspaceStartX, undefined);
  }
});

test("Repo headings truncate long repository names and name no workflow columns above module rows", () => {
  const row = { ...fleet().find(row => row.id === "release")!, cwd: "/tmp/repository-with-a-very-long-name-that-needs-truncation-before-the-workflow-grid-can-fit" };
  const layout = renderSessions(buildRenderModel({ sessions: [row], width: 80, fleetGrouping: "repo" }));
  const header = stripAnsi(layout.lines.find(line => stripAnsi(line).startsWith(" ── repository-"))!);
  // Module rows name their own step, so the heading carries no grid labels.
  assert.match(header, /… (─+ )?·1\s*$/);
});

test("board, Repo, pin and full-screen workspace headers have no chip targets", () => {
  for (const options of [{ grouping: "stage" as const }, { fleetGrouping: "repo" as const }, { pinSlots: ["docs"] }, { width: 60, grouping: "stage" as const, workspaceFullScreen: true }]) {
    const layout = renderSessions(modelWithWorkspace({ sessions: fleet(), selectedId: "docs", width: 160, ...options }));
    assert.deepEqual(layout.tierChips, []);
    assert.equal(layout.tierChipRow, undefined);
  }
});
