import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
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

for (const width of [120, 160]) {
  for (const fleetGrouping of ["status", "repo"] as const) {
    test(`30 parents fit as one-line modules beside the docked card at ${width} in ${fleetGrouping}`, () => {
      // The dock below the list takes ten rows plus its rule on a tall window.
      const layout = render(fleet(30), { width, fleetGrouping, height: 46 });
      assert.equal(layout.rowTargets.filter((target) => target?.kind === "session").length, 30);
      for (let index = 0; index < 30; index += 1) assert.ok(continuations(layout, `s${index}`) <= (index ? 1 : 10));
      assert.equal(layout.listScrollTop, 0);
      assert.doesNotMatch(layout.lines.map(stripAnsi).join("\n"), /[↑↓] \d+ more/);
      const row = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
      assert.match(row, /Task 1 {3}core/);
      // Module title rows end with their age; workflow position lives in STEP.
      assert.match(row, /23m$/);
      assert.doesNotMatch(row, /◉/);
      assert.ok(layout.lines.every((line) => visibleWidth(line) <= width));
      assert.ok(layout.lines[titleIndex(layout, "s1")]!.includes(styleToken(darkTheme, "muted", "core")));
    });
  }
}

for (const width of [160]) {
  for (const fleetGrouping of ["status", "repo"] as const) {
    test(`mixed dense rows align group and age before the section grid at ${width} in ${fleetGrouping}`, () => {
      const sessions = fleet(30);
      sessions[2] = { ...sessions[2]!, workflow: undefined, group: "tools", lastActivityAt: NOW - 7 * 60_000 };
      sessions[3] = { ...sessions[3]!, workflow: { ...workflow, activeIndex: 0, steps: [{ id: "other", short: "OT" }] } };
      // A shorter window forces the dense rung, whose rows share one grid.
      const layout = render(sessions, { width, fleetGrouping, height: 36 });
      const withWorkflow = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
      const withoutWorkflow = stripAnsi(layout.lines[titleIndex(layout, "s2")]!);
      const otherWorkflow = stripAnsi(layout.lines[titleIndex(layout, "s3")]!);
      const header = layout.lines.map(stripAnsi).find(line => /PL\s+EX\s+RV/.test(line))!;
      const ageEnd = withWorkflow.indexOf("23m") + 3;
      assert.equal(withoutWorkflow.indexOf("7m") + 2, ageEnd);
      assert.equal(otherWorkflow.indexOf("23m") + 3, ageEnd);
      assert.match(otherWorkflow, /◉OT/);
      assert.match(withoutWorkflow.slice(header.indexOf("PL"), layout.listStartX - 1 + layout.listWidth), /^\s*$/);
      assert.equal(continuations(layout, "s2"), 0);
      assert.ok(layout.lines.every(line => visibleWidth(line) <= width));

      const noGrid = render(sessions.map(session => ({ ...session, workflow: undefined })), { width, fleetGrouping, height: 36 });
      const noGridRow = stripAnsi(noGrid.lines[titleIndex(noGrid, "s2")]!);
      assert.ok(noGridRow.indexOf("7m") + 2 > ageEnd);
    });
  }
}

const busy = (count: number) => fleet(count).map((session, index) => index ? { ...session, workflow: { ...workflow, activity: { id: `a${index}`, label: `Working ${index}` } } } : session);

test("eight parents keep their activity line when every neighbor fits", () => {
  const layout = render(busy(8));
  // The selected module keeps its STEP line in the list; the dock adds its full card below.
  assert.ok(continuations(layout, "s0") >= 2);
  // NOW and the STEP readout.
  for (let index = 1; index < 8; index += 1) assert.equal(continuations(layout, `s${index}`), 2);
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
  assert.equal(seen.at(-1), 14);
});

test("dense tail drops group before age, then grid before an unreadable title", () => {
  const sessions = fleet(30).map((session) => ({ ...session, title: "Readable title", group: "a-very-long-group-label-that-cannot-fit-beside-the-title-and-grid" }));
  // A short window forces dense rows, whose tail carries group · age.
  const layout = render(sessions, { width: 80, height: 20 });
  const row = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
  assert.match(row, /Readable title/);
  assert.doesNotMatch(row, /a-very-long-group-label/);
  assert.match(row, /23m/);
  const tight = render(sessions, { width: 61 });
  assert.match(stripAnsi(tight.lines[titleIndex(tight, "s1")]!), /Readable/);
});

test("dense rows retain trailing worktree and new markers after the bold title", () => {
  const sessions = fleet(30);
  sessions[1] = { ...sessions[1]!, worktreeBranch: "feature/dense", unopened: true };
  const layout = render(sessions, { fleetGrouping: "repo" });
  const row = layout.lines[titleIndex(layout, "s1")]!;
  assert.match(stripAnsi(row), /Task 1 ⎇ new/);
  assert.match(row, /\u001b\[1m[^]*Task 1/);
});

test("age drops before the aligned grid when the title reaches its readable minimum", () => {
  // The first short is two cells wider to use the columns the frameless shell returned to the list.
  const steps = Array.from({ length: 7 }, (_, index) => ({ id: `step-${index}`, short: index === 0 ? `STEP00000${index}` : `STEP00${index}`, label: `Step ${index}` }));
  const sessions = fleet(30).map((session) => ({ ...session, title: "Readable title", workflow: { ...workflow, steps } }));
  const layout = render(sessions, { width: 80, height: 36 });
  const header = layout.lines.map(stripAnsi).find((line) => line.includes("STEP00"))!;
  const row = stripAnsi(layout.lines[titleIndex(layout, "s1")]!);
  assert.match(row, /Readable/);
  assert.doesNotMatch(row, /core|23m/);
  for (const [index, step] of steps.entries()) assert.equal(row[header.indexOf(step.short)], index === 0 ? "✓" : index === 1 ? "◉" : "·");
});

test("below 80 columns modules name their step in words instead of an over-wide grid", () => {
  const steps = Array.from({ length: 6 }, (_, index) => ({ id: `step-${index}`, short: `STEP0${index}`, label: `Step ${index}` }));
  const sessions = fleet(8).map((session) => ({ ...session, title: "Readable title", workflow: { ...workflow, steps } }));
  const layout = render(sessions, { width: 61 });
  const index = titleIndex(layout, "s1");
  assert.match(stripAnsi(layout.lines[index]!), /Readable title/);
  assert.doesNotMatch(stripAnsi(layout.lines[index]!), /✓\s+◉\s+·|◉STEP|Step 1/);
  assert.match(stripAnsi(layout.lines[index + 1]!), /STEP {2}Step 1 *$/);
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
  assert.ok(continuations(layout, "s25") >= 1);
  assert.ok(layout.rowTargets.filter((target) => target?.kind === "session").length < 50);
  for (const target of layout.rowTargets) {
    if (target?.kind === "session-continuation") assert.equal(target.id, "s25");
  }
});
