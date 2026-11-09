import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
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

test("Status header chips show nonzero owner counts in tier order with exact hit ranges", () => {
  for (const width of [120, 160]) {
    const layout = renderSessions(buildRenderModel({ sessions: fleet(), selectedId: "docs", width, now: COCKPIT_NOW }), darkTheme);
    const header = stripAnsi(layout.lines[layout.tierChipRow!]!);
    assert.match(header, /NEEDS YOU 1 {3}HEALTH 1 {3}ACTIVE 2 {3}QUIET 3 {3}ARCHIVED 1 {3}8 sessions/);
    assert.deepEqual(layout.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width)), [" NEEDS YOU 1 ", " HEALTH 1 ", " ACTIVE 2 ", " QUIET 3 ", " ARCHIVED 1 "]);
    // Pills fill with their tier tone: warning #e0af68, error #f7768e.
    assert.ok(layout.lines[layout.tierChipRow!]!.includes("\u001b[48;2;224;175;104m"));
    assert.ok(layout.lines[layout.tierChipRow!]!.includes("\u001b[48;2;247;118;142m"));
    const heading = layout.lines.find(line => /^ {3}NEEDS YOU {2}1/.test(stripAnsi(line)))!;
    assert.match(stripAnsi(heading), /NEEDS YOU {2}1\s+PL\s+EX\s+RV/);
    assert.doesNotMatch(stripAnsi(heading), /·1/);
  }
  const layout = renderSessions(buildRenderModel({ sessions: fleet().filter(row => row.id === "docs"), width: 160 }));
  assert.deepEqual(layout.tierChips.map(chip => chip.tier), ["needs-you"]);
  assert.doesNotMatch(stripAnsi(layout.lines[0]!), /HEALTH|ACTIVE|QUIET|ARCHIVED/);
});

test("the NEW chip sits after HEALTH in accent tone and drops after ACTIVE", () => {
  const withNew = (rows: ReturnType<typeof fleet>) => [...rows, { ...rows.find(row => row.id === "release")!, id: "fresh", title: "Fresh fork", status: "idle" as const, unopened: true as const }];
  const header = renderSessions(buildRenderModel({ sessions: withNew(fleet()), width: 160, now: COCKPIT_NOW }), darkTheme);
  assert.match(stripAnsi(header.lines[header.tierChipRow!]!), /NEEDS YOU 1 {3}HEALTH 1 {3}NEW 1 {3}ACTIVE 2 {3}QUIET 3 {3}ARCHIVED 1 {3}9 sessions/);
  // NEW fills with the accent tone #7aa2f7.
  assert.ok(header.lines[header.tierChipRow!]!.includes("\u001b[48;2;122;162;247m"));

  const sessions = Array.from({ length: 10 }, (_, i) => withNew(fleet()).map(row => ({ ...row, id: `${row.id}-${i}`, ...(row.parentId ? { parentId: `${row.parentId}-${i}` } : {}) }))).flat();
  const seen: string[][] = [];
  for (let width = 160; width >= 30; width -= 1) {
    const tiers = renderSessions(buildRenderModel({ sessions, width, now: COCKPIT_NOW })).tierChips.map(chip => chip.tier);
    if (JSON.stringify(seen.at(-1)) !== JSON.stringify(tiers)) seen.push(tiers);
  }
  // Full labels shrink to counts with the same tiers before any tier drops.
  assert.deepEqual(seen, [
    ["needs-you", "health", "new", "active", "quiet", "archived"],
    ["needs-you", "health", "new", "active", "archived"],
    ["needs-you", "health", "new", "active"],
    ["needs-you", "health", "new"],
    ["needs-you", "health"],
  ]);
});

test("header chips shrink to counts, then drop QUIET, ARCHIVED, ACTIVE and HEALTH while keeping sessions", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => fleet().map(row => ({ ...row, id: `${row.id}-${i}`, ...(row.parentId ? { parentId: `${row.parentId}-${i}` } : {}) }))).flat();
  const chips = (width: number) => {
    const layout = renderSessions(buildRenderModel({ sessions, width, now: COCKPIT_NOW }));
    assert.ok(layout.lines.every(line => visibleWidth(line) === width));
    const header = stripAnsi(layout.lines[0]!);
    assert.match(header, /80 sessions/);
    return layout.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width).trim());
  };
  assert.deepEqual(chips(120), ["NEEDS YOU 10", "HEALTH 10", "ACTIVE 20", "QUIET 30", "ARCHIVED 10"]);
  assert.deepEqual(chips(80), ["10", "10", "20", "30", "10"]);
  assert.deepEqual(chips(41), ["10", "10", "20", "10"]);
  assert.deepEqual(chips(36), ["10", "10", "20"]);
  assert.deepEqual(chips(31), ["10", "10"]);
});

test("list reclaims the navigator columns without changing workspace geometry", () => {
  for (const width of [30, 60, 80, 100, 120, 160]) {
    const model = modelWithWorkspace({ sessions: fleet(), width, selectedId: "docs", now: COCKPIT_NOW });
    const layout = renderSessions(model);
    assert.doesNotMatch(layout.lines.join("\n"), /TIERS/);
    assert.equal(layout.listStartX, 1);
    assert.equal(layout.listWidth, width);
  }
});

test("Repo headings still truncate long repository names before dropping workflow columns", () => {
  const row = { ...fleet().find(row => row.id === "release")!, cwd: "/tmp/repository-with-a-very-long-name-that-needs-truncation-before-the-workflow-grid-can-fit" };
  const layout = renderSessions(buildRenderModel({ sessions: [row], width: 80, fleetGrouping: "repo" }));
  const header = stripAnsi(layout.lines.find(line => stripAnsi(line).startsWith("   repository-"))!);
  assert.match(header, /…\s+·1\s+PL\s+EX\s+RV\s*│?$/);
});

test("board, Repo, pin and full-screen workspace headers have no chip targets", () => {
  for (const options of [{ grouping: "stage" as const }, { fleetGrouping: "repo" as const }, { pinSlots: ["docs"] }, { width: 60, grouping: "stage" as const, workspaceFullScreen: true }]) {
    const layout = renderSessions(modelWithWorkspace({ sessions: fleet(), selectedId: "docs", width: 160, ...options }));
    assert.deepEqual(layout.tierChips, []);
    assert.equal(layout.tierChipRow, undefined);
  }
});

const mocha = { ...darkTheme, text: "#cdd6f4", selectedBg: "#313244", statusLineBg: "" };

test("painted tier pills fill their hit ranges and shrink to counts before dropping tiers", () => {
  const wide = renderSessions(buildRenderModel({ sessions: fleet(), selectedId: "docs", width: 160, now: COCKPIT_NOW }), mocha);
  const header = stripAnsi(wide.lines[0]!);
  assert.match(header, /^pi hub {2}FLEET/);
  assert.deepEqual(wide.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width)),
    [" NEEDS YOU 1 ", " HEALTH 1 ", " ACTIVE 2 ", " QUIET 3 ", " ARCHIVED 1 "]);
  // NEEDS YOU fills with the warning tone (#e0af68).
  assert.ok(wide.lines[0]!.includes("\u001b[48;2;224;175;104m"), JSON.stringify(wide.lines[0]));

  const phone = renderSessions(buildRenderModel({ sessions: fleet(), selectedId: "docs", width: 46, now: COCKPIT_NOW }), mocha);
  const phoneHeader = stripAnsi(phone.lines[0]!);
  assert.deepEqual(phone.tierChips.map(chip => chip.tier), ["needs-you", "health", "active", "quiet", "archived"]);
  assert.deepEqual(phone.tierChips.map(chip => phoneHeader.slice(chip.x - 1, chip.x - 1 + chip.width)), [" 1 ", " 1 ", " 2 ", " 3 ", " 1 "]);
});
