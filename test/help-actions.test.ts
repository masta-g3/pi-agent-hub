import test from "node:test";
import assert from "node:assert/strict";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { SessionsController } from "../src/app/controller.js";
import type { RuntimeSession } from "../src/core/types.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { buildRenderModel } from "../src/tui/render-model.js";
import { renderSessions } from "../src/tui/layout.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";

const selected: RuntimeSession = {
  id: "one", title: "Session", cwd: "/tmp", group: "team", tmuxSession: "tmux-one", status: "stopped",
  createdAt: 1, updatedAt: 1,
};

for (const width of [30, 80, 120, 160]) {
  test(`${width}-column Help is a static grouped reference even without a selection`, () => {
    const help = (sessions: RuntimeSession[]) => {
      const view = new SessionsView(new SessionsController({ version: 1, sessions }), () => {}, {
        terminalRows: () => 300, dashboardShortcuts: [{ key: "C-o", label: "Summarize", send: "/summary" }],
      }, darkTheme);
      view.handleInput("?");
      return view.render(width);
    };
    const lines = help([]);
    const text = stripAnsi(lines.join("\n"));
    assert.equal(text, stripAnsi(help([selected]).join("\n")));
    for (const section of ["Session actions", "Pins", "Views", "Filters"]) assert.ok(text.includes(section));
    assert.match(text, /Open(?: · [^\n│]*?)?\s+Enter/);
    assert.match(text, /Pin next free slot(?: · [^\n│]*?)?\s+P/);
    assert.match(text, /Focus slot 4(?: · [^\n│]*?)?\s+Alt\+4/);
    assert.match(text, /Summarize\s+(?:· send \/summary\s+)?Ctrl\+O/);
    assert.equal(text.match(/via : palette/g)?.length, 1);
    assert.doesNotMatch(text, /unavailable:|Open in Pi|C-m|C-j|Alt\+N|Ctrl\+…|Alt\+…/);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, line);
    const filterRow = lines.map(stripAnsi).find(line => line.includes("Lifecycle: Active"))!;
    assert.doesNotMatch(filterRow, /Active\s+:/);
  });
}

for (const width of [30, 40, 60]) {
  test(`${width}-column Help preserves fitted catalog spacing and accent keys`, () => {
    const view = new SessionsView(new SessionsController(), () => {}, { terminalRows: () => 300 }, darkTheme);
    view.handleInput("?");
    const row = view.render(width).find(line => stripAnsi(line).startsWith("│  Open "))!;
    assert.match(stripAnsi(row), /^│  Open\s+Enter│$/);
    assert.ok(row.includes(styleToken(darkTheme, "accent", "Enter")));
  });
}

test("wide Help uses two columns only when they shorten the reference", () => {
  const view = new SessionsView(new SessionsController(), () => {}, { terminalRows: () => 300 });
  view.handleInput("?");
  const narrow = view.render(80);
  const wide = view.render(160);
  assert.ok(wide.length < narrow.length);
  assert.ok(wide.some(line => /Session actions.*Pins/.test(stripAnsi(line))));
  assert.ok(!narrow.some(line => /Session actions.*Pins/.test(stripAnsi(line))));
});

for (const width of [80, 160]) {
  test(`${width}-column Help scroll reaches its last reference row and returns to the start`, () => {
    const view = new SessionsView(new SessionsController(), () => {}, { terminalRows: () => 12 });
    view.handleInput("?");
    const first = view.render(width).map(stripAnsi);
    assert.match(first.join("\n"), /Session actions/);
    for (let page = 0; page < 50; page += 1) view.handleInput("\u001b[6~");
    const last = view.render(width).map(stripAnsi);
    assert.equal(last.length, 12);
    assert.match(last.at(-3)!, /with pins, Enter Open directly and i Toggle details/);
    assert.match(last.at(-2)!, /PgUp\/PgDn Scroll · Esc Back/);
    for (let page = 0; page < 50; page += 1) view.handleInput("\u001b[5~");
    assert.deepEqual(view.render(width).map(stripAnsi), first);
  });
}

for (const width of [40, 100, 120, 160]) {
  for (const pinned of [false, true]) {
    test(`${width}-column ${pinned ? "pinned strip" : "workspace"} uses label-first, right-aligned action rows`, () => {
      const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: { restart: true } });
      const model = buildRenderModel({ sessions: [selected], selectedId: selected.id, width,
        workspaceCommands: selectWorkspaceCommands(selected, commands, 3), workspaceFullScreen: !pinned && width < 120,
        ...(pinned ? { pinSlots: [selected.id], pinCapacity: 2, height: 30 } : {}),
      });
      const layout = renderSessions(model, darkTheme);
      const primary = layout.workspaceRowTargets.indexOf("action:one:open");
      assert.ok(primary >= 0);
      const start = layout.workspaceStartX! - 1;
      const actionWidth = pinned || width < 120 ? width - (width > 60 ? 2 : 0) : width >= 160 ? 44 : 34;
      const row = sliceByColumn(layout.lines[primary]!, start, actionWidth);
      assert.match(stripAnsi(row), /^▌ Restart\s+Enter$/);
      assert.ok(row.includes(`\u001b[1m${styleToken(darkTheme, "text", "Restart")}\u001b[22m`));
      assert.ok(layout.lines[primary]!.includes(styleToken(darkTheme, "accent", "Enter")));
      assert.equal(visibleWidth(row), actionWidth);
      if (!pinned) {
        const more = layout.workspaceRowTargets.indexOf("view:palette");
        assert.ok(more >= 0);
        const moreRow = sliceByColumn(layout.lines[more]!, start, actionWidth);
        assert.match(stripAnsi(moreRow), /^  All actions\s+:$/);
      }
    });
  }
}
