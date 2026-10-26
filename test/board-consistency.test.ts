import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";

const steps = [
  { id: "plan", short: "PL", label: "Plan" },
  { id: "execute", short: "EX", label: "Execute" },
  { id: "review", short: "RV", label: "Review" },
  { id: "reflect", short: "RF", label: "Reflect" },
  { id: "commit", short: "CM", label: "Commit" },
];
function session(id: string, overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return { id, title: `Card ${id}`, group: "data", cwd: "/tmp/data", tmuxSession: id, status: "idle",
    createdAt: 1, updatedAt: 1, lastActivityAt: 1, workflow: { steps, activeIndex: 1, updatedAt: 1 }, ...overrides };
}
function render(sessions: RuntimeSession[], width: number, selectedId = sessions[0]!.id, workspace = false) {
  const selected = sessions.find(session => session.id === selectedId)!;
  const commands = buildDashboardCommands({ sessions, selectedId, capabilities: { openSession: true } });
  return renderSessions(buildRenderModel({ sessions, selectedId, width, height: 60, now: 100_000, grouping: "stage", guidanceHidden: true,
    ...(workspace ? { workspaceCommands: selectWorkspaceCommands(selected, commands, 3) } : {}) }), darkTheme);
}

for (const width of [120, 160]) {
  for (const workspace of [false, true]) {
    test(`${width}-column board uses aligned fleet grid markers (${workspace ? "with" : "without"} workspace)`, () => {
      const layout = render([session("first"), session("complete", { workflow: { steps, activeIndex: 1, currentStepComplete: true, updatedAt: 2 } })], width, "first", workspace);
      const lines = layout.lines.map(line => stripAnsi(line).slice(layout.listStartX - 1, layout.listStartX - 1 + layout.listWidth));
      const header = lines.find(line => line.includes("EXECUTE 2"))!;
      assert.ok(header, lines.join("\n"));
      const columns = steps.map(step => header.lastIndexOf(step.short));
      assert.ok(columns.every(column => column >= 0), header);
      for (const id of ["first", "complete"]) {
        const row = lines[layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === id)]!;
        const expected = id === "first" ? ["✓", "◉", "·", "·", "·"] : ["✓", "✓", "·", "·", "·"];
        assert.deepEqual(columns.map(column => row[column]), expected, row);
        assert.doesNotMatch(row, /PL|EX|RV|RF|CM|\[data\]/);
      }
      assert.ok(layout.lines.every(line => visibleWidth(line) <= width));
      assert.match(lines.join("\n"), /S Fleet/);
    });
  }
}

test("board shares the projection's canonical vocabulary across lanes and OTHER ACTIVE", () => {
  const renamed = steps.map(step => step.id === "plan" ? { ...step, short: "PN" } : step);
  const alternate = [{ id: "discover", short: "DS", label: "Discover" }];
  const layout = render([
    session("old", { workflow: { steps, activeIndex: 0, updatedAt: 1 } }),
    session("new", { workflow: { steps: renamed, activeIndex: 1, updatedAt: 2 } }),
    session("plain", { workflow: undefined }),
    session("alternate", { workflow: { steps: alternate, activeIndex: 0, updatedAt: 3 } }),
  ], 160);
  const lines = layout.lines.map(stripAnsi);
  for (const title of ["PLAN 1", "EXECUTE 1", "OTHER ACTIVE 2"]) {
    const header = lines.find(line => line.includes(title))!;
    assert.match(header, /PN\s+EX\s+RV\s+RF\s+CM/, header);
    assert.doesNotMatch(header, /\bPL\b|\bDS\b/);
  }
  const row = (id: string) => lines[layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === id)]!;
  assert.match(row("old"), /◉PL/);
  assert.match(row("alternate"), /◉DS/);
  assert.doesNotMatch(row("plain"), /[✓◉]|DS/);
});

test("board lane labels are bold tier-tone and group headings are muted attention-only", () => {
  const asking = session("ask", { status: "waiting", context: { version: 1, updatedAt: 1,
    attention: { kind: "question", text: "Choose one", requestId: "r1" } } });
  const layout = render([asking, session("quiet", { group: "quiet" })], 160);
  const header = layout.lines.find(line => stripAnsi(line).includes("EXECUTE 2"))!;
  assert.ok(header.includes(`\u001b[1m${styleToken(darkTheme, "success", " EXECUTE 2 ")}\u001b[22m`), header);
  const group = layout.lines.find(line => /^│\s+data\s+\?1\s*│/.test(stripAnsi(line)))!;
  assert.ok(group, layout.lines.map(stripAnsi).join("\n"));
  assert.ok(group.includes(styleToken(darkTheme, "muted", "data")), group);
  assert.ok(group.includes(styleToken(darkTheme, "warning", "?1")), group);
  assert.doesNotMatch(stripAnsi(group), /·[0-9]|◐/);
  const quiet = layout.lines.find(line => /^│\s+quiet\s+│/.test(stripAnsi(line)))!;
  assert.ok(quiet);
  assert.doesNotMatch(stripAnsi(quiet), /\?[0-9]|·[0-9]/);
});

test("narrow board retains the current step when the grid would crowd the title", () => {
  const layout = render([session("long", { title: "Important task title" })], 40);
  const index = layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === "long");
  const row = stripAnsi(layout.lines[index]!);
  assert.match(row, /Important/);
  assert.match(row, /◉EX/);
  assert.ok(layout.lines.every(line => visibleWidth(line) <= 40));
});

test("board grid leaves the Repo Backlog workflow rail unchanged", () => {
  const layout = renderSessions(buildRenderModel({ sessions: [session("backlog", { bucket: "backlog" })],
    width: 160, fleetGrouping: "repo", now: 100_000 }));
  const index = layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === "backlog");
  const row = stripAnsi(layout.lines[index]!);
  assert.match(row, /backlog · QUIET · ✓ PL─◉ EX─· RV─· RF─· CM/);
});

test("narrow boards retain group badges when group headings are absent", () => {
  const layout = render([session("one")], 60);
  assert.match(layout.lines.map(stripAnsi).join("\n"), /\[data\] Card one/);
  assert.ok(layout.lines.every(line => visibleWidth(line) <= 60));
});
