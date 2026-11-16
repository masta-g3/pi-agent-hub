import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession, WorkflowRuntimeSnapshot } from "../src/core/types.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import { parseEntryOrchestration, parseWorkflowEntry } from "../src/core/heartbeat.js";
import { ORCHESTRATION_EPIC_ENTRY, ORCHESTRATION_PLANNING_ENTRY } from "./fixtures/orchestration.js";

const NOW = 1_800_000_000_000;
const STEPS = [{ id: "plan-md", short: "PL" }, { id: "execute", short: "EX" }, { id: "review", short: "RV" }];
const runnerWorkflow = (ticketId: string, activeIndex = 1): WorkflowRuntimeSnapshot => ({ steps: STEPS, activeIndex, ticketId, updatedAt: NOW });
function session(id: string, values: Partial<RuntimeSession> = {}): RuntimeSession {
  return { id, title: `Title-${id}`, cwd: "/tmp/repo", group: "team", tmuxSession: id,
    status: "running", createdAt: NOW - 120_000, updatedAt: NOW, lastActivityAt: NOW - 180_000, ...values };
}
function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  return renderSessions(buildRenderModel({ sessions, selectedId: sessions[0]!.id, width: 120,
    height: 60, now: NOW, guidanceHidden: true, ...input }), darkTheme);
}
function lineOf(layout: ReturnType<typeof render>, id: string): string {
  const index = layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === id);
  assert.notEqual(index, -1, `missing row for ${id}`);
  return stripAnsi(layout.lines[index]!);
}

const epic = parseWorkflowEntry(ORCHESTRATION_EPIC_ENTRY) as { lens: NonNullable<RuntimeSession["lens"]> };
const orchestration = parseEntryOrchestration(ORCHESTRATION_EPIC_ENTRY)!;
const orchestrator = (values: Partial<RuntimeSession> = {}) => session("orch", { title: "Run sfcity epic", lens: epic.lens, orchestration, ...values });
const runner = (id: string, ticketId: string, values: Partial<RuntimeSession> = {}) => session(id, { kind: "subagent", parentId: "orch", agentName: "ticket-runner", workflow: runnerWorkflow(ticketId), ...values });
const expanded = { expandedProjectParentIds: new Set(["orch", "plain"]), expandedBoardParentIds: new Set(["orch", "plain"]) };

test("an orchestrator carries the marker after its title on fleet, card and board rows", () => {
  const rows = [session("first"), orchestrator()];
  for (const grouping of ["project", "stage"] as const) {
    // Unselected: roster card row, or board row.
    assert.match(lineOf(render(rows, { grouping }), "orch"), /Run sfcity epic ⊛/, grouping);
    // Selected: the fleet card title, or the board row.
    const selected = render(rows, { grouping, selectedId: "orch" });
    assert.ok(selected.lines.some(line => /Run sfcity epic ⊛/.test(stripAnsi(line))), `${grouping} selected`);
  }
  // Short windows draw one-line rows.
  assert.match(lineOf(render(rows, { height: 12 }), "orch"), /Run sfcity epic ⊛/);
  assert.doesNotMatch(lineOf(render(rows), "first"), /⊛/);
});

test("the marker shows while the orchestrator plans its next ticket", () => {
  const planning = parseWorkflowEntry(ORCHESTRATION_PLANNING_ENTRY) as WorkflowRuntimeSnapshot;
  assert.ok("steps" in planning);
  const rows = [session("first"), orchestrator({ lens: undefined, workflow: planning, orchestration: parseEntryOrchestration(ORCHESTRATION_PLANNING_ENTRY) })];
  for (const grouping of ["project", "stage"] as const) assert.match(lineOf(render(rows, { grouping }), "orch"), /Run sfcity epic ⊛/, grouping);
});

test("ticket runners show the marker and their ticket; other children stay plain", () => {
  const rows = [
    orchestrator(),
    runner("r1", "sfcity-012"),
    runner("r2", "SFCITY-013"),
    runner("stray", "other-001"),
    session("critic", { kind: "subagent", parentId: "r1", agentName: "code-critic", workflow: runnerWorkflow("sfcity-012") }),
    session("plain"),
    session("plain-child", { kind: "subagent", parentId: "plain", agentName: "ticket-runner", workflow: runnerWorkflow("sfcity-012") }),
  ];
  for (const grouping of ["project", "stage"] as const) {
    const layout = render(rows, { grouping, ...expanded, expandedProjectParentIds: new Set(["orch", "plain", "r1"]), expandedBoardParentIds: new Set(["orch", "plain", "r1"]) });
    assert.match(lineOf(layout, "r1"), /⊛ sfcity-012\s+EX/, grouping);
    assert.doesNotMatch(lineOf(layout, "r1"), /ticket-runner/);
    assert.match(lineOf(layout, "r2"), /⊛ sfcity-013/, grouping);
    for (const id of ["stray", "plain-child"]) {
      assert.doesNotMatch(lineOf(layout, id), /⊛/, `${grouping} ${id}`);
      assert.match(lineOf(layout, id), /ticket-runner/);
    }
    assert.doesNotMatch(lineOf(layout, "critic"), /⊛/);
    assert.doesNotMatch(lineOf(layout, "plain"), /⊛/);
  }
});

test("long runner ids stay whole so ids differing only in their number stay apart", () => {
  const rows = [
    orchestrator({ orchestration: { ticketIds: ["ticket-identity-003", "ticket-identity-004", "orchestration-ticket-003"] } }),
    runner("a", "ticket-identity-003", { taskPreview: "Run the execute phase", model: { provider: "anthropic", id: "claude-opus-4-5" } }),
    runner("b", "ticket-identity-004", { taskPreview: "Run the execute phase" }),
    runner("c", "orchestration-ticket-003", { taskPreview: "Run the execute phase" }),
  ];
  for (const width of [80, 100, 120]) for (const grouping of ["project", "stage"] as const) {
    const layout = render(rows, { grouping, width, ...expanded });
    assert.match(lineOf(layout, "a"), /⊛ ticket-identity-003/, `${grouping} ${width}`);
    assert.match(lineOf(layout, "b"), /⊛ ticket-identity-004/, `${grouping} ${width}`);
    assert.match(lineOf(layout, "c"), /⊛ orchestration-ticket-003/, `${grouping} ${width}`);
  }
});

test("stopped orchestrators and runners keep their markers", () => {
  const rows = [session("first"), orchestrator({ status: "stopped" }), runner("r1", "sfcity-012", { status: "stopped" })];
  const layout = render(rows, { ...expanded });
  assert.match(lineOf(layout, "orch"), /Run sfcity epic ⊛/);
  assert.match(lineOf(layout, "r1"), /⊛ sfcity-012/);
});

test("the marker outlives title truncation, yields to nothing else, and never overflows", () => {
  const strip = (line: string) => line.replace(/ ⊛(?= |$)/g, "").replace(/\s+/g, " ").trimEnd();
  let sawTruncatedTitle = false;
  for (let width = 30; width <= 160; width += 1) for (const grouping of ["project", "stage"] as const) {
    const parent = orchestrator({ title: "A long orchestrator title that has to be cut", unopened: true, worktreePath: "/tmp/wt", worktreeBranch: "feature" });
    const child = runner("r1", "sfcity-012");
    const input = { width, grouping, selectedId: "first", ...expanded };
    const withMarker = render([session("first"), parent, child], input);
    const line = lineOf(withMarker, "orch");
    for (const each of withMarker.lines) assert.ok(visibleWidth(each) <= width, `${grouping} ${width}: ${stripAnsi(each)}`);
    assert.match(line, /⎇ ⊛/, `${grouping} ${width}: ${line}`);
    if (line.includes("…")) sawTruncatedTitle = true;
    const { orchestration: _orchestration, ...unmarked } = parent;
    const without = render([session("first"), unmarked, child], input).lines.map(stripAnsi);
    const rowIndex = (id: string) => withMarker.rowTargets.findIndex(target => target?.kind === "session" && target.id === id);
    withMarker.lines.map(stripAnsi).forEach((each, index) => {
      // Only the parent title and runner rows change; the title row may cut one more title cell for the marker.
      if (index === rowIndex("orch") || index === rowIndex("r1")) return;
      assert.equal(strip(each), strip(without[index]!), `${grouping} ${width}: ${each}`);
    });
  }
  assert.ok(sawTruncatedTitle, "sweep covers truncated titles");
});

test("new yields before the orchestration marker", () => {
  let sawDroppedNew = false;
  for (const width of [30, 44, 80, 120, 160]) for (const view of [{ fleetGrouping: "repo" as const }, { grouping: "stage" as const }]) {
    const line = lineOf(render([orchestrator({ title: "Long title ".repeat(40), unopened: true })], { width, ...view }), "orch");
    assert.match(line, /Long.*… ⊛/, `${width}: ${line}`);
    sawDroppedNew ||= !line.includes(" new");
  }
  assert.ok(sawDroppedNew);
  assert.match(lineOf(render([orchestrator({ title: "Short", unopened: true })], { fleetGrouping: "repo" }), "orch"), /Short ⊛ new/);
});
