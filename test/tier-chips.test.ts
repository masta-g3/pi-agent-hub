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
    assert.match(header, /NEEDS YOU 1 · HEALTH 1 · ACTIVE 2 · QUIET 3 · ARCHIVED 1 · 8 sessions/);
    assert.deepEqual(layout.tierChips.map(chip => header.slice(chip.x - 1, chip.x - 1 + chip.width)), ["NEEDS YOU 1", "HEALTH 1", "ACTIVE 2", "QUIET 3", "ARCHIVED 1"]);
    assert.ok(layout.lines[layout.tierChipRow!]!.includes(styleToken(darkTheme, "warning", "NEEDS YOU 1")));
    assert.ok(layout.lines[layout.tierChipRow!]!.includes(styleToken(darkTheme, "error", "HEALTH 1")));
    const heading = layout.lines.find(line => /─[─│] NEEDS YOU 1/.test(stripAnsi(line)))!;
    assert.match(stripAnsi(heading), /NEEDS YOU 1\s+PL\s+EX\s+RV/);
    assert.doesNotMatch(stripAnsi(heading), /·1/);
  }
  const layout = renderSessions(buildRenderModel({ sessions: fleet().filter(row => row.id === "docs"), width: 160 }));
  assert.deepEqual(layout.tierChips.map(chip => chip.tier), ["needs-you"]);
  assert.doesNotMatch(stripAnsi(layout.lines[1]!), /HEALTH|ACTIVE|QUIET|ARCHIVED/);
});

test("header chip fitting drops QUIET then ARCHIVED then ACTIVE and retains sessions", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => fleet().map(row => ({ ...row, id: `${row.id}-${i}`, ...(row.parentId ? { parentId: `${row.parentId}-${i}` } : {}) }))).flat();
  const tiers = (width: number) => {
    const layout = renderSessions(buildRenderModel({ sessions, width, now: COCKPIT_NOW }));
    assert.ok(layout.lines.every(line => visibleWidth(line) === width));
    assert.match(stripAnsi(layout.lines[width <= 60 ? 0 : 1]!), /80 sessions/);
    return layout.tierChips.map(chip => chip.tier);
  };
  assert.deepEqual(tiers(120), ["needs-you", "health", "active", "quiet", "archived"]);
  assert.deepEqual(tiers(80), ["needs-you", "health", "active", "archived"]);
  assert.deepEqual(tiers(70), ["needs-you", "health", "active"]);
  assert.deepEqual(tiers(50), ["needs-you", "health"]);
  assert.deepEqual(tiers(34), ["needs-you"]);
  assert.deepEqual(tiers(30), []);
});

test("list reclaims the navigator columns without changing workspace geometry", () => {
  for (const width of [30, 60, 80, 100, 120, 160]) {
    const model = modelWithWorkspace({ sessions: fleet(), width, selectedId: "docs", now: COCKPIT_NOW });
    const layout = renderSessions(model);
    assert.doesNotMatch(layout.lines.join("\n"), /TIERS/);
    const inset = width <= 60 ? 0 : 1;
    const workspaceWidth = width >= 160 ? 44 : width >= 120 ? 34 : 0;
    assert.equal(layout.listStartX, 1 + inset);
    assert.equal(layout.listWidth, width - 2 * inset - (workspaceWidth ? workspaceWidth + 1 : 0));
    if (workspaceWidth) assert.equal(layout.workspaceStartX, width - workspaceWidth);
  }
});

test("Repo headings still truncate long repository names before dropping workflow columns", () => {
  const row = { ...fleet().find(row => row.id === "release")!, cwd: "/tmp/repository-with-a-very-long-name-that-needs-truncation" };
  const layout = renderSessions(buildRenderModel({ sessions: [row], width: 60, fleetGrouping: "repo" }));
  const header = stripAnsi(layout.lines.find(line => stripAnsi(line).startsWith("─▾ repository-"))!);
  assert.match(header, /…\s+·1\s+PL EX RV$/);
});

test("board, Repo, pin and full-screen workspace headers have no chip targets", () => {
  for (const options of [{ grouping: "stage" as const }, { fleetGrouping: "repo" as const }, { pinSlots: ["docs"] }, { width: 60, workspaceFullScreen: true }]) {
    const layout = renderSessions(modelWithWorkspace({ sessions: fleet(), selectedId: "docs", width: 160, ...options }));
    assert.deepEqual(layout.tierChips, []);
    assert.equal(layout.tierChipRow, undefined);
  }
});
