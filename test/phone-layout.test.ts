import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";

const steps = [
  { id: "plan", short: "PL", label: "Plan" }, { id: "execute", short: "EX", label: "Execute" },
  { id: "review", short: "RV", label: "Review" }, { id: "reflect", short: "RF", label: "Reflect" },
  { id: "commit", short: "CM", label: "Commit" },
];
const sessions: RuntimeSession[] = ["Product redesign direction", "Hub maintenance", "Topic editor", "Homepage refinement"].map((title, index) => ({
  id: `s${index}`, title, cwd: "/tmp/repo", group: "agent-atlas", tmuxSession: `pi-agent-hub-s${index}`,
  status: "idle", createdAt: 1, updatedAt: 1,
  context: { version: 1, updatedAt: 1, ticket: { id: `t-${index}`, subtitle: "Task explanation text" } },
  workflow: { version: 1, source: "test", activeIndex: index % 5, updatedAt: 1, steps },
}));

function render(input: Partial<BuildRenderModelInput> & { width: number; height: number }) {
  const layout = renderSessions(buildRenderModel({ sessions, selectedId: "s0", now: 1, ...input }), darkTheme);
  return { layout, lines: layout.lines.map(stripAnsi) };
}

function titleIndex(layout: ReturnType<typeof renderSessions>, id: string): number {
  return layout.rowTargets.findIndex((target) => target?.kind === "session" && target.id === id);
}

test("phone widths drop the outer frame and start content at the first column", () => {
  for (const width of [30, 36, 44, 60]) {
    const { layout, lines } = render({ width, height: 22 });
    assert.equal(lines.length, 22);
    assert.ok(lines.every((line) => !/[╭╰│]/.test(line[0] ?? "")), `${width}: framed`);
    assert.match(lines[0]!, /^FLEET/);
    assert.equal(layout.listStartX, 1);
    assert.ok(layout.lines.every((line) => visibleWidth(line) <= width));
    const index = titleIndex(layout, "s0");
    assert.ok(lines[index]!.includes("Product"), `${width}: ${lines[index]}`);
  }
  const wide = render({ width: 61, height: 22 });
  assert.match(wide.lines[0]!, /^╭/);
  assert.equal(wide.layout.listStartX, 2);
});

test("phone grid uses three-cell columns and narrow phones show the current step instead", () => {
  const { layout, lines } = render({ width: 44, height: 30 });
  const header = lines.find((line) => line.includes("PL EX RV RF CM"));
  assert.ok(header, lines.join("\n"));
  for (const session of sessions) {
    const index = titleIndex(layout, session.id);
    const active = session.workflow!.activeIndex;
    assert.equal(lines[index + 1]![header.indexOf(steps[active]!.short)], "◉", lines[index + 1]);
  }

  const narrow = render({ width: 36, height: 30 });
  assert.equal(narrow.lines.some((line) => /PL\s+EX/.test(line)), false);
  const index = titleIndex(narrow.layout, "s1");
  assert.match(narrow.lines[index + 1]!, /◉EX/);
});

test("short phone windows use one-line rows and keep metadata only for the selected row", () => {
  const { layout, lines } = render({ width: 44, height: 14, selectedId: "s1" });
  const header = lines.find((line) => line.includes("PL EX RV RF CM"))!;
  for (const session of sessions) {
    const index = titleIndex(layout, session.id);
    if (index < 0) continue;
    assert.equal(lines[index]![header.indexOf(steps[session.workflow!.activeIndex]!.short)], "◉", lines[index]);
    const next = layout.rowTargets[index + 1];
    if (session.id === "s1") {
      assert.deepEqual(next, { kind: "session-continuation", id: "s1" });
      assert.match(lines[index + 1]!, /\[agent-atlas\]/);
    } else assert.notDeepEqual(next, { kind: "session-continuation", id: session.id });
  }
  assert.equal(lines.some((line) => line.includes("Task explanation")), false);
});

test("phone footer drops whole items and exposes tap targets for each key", () => {
  const { layout, lines } = render({ width: 44, height: 22 });
  const footer = lines.at(-1)!;
  assert.equal(footer.trimEnd(), "Enter Open · i Info · : Actions · / Filter");
  assert.equal(layout.footerRow, lines.length - 1);
  const keys = layout.footerItems.map((item) => item.key);
  assert.deepEqual(keys, ["Enter", "i", ":", "/"]);
  for (const item of layout.footerItems) assert.equal(footer.slice(item.x - 1, item.x - 1 + item.key.length), item.key);

  const tiny = render({ width: 30, height: 22 });
  assert.ok(!tiny.lines.at(-1)!.includes("…"), tiny.lines.at(-1));
});

test("hidden pins keep slot markers but leave pin mode", () => {
  const model = buildRenderModel({ sessions, selectedId: "s0", now: 1, width: 44, height: 22, pinSlots: ["s0", "s2"], pinsHidden: true, pinConstrained: true });
  assert.equal(model.pinMode, false);
  const layout = renderSessions(model);
  const lines = layout.lines.map(stripAnsi);
  assert.match(lines[0]!, /^FLEET .*2 pins hidden/);
  assert.equal(lines.some((line) => line.includes("constrained")), false);
  assert.ok(lines[titleIndex(layout, "s2")]!.includes("▢2"));
});

test("full-screen workspace on a phone is frameless with a tappable Back control", () => {
  const selected = sessions[0]!;
  const commands = buildDashboardCommands({ sessions, selectedId: selected.id, capabilities: { openSession: true } });
  const model = buildRenderModel({ sessions, selectedId: "s0", now: 1, width: 44, height: 20, workspaceFullScreen: true,
    workspaceCommands: selectWorkspaceCommands(selected, commands, 3) });
  const layout = renderSessions(model);
  const lines = layout.lines.map(stripAnsi);
  assert.equal(lines.length, 20);
  assert.ok(lines.every((line) => !/[╭╰│]/.test(line[0] ?? "")));
  assert.equal(layout.footerItems[0]?.key, "Esc");
  assert.equal(layout.footerRow, 19);
  const target = layout.workspaceRowTargets.findIndex(Boolean);
  assert.ok(target >= 0 && layout.workspaceStartX === 1);
});
