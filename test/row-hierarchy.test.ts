import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { buildRenderModel, type BuildRenderModelInput } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";

const NOW = 1_800_000_000_000;
function session(id: string, values: Partial<RuntimeSession> = {}): RuntimeSession {
  return { id, title: `Title-${id}`, cwd: "/tmp/repo", group: "team", tmuxSession: id,
    status: "idle", createdAt: NOW - 120_000, updatedAt: NOW, ...values };
}
function render(sessions: RuntimeSession[], input: Partial<BuildRenderModelInput> = {}) {
  return renderSessions(buildRenderModel({ sessions, selectedId: sessions[0]!.id, width: 120,
    height: 80, now: NOW, guidanceHidden: true, ...input }), darkTheme);
}
function titleLine(layout: ReturnType<typeof render>, id: string): string {
  const index = layout.rowTargets.findIndex(target => target?.kind === "session" && target.id === id);
  assert.notEqual(index, -1, `missing title for ${id}`);
  return layout.lines[index]!;
}

for (const width of [44, 80, 120, 160]) {
  for (const grouping of ["project", "stage"] as const) {
    test(`${width}-column ${grouping} titles keep one start column and one state slot`, () => {
      const rows = [session("plain"), session("worktree", { worktreePath: "/tmp/wt", worktreeBranch: "feature" }),
        ...(["question", "blocked", "ready"] as const).map(kind => session(kind, { status: "waiting",
          context: { version: 1, updatedAt: NOW, attention: { kind, text: "A request", requestId: kind } } })),
        session("parent"), session("child", { kind: "subagent", parentId: "parent", agentName: "critic" })];
      const layout = render(rows, { width, grouping, ...(grouping === "project" ? { selectedSection: "quiet" as const } : {}) });
      const columns = rows.filter(row => row.kind !== "subagent").map(row => {
        const line = stripAnsi(titleLine(layout, row.id));
        assert.doesNotMatch(line, /·/);
        if (["question", "blocked", "ready"].includes(row.id)) {
          assert.doesNotMatch(line, /[◐○]/);
          assert.match(line, new RegExp(row.id === "question" ? "\\?" : row.id === "ready" ? "✓" : "!"));
        } else assert.match(line, /○/);
        if (row.id === "worktree") assert.ok(line.indexOf("⎇") > line.indexOf(row.title));
        return line.indexOf(row.title);
      });
      assert.equal(new Set(columns).size, 1, columns.join(", "));
      assert.ok(layout.lines.every(line => visibleWidth(line) <= width));
    });
  }
}

test("trailing worktree markers survive title truncation before the new badge", () => {
  let sawDroppedNew = false;
  for (const width of [30, 44, 80, 120, 160]) {
    for (const view of [{ fleetGrouping: "repo" as const }, { grouping: "stage" as const }]) {
      const row = session("long", { title: "Long title ".repeat(40), worktreePath: "/tmp/wt", worktreeBranch: "feature", unopened: true });
      const line = stripAnsi(titleLine(render([row], { width, ...view }), row.id));
      assert.match(line, /Long.*… ⎇/);
      sawDroppedNew ||= !line.includes(" new");
      assert.ok(visibleWidth(line) <= width);
    }
  }
  assert.ok(sawDroppedNew, "new badge yields before the worktree marker");
  const row = session("short", { title: "Short", worktreePath: "/tmp/wt", worktreeBranch: "feature", unopened: true });
  assert.match(stripAnsi(titleLine(render([row], { fleetGrouping: "repo" }), row.id)), /Short ⎇ new/);
});

test("attention shares the child state slot without hiding workspace runtime", () => {
  const parent = session("parent");
  const child = session("child", { kind: "subagent", parentId: parent.id, agentName: "critic", status: "waiting",
    context: { version: 1, updatedAt: NOW, attention: { kind: "question", text: "Choose", requestId: "request" } } });
  const layout = render([parent, child], { expandedProjectParentIds: new Set([parent.id]) });
  const line = stripAnsi(titleLine(layout, child.id));
  assert.match(line, /\?/);
  assert.doesNotMatch(line, /◐/);
  const model = buildRenderModel({ sessions: [child], selectedId: child.id, width: 80, now: NOW,
    workspaceCommands: selectWorkspaceCommands(child, buildDashboardCommands({ sessions: [child], selectedId: child.id }), 3), workspaceFullScreen: true });
  assert.equal(model.workspace?.session.displayStatus, "waiting");
  assert.equal(model.workspace?.session.attention?.kind, "question");
});

test("title is bold primary text and group and repo names are muted without bold", () => {
  const row = session("weight");
  const layout = render([row], { width: 160 });
  assert.ok(titleLine(layout, row.id).includes(`\u001b[1m${styleToken(darkTheme, "text", row.title)}\u001b[22m`));
  for (const label of ["team", "repo"]) {
    const line = layout.lines.find(line => stripAnsi(line).includes(label))!;
    const styledLabel = label === "team" ? `[${label}]` : label;
    const muted = styleToken(darkTheme, "muted", styledLabel);
    assert.ok(line.includes(muted), label);
    assert.ok(!line.includes(`\u001b[1m${muted}`), label);
  }
});

test("only the selected running or starting row changes spinner frames", () => {
  const rows = [session("running", { status: "running" }), session("starting", { status: "starting" })];
  for (const selectedId of ["running", "starting"]) {
    const before = render(rows, { selectedId, now: NOW });
    const after = render(rows, { selectedId, now: NOW + 250 });
    assert.notEqual(stripAnsi(titleLine(before, selectedId)), stripAnsi(titleLine(after, selectedId)));
    const other = rows.find(row => row.id !== selectedId)!;
    assert.equal(stripAnsi(titleLine(before, other.id)), stripAnsi(titleLine(after, other.id)));
    assert.match(stripAnsi(titleLine(before, other.id)), /●/);
  }
  const header = render(rows, { selectedSection: "active" });
  for (const row of rows) assert.match(stripAnsi(titleLine(header, row.id)), /●/);
});
