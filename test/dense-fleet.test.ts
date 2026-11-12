import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions, type SessionsLayout } from "../src/tui/layout.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";

const NOW = 1_800_000_000_000;
const workflow = {
  version: 1 as const, source: "test", activeIndex: 1, updatedAt: NOW,
  steps: [{ id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" }, { id: "review", short: "RV", label: "Review" }],
};
function fleet(count: number): RuntimeSession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `s${index}`, title: `Task ${index}`, cwd: "/tmp/repo", group: "core", tmuxSession: `pi-agent-hub-s${index}`,
    status: "running", createdAt: NOW - 120_000, updatedAt: NOW, lastActivityAt: NOW - 23 * 60_000, workflow,
    ...(index === 0 ? { context: { version: 1 as const, updatedAt: NOW, ticket: { id: "dense-001", subtitle: "Keep the selected card rich" } } } : {}),
  }));
}
function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  return renderSessions(buildRenderModel({ sessions, selectedId: "s0", width: 160, height: 44, now: NOW, guidanceHidden: true, ...input }), darkTheme);
}
function titleIndex(layout: SessionsLayout, id: string): number {
  return layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id);
}
function continuations(layout: SessionsLayout, id: string): number {
  return layout.rowTargets.filter((target) => target?.kind === "session-continuation" && target.id === id).length;
}
/** The roster's and the side pane's text on one screen row. */
function columns(layout: SessionsLayout, row: number): { roster: string; pane: string } {
  const line = stripAnsi(layout.lines[row] ?? "");
  return { roster: sliceByColumn(line, 0, layout.listWidth), pane: sliceByColumn(line, layout.listWidth + 1, visibleWidth(line)) };
}
function paneText(layout: SessionsLayout): string {
  return layout.lines.map((_line, row) => columns(layout, row).pane).join("\n");
}

for (const width of [120, 160]) {
  for (const fleetGrouping of ["status", "repo"] as const) {
    test(`30 parents fit as one-line modules beside the side pane at ${width} in ${fleetGrouping}`, () => {
      const layout = render(fleet(30), { width, fleetGrouping, height: 46 });
      assert.equal(layout.rowTargets.filter((target) => target?.kind === "session").length, 30);
      // The selected card sits in the pane beside the roster; its rows are not roster targets. Only s0 has a
      // task, which its quiet status line names when the title row has no room for it (below 160).
      for (let index = 1; index < 30; index += 1) assert.equal(continuations(layout, `s${index}`), 0);
      assert.equal(continuations(layout, "s0"), width < 160 ? 1 : 0);
      assert.equal(layout.listScrollTop, 0);
      assert.doesNotMatch(layout.lines.map(stripAnsi).join("\n"), /[↑↓] \d+ more|─{20,}$/m);
      const row = columns(layout, titleIndex(layout, "s1")).roster;
      assert.match(row, /Task 1 {3}core/);
      // Module title rows end with the step short and the age; the grid lives in the card's WHERE.
      assert.match(row, /EX {2}23m$/);
      assert.doesNotMatch(row, /◉/);
      assert.match(paneText(layout), /Task 0[^]*Keep the selected card rich[^]*PL✓ EX◉ RV·/);
      assert.ok(layout.lines.every((line) => visibleWidth(line) <= width));
      assert.ok(layout.lines[titleIndex(layout, "s1")]!.includes(styleToken(darkTheme, "muted", "core")));
    });
  }
}

for (const width of [160]) {
  for (const fleetGrouping of ["status", "repo"] as const) {
    test(`mixed dense rows end with their step and one age column at ${width} in ${fleetGrouping}`, () => {
      const sessions = fleet(30);
      sessions[2] = { ...sessions[2]!, workflow: undefined, group: "tools", lastActivityAt: NOW - 7 * 60_000 };
      sessions[3] = { ...sessions[3]!, workflow: { ...workflow, activeIndex: 0, steps: [{ id: "other", short: "OT" }] } };
      // A short window forces the dense rung, whose rows share one grid.
      const layout = render(sessions, { width, fleetGrouping, height: 20 });
      const withWorkflow = columns(layout, titleIndex(layout, "s1")).roster;
      const withoutWorkflow = columns(layout, titleIndex(layout, "s2")).roster;
      const otherWorkflow = columns(layout, titleIndex(layout, "s3")).roster;
      // Dense rows are module title rows: no shared grid, so no heading names workflow columns.
      assert.ok(!layout.lines.some((_line, row) => /PL\s+EX\s+RV/.test(columns(layout, row).roster)));
      const ageEnd = withWorkflow.indexOf("23m") + 3;
      assert.equal(ageEnd, layout.listWidth);
      assert.equal(withoutWorkflow.indexOf("7m") + 2, ageEnd);
      assert.equal(otherWorkflow.indexOf("23m") + 3, ageEnd);
      // Each row names its own step before the age, whatever its pipeline; a row without workflow names none.
      assert.match(withWorkflow, /core.* EX  23m$/);
      assert.match(otherWorkflow, / OT  23m$/);
      assert.match(withoutWorkflow, /tools( ACTIVE)?\s+ 7m$/);
      assert.equal(continuations(layout, "s2"), 0);
      assert.ok(layout.lines.every(line => visibleWidth(line) <= width));
    });
  }
}

const busy = (count: number) => fleet(count).map((session, index) => index ? { ...session, workflow: { ...workflow, lens: { doing: `Working ${index}` } } } : session);

test("eight parents keep their activity line when every neighbor fits", () => {
  const layout = render(busy(8));
  // The selected module has no lens; at 160 its title row already names its task, so it keeps one row.
  assert.equal(continuations(layout, "s0"), 0);
  // One DOING status line each; WHERE lives only in the card.
  for (let index = 1; index < 8; index += 1) {
    assert.equal(continuations(layout, `s${index}`), 1);
    assert.match(columns(layout, titleIndex(layout, `s${index}`) + 1).roster, new RegExp(`DOING {2}Working ${index}`));
  }
  assert.doesNotMatch(layout.lines.map((_line, row) => columns(layout, row).roster).join("\n"), /WHERE|PL✓/);
});

test("neighbor activity lines appear together only once all of them fit", () => {
  const seen: number[] = [];
  for (let height = 12; height <= 40; height += 1) {
    const layout = render(busy(8), { height });
    if (layout.rowTargets.filter((target) => target?.kind === "session").length < 8) continue;
    const kept = Array.from({ length: 7 }, (_, index) => continuations(layout, `s${index + 1}`));
    seen.push(kept.reduce((sum, value) => sum + value, 0));
  }
  // Rows only gain activity as height grows, ending with every neighbor's line.
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
  assert.equal(seen.at(-1), 7);
});

test("a dense row keeps its whole title and age; an over-long group is cut, then dropped", () => {
  const sessions = fleet(30).map((session) => ({ ...session, title: "Readable title", group: "a-very-long-group-label-that-cannot-fit-beside-the-title-and-grid" }));
  // A short window forces dense rows, whose tail carries group · age.
  const layout = render(sessions, { width: 80, height: 20 });
  const row = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
  assert.match(row, /Readable title {3}a-very-long-group-label.*… EX  23m$/);
  assert.equal(visibleWidth(row), 80);
  const tight = stripAnsi(render(sessions, { width: 34, height: 20 }).lines[titleIndex(render(sessions, { width: 34, height: 20 }), "s1")]!);
  assert.match(tight, /Readable title/);
  assert.match(tight, /23m$/);
  assert.doesNotMatch(tight, /a-very/);
});

test("dense rows retain trailing worktree and new markers after the bold title", () => {
  const sessions = fleet(30);
  sessions[1] = { ...sessions[1]!, worktreeBranch: "feature/dense", unopened: true };
  const layout = render(sessions, { fleetGrouping: "repo" });
  const row = layout.lines[titleIndex(layout, "s1")]!;
  assert.match(stripAnsi(row), /Task 1 ⎇ new/);
  assert.match(row, /\u001b\[1m[^]*Task 1/);
});

test("a dense row names only its current step, however many steps the pipeline has", () => {
  const steps = Array.from({ length: 7 }, (_, index) => ({ id: `step-${index}`, short: index === 0 ? `STEP00000${index}` : `STEP00${index}`, label: `Step ${index}` }));
  const sessions = fleet(30).map((session) => ({ ...session, title: "Readable title", workflow: { ...workflow, steps } }));
  const layout = render(sessions, { width: 80, height: 36 });
  const row = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
  assert.match(row, /Readable title {3}core +STEP001  23m$/);
  // No tier heading lists the pipeline's steps; only the docked card's WHERE line does.
  assert.ok(!layout.lines.map(stripAnsi).some((line) => / ── /.test(line) && /STEP00/.test(line)));
});

test("below 80 columns modules name their step short instead of an over-wide grid", () => {
  const steps = Array.from({ length: 6 }, (_, index) => ({ id: `step-${index}`, short: `STEP0${index}`, label: `Step ${index}` }));
  const sessions = fleet(8).map((session) => ({ ...session, title: "Readable title", workflow: { ...workflow, steps } }));
  const layout = render(sessions, { width: 61 });
  const index = titleIndex(layout, "s1");
  assert.match(stripAnsi(layout.lines[index]!), /Readable title/);
  assert.doesNotMatch(stripAnsi(layout.lines[index]!), /✓\s+◉\s+·|◉STEP|Step 1/);
  // The title row carries the step short before the age; a session with no status has no second line.
  assert.match(stripAnsi(layout.lines[index]!), /STEP01 {2}23m$/);
  assert.deepEqual(layout.rowTargets[index + 1], { kind: "session", id: "s2" });
});

for (const width of [120, 160]) {
  test(`dense row clicks select the exact session with a real workspace at ${width}`, () => {
    const controller = new SessionsController({ version: 1, sessions: fleet(30) });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 46, now: () => NOW });
    const rendered = view.render(width);
    const state = view as unknown as Pick<SessionsLayout, "rowTargets" | "listStartX">;
    assert.equal(state.rowTargets.filter((target) => target?.kind === "session").length, 30);
    const row = state.rowTargets.findIndex((target) => target?.kind === "session" && target.id === "s10");
    assert.ok(row >= 0);
    assert.equal(state.rowTargets.filter((target) => target && "id" in target && target.id === "s10").length, 1);
    assert.match(stripAnsi(rendered[row]!), /Task 10 {3}core/);
    view.handleInput(`\u001b[<0;${state.listStartX + 10};${row + 1}M`);
    assert.equal(controller.selected()?.id, "s10");
    view.render(width);
    view.handleInput("j");
    assert.equal(controller.selected()?.id, "s11");
    assert.ok(rendered.every((line) => visibleWidth(line) <= width));
  });
}

test("short windows keep the selected row one line, like its neighbors, and dock its group", () => {
  const sessions = fleet(8);
  sessions[0]!.title = "Readable title without repeated group";
  for (const width of [61, 80, 99]) {
    const layout = render(sessions, { width, height: 18 });
    const index = titleIndex(layout, "s0");
    const lines = layout.lines.map(stripAnsi);
    assert.match(lines[index]!, /Readable title without repeated group/);
    // Like every neighbor in a short window, the selected row is a single line with its progress.
    assert.notDeepEqual(layout.rowTargets[index + 1], { kind: "session-continuation", id: "s0" });
    const rule = lines.findIndex((line, row) => row > 0 && /^─{20,}$/u.test(line.trim()));
    assert.ok(rule > index, lines.join("\n"));
    assert.match(lines[rule + 1]!, /Readable title without repeated group {2}core/);
  }
});

test("overflow still windows after the one-line rung and preserves the selected card", () => {
  const layout = render(fleet(50), { selectedId: "s25" });
  assert.ok(titleIndex(layout, "s25") >= 0);
  assert.ok(layout.rowTargets.filter((target) => target?.kind === "session").length < 50);
  // The card stays in the side pane, whatever part of the roster is windowed in.
  assert.equal(layout.rowTargets.filter((target) => target?.kind === "session-continuation").length, 0);
  assert.match(paneText(layout), /Task 25[^]*PL✓ EX◉ RV·/);
  assert.doesNotMatch(paneText(layout), /Task (?!25)\d/);
  assert.ok(layout.lines.every((line) => visibleWidth(line) <= 160));
});
