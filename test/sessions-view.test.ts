import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SessionsController } from "../src/app/controller.js";
import { computeStatus } from "../src/core/status.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";
import type { SessionsViewState } from "../src/tui/dialog.js";

function fleetText(lines: string[]): string {
  const board = stripAnsi(lines[1] ?? "").startsWith("│WORKFLOW");
  const start = board ? 1 : 19;
  const width = board ? 83 : 65;
  return lines.map((line) => visibleSlice(stripAnsi(line), start, width)).join("\n");
}

function visibleSlice(value: string, start: number, width: number): string {
  let column = 0;
  let result = "";
  for (const char of value) {
    const charWidth = visibleWidth(char);
    if (column + charWidth <= start) {
      column += charWidth;
      continue;
    }
    if (column >= start + width || column + charWidth > start + width) break;
    result += char;
    column += charWidth;
  }
  return result;
}

function session(id: string, title: string): ManagedSession {
  return {
    id,
    title,
    cwd: `/tmp/${title}`,
    group: "default",
    tmuxSession: `pi-agent-hub-${id}`,
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("persisted new-user state reaches the live empty SessionsView", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [] }), () => {}, {
    initialViewState: { grouping: "project", cockpitOnboarding: { cohort: "new", phase: "learning" } },
    terminalRows: () => 28,
  });
  assert.deepEqual((view as unknown as { cockpitOnboarding?: unknown }).cockpitOnboarding, { cohort: "new", phase: "learning" });
  assert.equal((view as unknown as { dialog?: unknown }).dialog, undefined);
  assert.equal((view as unknown as { grouping?: unknown }).grouping, "project");
  const text = stripAnsi(view.render(100).join("\n"));
  assert.match(text, /an agent's explicit request lands here/);
  assert.match(text, /Ctrl\+Q Return/);
  assert.doesNotMatch(text, /No managed Pi sessions yet/);
});

test("narrow workspace keeps evidence behind i and Enter uses a deliberate second step", async () => {
  const base = session("api", "Project API");
  const now = 100_000;
  const explained = {
    ...base,
    status: "waiting" as const,
    statusEvidence: computeStatus({
      session: { ...base, status: "waiting" },
      tmux: { exists: true },
      heartbeat: { managedSessionId: base.id, cwd: base.cwd, state: "waiting", stateSince: now - 3_000, updatedAt: now - 7_000 },
      now,
    }).evidence,
    context: { version: 1 as const, updatedAt: now, attention: { kind: "question" as const, text: "Choose rollout order" } },
  };
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [explained] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    attachOutsideTmux: (tmuxSession) => { opened.push(tmuxSession); },
    switchInsideTmux: (tmuxSession) => { opened.push(tmuxSession); },
    acknowledgeSession: async () => {},
    sendMessage: () => {},
  });

  view.render(60);
  view.handleInput("i");
  let workspace = stripAnsi(view.render(60).join("\n"));
  assert.match(workspace, /Project API\s+◐ waiting/);
  assert.match(workspace, /LIVE DETAILS/);
  assert.match(workspace, /\? “Choose rollout order”/);
  view.handleInput("i");
  workspace = stripAnsi(view.render(60).join("\n"));
  assert.match(workspace, /Project API\s+◐ waiting/);
  assert.doesNotMatch(workspace, /LIVE DETAILS/);
  view.handleInput("\u001b");
  assert.match(stripAnsi(view.render(60).join("\n")), /── NEEDS YOU/);

  view.handleInput("\r");
  assert.deepEqual(opened, []);
  assert.match(stripAnsi(view.render(60).join("\n")), /Project API\s+◐ waiting/);
  view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(opened, ["pi-agent-hub-api"]);
});

test("info waits for matching evidence from a refresh", async () => {
  const base = session("api", "api");
  const now = 100_000;
  let current = base as typeof base & { statusEvidence?: ReturnType<typeof computeStatus>["evidence"] };
  let registry = { version: 1 as const, sessions: [current] };
  let resolve!: () => void;
  const refresh = new Promise<void>((done) => { resolve = done; });
  const controller = {
    snapshot: () => ({ registry, sessions: [current], selectedId: current.id, filter: undefined }),
    selected: () => current,
  } as unknown as SessionsController;
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    refreshStatusEvidence: async () => {
      await refresh;
      current = {
        ...base,
        statusEvidence: computeStatus({ session: base, tmux: { exists: true }, now }).evidence,
      };
      registry = { version: 1, sessions: [current] };
    },
  });

  view.render(60);
  view.handleInput("i");
  assert.match(stripAnsi(view.render(60).join("\n")), /refreshing status evidence/);
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /LIVE DETAILS/);
  resolve();
  await refresh;
  await new Promise((done) => setImmediate(done));
  assert.match(stripAnsi(view.render(60).join("\n")), /LIVE DETAILS/);
});

test("info stays closed when refresh produces no matching evidence", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { refreshStatusEvidence: async () => {} });

  view.render(60);
  view.handleInput("i");
  await new Promise((done) => setImmediate(done));

  const rendered = stripAnsi(view.render(60).join("\n"));
  assert.doesNotMatch(rendered, /LIVE DETAILS/);
  assert.match(rendered, /status evidence unavailable/);
});

test("narrow workspace closes when selection changes outside the gated screen", () => {
  const now = 100_000;
  const sessions = ["api", "docs"].map((id) => {
    const base = session(id, id);
    return { ...base, statusEvidence: computeStatus({ session: base, tmux: { exists: true }, now }).evidence };
  });
  const controller = new SessionsController({ version: 1, sessions });
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.render(60);
  view.handleInput("i");
  assert.match(stripAnsi(view.render(60).join("\n")), /LIVE DETAILS/);
  controller.selectSession("docs");
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /LIVE DETAILS/);
});

test("workspace evidence follows width changes and wide Escape still clears filtering", () => {
  const now = 100_000;
  const base = session("api", "api");
  const explained = { ...base, statusEvidence: computeStatus({ session: base, tmux: { exists: true }, now }).evidence };
  const controller = new SessionsController({ version: 1, sessions: [explained] });
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.render(100);
  view.handleInput("i");
  assert.match(stripAnsi(view.render(100).join("\n")), /LIVE DETAILS/);
  view.render(120);
  assert.match(stripAnsi(view.render(120).join("\n")), /LIVE DETAILS/);
  view.handleInput("i");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /LIVE DETAILS/);

  controller.setFilter("api");
  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("filter mode filters live and escape clears", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  assert.equal(controller.snapshot().filter, "do");
  assert.match(view.render(100).join("\n"), /docs/);
  assert.doesNotMatch(view.render(100).join("\n"), /api/);

  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("filter input supports cursor movement", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  let now = 100;
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.handleInput("/");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\u001b[D");
  view.handleInput("X");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /\u001b\[5m█\u001b\[25m/);
  assert.match(stripAnsi(rendered), /filter: apX█i/);
  now = 1_100;
  assert.match(view.render(100).join("\n"), /\u001b\[5m▌\u001b\[25m/);
  assert.equal(controller.snapshot().filter, "apXi");
});

test("committed filter moves to top summary and escape clears", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});
  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");
  view.handleInput("\r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /FLEET\s+1\/2 trees · filter: do/);
  assert.match(rendered, /\? Help/);
  assert.doesNotMatch(rendered, /enter done/);
  view.handleInput("\u001b");
  assert.equal(controller.snapshot().filter, undefined);
});

test("q stops the TUI", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("slash on empty state does not trap q in filter mode", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("/");
  view.handleInput("q");
  assert.equal(stopped, true);
});

test("help overlay opens and closes", () => {
  const view = new SessionsView(new SessionsController(), () => {});
  view.handleInput("?");
  const help = view.render(120).join("\n");
  assert.match(help, /pi agent hub help/);
  assert.match(help, /Status legend/);
  assert.doesNotMatch(help, /Alt\+Q/);
  assert.match(help, /Ctrl\+Q/);
  assert.match(help, /Alt\+R/);
  assert.match(help, /i toggle/);
  assert.match(help, /Actions · search actions, sessions, bounded context, and filters/);
  assert.match(help, /zero counts are hidden/);
  assert.match(help, /P pin\/focus selected/);
  assert.match(help, /x close selected pin/);
  assert.match(help, /Alt\+arrows move spatially/);
  assert.doesNotMatch(help, /1-4 assign|Focus panel/);
  assert.match(help, /double-click opens the workspace first unless pins are visible/);
  assert.doesNotMatch(help, /Density|compact and all-card/);
  assert.match(help, /Theme… · preview and select the dashboard theme/);
  assert.match(help, /Project view: Needs you · Health · Active · Quiet/);
  assert.match(help, /only explicit producer attention enters Needs you/);
  assert.match(help, /Archived is flat and chronological/);
  assert.match(help, /Board view lanes canonical workflow sessions by producer step, then OTHER ACTIVE/);
  assert.match(help, /subagent trees: ←\/→ collapse\/expand selected · Shift\+←\/→ all/);
  assert.match(help, /subagent trees start collapsed; Space toggles one board tree/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(80).join("\n"), /pi agent hub help/);
});

test("Help derives configured shortcuts from the command catalog", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    dashboardShortcuts: [{ key: "C-x", label: "Summarize", send: "/summary" }],
    runDashboardShortcut: () => {},
  });

  view.handleInput("?");

  const help = stripAnsi(view.render(120).join("\n"));
  assert.match(help, /C-x\s+Summarize · send \/summary/);
});

test("t opens theme settings from an empty dashboard and Escape restores preview", () => {
  const previews: string[] = [];
  const cancelled: string[] = [];
  const view = new SessionsView(new SessionsController(), () => {}, {
    themeSettings: () => ({ names: ["dark", "light"], setting: "dark", syncPi: true }),
    previewDashboardTheme: (setting) => { previews.push(setting); },
    cancelDashboardTheme: (setting) => { cancelled.push(setting); },
  });

  view.handleInput("t");
  assert.match(view.render(80).join("\n"), /Theme/);
  view.handleInput("\u001b[B");
  assert.deepEqual(previews, ["light"]);
  view.handleInput("\u001b");
  assert.deepEqual(cancelled, ["dark"]);
  assert.doesNotMatch(view.render(80).join("\n"), /Sync to Pi/);
});

test("theme settings stay bounded by short terminal height", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    terminalRows: () => 5,
    themeSettings: () => ({ names: ["dark", "light", "one", "two", "three"], setting: "dark", syncPi: true }),
  });
  view.handleInput("t");
  assert.ok(view.render(80).length <= 5);
});

test("t opens theme settings with a selected session and suppresses session shortcuts", () => {
  let sent = false;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    themeSettings: () => ({ names: ["dark", "light"], setting: "dark", syncPi: true }),
    sendMessage: () => { sent = true; },
  });

  view.handleInput("t");
  view.handleInput("p");
  assert.equal(sent, false);
  assert.match(view.render(80).join("\n"), /Sync to Pi/);
});

test("q quits from help overlay", () => {
  let stopped = false;
  const view = new SessionsView(new SessionsController(), () => { stopped = true; });
  view.handleInput("?");
  view.handleInput("q");
  assert.equal(stopped, true);
});


test("help overlay stays within terminal width", () => {
  const view = new SessionsView(new SessionsController(), () => {});
  view.handleInput("?");
  for (const width of [40, 80]) {
    for (const line of view.render(width)) assert.ok(stripAnsi(line).length <= width, stripAnsi(line));
  }
});

test("narrow dashboard renders width-safe notice", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {});

  for (const width of [10, 25, 38]) {
    const rendered = view.render(width);
    const text = stripAnsi(rendered.join("\n"));
    assert.match(text, /pane too/);
    if (width === 38) assert.match(text, /pane too narrow/);
    for (const line of rendered) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
});

test("narrow dashboard guards dialogs", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("?");
  for (const line of view.render(25)) assert.ok(visibleWidth(line) <= 25, line);
  assert.match(stripAnsi(view.render(25).join("\n")), /pane too/);

  view.handleInput("?");
  view.handleInput("n");
  for (const line of view.render(38)) assert.ok(visibleWidth(line) <= 38, line);
  assert.match(stripAnsi(view.render(38).join("\n")), /pane too narrow/);
});

test("narrow mouse press is ignored", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (sessionId) => { opened.push(sessionId); },
  });

  view.render(38);
  view.handleInput(mousePressAtLine(3));

  assert.equal(controller.snapshot().selectedId, "api");
  assert.deepEqual(opened, []);
});

test("width 40 keeps normal dashboard layout", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {});
  const rendered = stripAnsi(view.render(40).join("\n"));

  assert.match(rendered, /api/);
  assert.doesNotMatch(rendered, /pane too narrow/);
});

test("J K and shift arrows reorder selected session", () => {
  const deltas: number[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] }), () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("J");
  view.handleInput("K");
  view.handleInput("\u001b[b");
  view.handleInput("\u001b[a");

  assert.deepEqual(deltas, [1, -1, 1, -1]);
});

test("archived sessions explain that chronological order cannot be changed", () => {
  const archived = { ...session("api", "api"), bucket: "archived" as const, bucketChangedAt: 100 };
  const deltas: number[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [archived] }), () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("J");

  assert.deepEqual(deltas, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /Archived is sorted by archive time/);
});

test("archive backlog and restore shortcuts call lifecycle actions", () => {
  const events: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    archiveSession: (id) => { events.push(`archive:${id}`); },
    backlogSession: (id) => { events.push(`backlog:${id}`); },
    restoreSession: (id) => { events.push(`restore:${id}`); },
  });

  view.handleInput("A");
  view.handleInput("B");
  assert.deepEqual(events, ["archive:api", "backlog:api"]);

  controller.snapshot().registry.sessions[0]!.bucket = "backlog";
  view.handleInput("U");
  assert.deepEqual(events, ["archive:api", "backlog:api", "restore:api"]);
});

test("section shortcuts block subagent rows", () => {
  const controller = new SessionsController({ version: 1, sessions: [
    session("parent", "parent"),
    { ...session("child", "child"), kind: "subagent" as const, parentId: "parent", agentName: "scout" },
  ] });
  const view = new SessionsView(controller, () => {}, { archiveSession: () => { throw new Error("should not archive subagent directly"); } });

  controller.move(1);
  view.handleInput("A");

  assert.match(stripAnsi(view.render(100).join("\n")), /unavailable for subagents/);
});

test("direct mark-read obeys the shared command availability", () => {
  let acknowledged: string | undefined;
  const running = { ...session("api", "api"), status: "running" as const };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [running] }), () => {}, {
    acknowledgeSession: (id) => { acknowledged = id; },
  });

  view.handleInput("a");

  assert.equal(acknowledged, undefined);
  assert.match(stripAnsi(view.render(100).join("\n")), /session has no unread attention/);
});

test("N syncs selected session title from Pi name", async () => {
  const synced: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    syncPiName: (sessionId) => {
      synced.push(sessionId);
      return Promise.resolve({ status: "synced", name: "Pi Name" });
    },
  });

  view.handleInput("N");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(synced, ["api"]);
  assert.match(stripAnsi(view.render(100).join("\n")), /renamed from Pi name: Pi Name/);
});

test("Alt+N remains a sync compatibility alias", async () => {
  const synced: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    syncPiName: (sessionId) => {
      synced.push(sessionId);
      return Promise.resolve({ status: "synced", name: "Pi Name" });
    },
  });

  view.handleInput("\u001bn");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(synced, ["api"]);
});

test("N reports when the selected session has no Pi name", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    syncPiName: () => Promise.resolve({ status: "unnamed" }),
  });

  view.handleInput("N");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stripAnsi(view.render(100).join("\n")), /no Pi name set/);
});

test("reorder is disabled while filter is active", () => {
  const deltas: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("/");
  view.handleInput("a");
  view.handleInput("\r");
  view.handleInput("J");

  assert.deepEqual(deltas, []);
  assert.match(view.render(100).join("\n"), /clear filter to reorder/);
});

const VIEW_WORKFLOW = {
  steps: [
    { id: "plan-md", short: "PL", label: "Plan" },
    { id: "execute", short: "EX", label: "Execute" },
    { id: "review", short: "RV", label: "Review" },
    { id: "reflect", short: "RF", label: "Reflect" },
    { id: "commit", short: "CM", label: "Commit" },
  ],
  updatedAt: 1,
};

test("S toggles stage grouping and navigation follows producer lane order", () => {
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("a", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } },
    { ...session("b", "docs"), workflow: { ...VIEW_WORKFLOW, activeIndex: 0 } },
  ] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  assert.match(stripAnsi(view.render(120).join("\n")), /^│WORKFLOW\s+2 Active trees/m);
  assert.equal(controller.snapshot().selectedId, "a");

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "b", "j wraps to plan lane row");
  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "a", "lane order is plan then execute");
  view.handleInput("k");
  assert.equal(controller.snapshot().selectedId, "b");

  view.handleInput("S");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /^│WORKFLOW\s/m);
});

test("Space expands and collapses the selected board parent tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  assert.doesNotMatch(fleetText(view.render(120)), /worker/);
  assert.match(fleetText(view.render(120)), /api/);

  view.handleInput(" ");
  assert.match(fleetText(view.render(120)), /▾\s+○ api/);
  assert.match(fleetText(view.render(120)), /worker/);
  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");

  view.handleInput(" ");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(fleetText(view.render(120)), /worker/);
});

test("revealing a parent keeps its subagent tree collapsed while revealing a child expands it", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };

  for (const grouping of ["project", "stage"] as const) {
    const controller = new SessionsController({ version: 1, sessions: [parent, child] });
    const view = new SessionsView(controller, () => {});
    if (grouping === "stage") view.handleInput("S");

    view.revealSession("parent");
    assert.doesNotMatch(fleetText(view.render(120)), /worker/, `${grouping} parent reveal expanded descendants`);

    view.revealSession("child");
    assert.match(fleetText(view.render(120)), /worker/, `${grouping} child reveal stayed hidden`);
  }
});

test("hidden child request badges clear when the tree becomes visible", () => {
  const parent = session("parent", "api");
  const child = {
    ...session("child", "worker"),
    kind: "subagent" as const,
    parentId: "parent",
    agentName: "worker",
    context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } },
  };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [parent, child] }), () => {});

  assert.match(fleetText(view.render(120)), /\?1 child[\s\S]*api.*\?1/);
  view.handleInput("\u001b[C");
  assert.doesNotMatch(fleetText(view.render(120)), /\?1 child|api.*\?1/);
  assert.match(fleetText(view.render(120)), /worker/);

  view.handleInput("\u001b[D");
  view.revealSession("child");
  assert.doesNotMatch(fleetText(view.render(120)), /\?1 child|api.*\?1/);
  assert.match(fleetText(view.render(120)), /worker/);
});

test("left and right arrows expand and collapse the selected project tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  assert.doesNotMatch(fleetText(view.render(120)), /worker/);
  view.handleInput("\u001b[C");
  assert.match(fleetText(view.render(120)), /api[\s\S]*worker/);

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");
  view.handleInput("\u001b[D");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(fleetText(view.render(120)), /worker/);
});

test("left and right arrows collapse and expand the selected board tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  view.handleInput("\u001b[C");
  assert.match(fleetText(view.render(120)), /▾\s+○ api[\s\S]*worker/);

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");
  view.handleInput("\u001b[D");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(fleetText(view.render(120)), /worker/);
});

test("shift arrows expand and collapse all project trees", () => {
  const sessions = [
    session("a", "api"),
    { ...session("a-child", "api"), kind: "subagent" as const, parentId: "a", agentName: "api-worker" },
    session("b", "docs"),
    { ...session("b-child", "docs"), kind: "subagent" as const, parentId: "b", agentName: "docs-worker" },
  ];
  const view = new SessionsView(new SessionsController({ version: 1, sessions }), () => {});

  assert.doesNotMatch(fleetText(view.render(120)), /api-worker|docs-worker/);
  view.handleInput("\u001b[1;2C");
  assert.match(fleetText(view.render(120)), /api-worker/);
  assert.match(fleetText(view.render(120)), /docs-worker/);

  view.handleInput("\u001b[1;2D");
  assert.doesNotMatch(fleetText(view.render(120)), /api-worker|docs-worker/);
});

test("shift arrows expand and collapse all board trees", () => {
  const sessions = [
    { ...session("a", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } },
    { ...session("a-child", "api"), kind: "subagent" as const, parentId: "a", agentName: "api-worker" },
    { ...session("b", "docs"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } },
    { ...session("b-child", "docs"), kind: "subagent" as const, parentId: "b", agentName: "docs-worker" },
  ];
  const controller = new SessionsController({ version: 1, sessions });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  view.handleInput("\u001b[1;2C");
  assert.match(fleetText(view.render(120)), /api-worker/);
  assert.match(fleetText(view.render(120)), /docs-worker/);

  controller.selectSession("b-child");
  view.render(120);
  view.handleInput("\u001b[1;2D");
  assert.equal(controller.snapshot().selectedId, "b");
  assert.doesNotMatch(fleetText(view.render(120)), /api-worker|docs-worker/);
});

test("Space remains configurable outside board mode but is reserved for board disclosure", () => {
  let calls = 0;
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [parent, child] }), () => {}, {
    dashboardShortcuts: [{ key: " ", send: "ping" }],
    runDashboardShortcut: () => { calls += 1; },
  });

  view.handleInput(" ");
  assert.equal(calls, 1);
  view.handleInput("S");
  view.handleInput(" ");
  assert.equal(calls, 1);
  assert.match(fleetText(view.render(120)), /api[\s\S]*worker/);
});

test("board filters reveal collapsed child matches without persisting expansion", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker-special" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  view.handleInput("/");
  for (const char of "worker-special") view.handleInput(char);
  view.handleInput("\r");
  assert.match(fleetText(view.render(120)), /api[\s\S]*worker-special/);
  view.handleInput(" ");

  view.handleInput("\u001b");
  assert.match(fleetText(view.render(120)), /api/);
  assert.doesNotMatch(fleetText(view.render(120)), /worker-special/);
});

test("an empty board filter draft keeps collapsed navigation and rendering aligned", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [parent, child] }), () => {});

  view.handleInput("S");
  view.handleInput("/");

  const text = fleetText(view.render(120));
  assert.match(text, /api/);
  assert.doesNotMatch(text, /worker/);
});

test("reorder is disabled in stage grouping", () => {
  const deltas: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("api", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } },
    { ...session("docs", "docs"), workflow: { ...VIEW_WORKFLOW, activeIndex: 2 } },
  ] });
  const view = new SessionsView(controller, () => {}, {
    reorderSelected: (delta) => { deltas.push(delta); },
  });

  view.handleInput("S");
  view.handleInput("J");

  assert.deepEqual(deltas, []);
  assert.match(view.render(120).join("\n"), /switch to project grouping to reorder/);
});

test("v has no built-in view behavior or persisted state", () => {
  const saved: SessionsViewState[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    saveViewState: (state) => { saved.push(state); },
  });

  view.handleInput("v");

  assert.deepEqual(saved, []);
});

test("view state saves preserve onboarding and release cue fields", () => {
  const saved: SessionsViewState[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    initialViewState: {
      grouping: "project",
      collapsedSections: ["archived"],
      cockpitOnboarding: { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "req/1" },
      dismissedReleaseCueId: "older-cue",
    },
    saveViewState: (state) => { saved.push(state); },
  });

  view.handleInput("S");

  assert.deepEqual(saved.at(-1), {
    grouping: "stage",
    collapsedSections: ["archived"],
    cockpitOnboarding: { cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "req/1" },
    dismissedReleaseCueId: "older-cue",
  });
});

test("existing-user release cue is target-safe and dismisses without changing session selection", () => {
  const saved: SessionsViewState[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), { ...session("work", "work"), status: "running" }] });
  const view = new SessionsView(controller, () => {}, {
    initialViewState: { grouping: "project" },
    saveViewState: (state) => { saved.push(state); },
  });

  assert.match(stripAnsi(view.render(100).join("\n")), /NEW DAILY LOOP/);
  const selectedId = controller.snapshot().selectedId;
  view.handleInput("k");
  assert.equal(controller.snapshot().selectedId, selectedId);
  assert.match(stripAnsi(view.render(100).join("\n")), /▌ NEW DAILY LOOP/);
  view.handleInput("\r");

  assert.equal(controller.snapshot().selectedId, selectedId);
  assert.equal(saved.at(-1)?.dismissedReleaseCueId, "cockpit-daily-loop-v1");
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /NEW DAILY LOOP/);
});

test("release cue double-click dismisses the exact synthetic row", () => {
  let now = 100;
  const saved: SessionsViewState[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    initialViewState: { grouping: "project" },
    saveViewState: (state) => { saved.push(state); },
    now: () => now,
  });
  let rendered = view.render(100);
  const cueRow = rendered.findIndex((line) => stripAnsi(line).includes("NEW DAILY LOOP"));
  assert.notEqual(cueRow, -1);
  view.handleInput(mousePressAtLine(cueRow));
  now += 50;
  rendered = view.render(100);
  view.handleInput(mousePressAtLine(rendered.findIndex((line) => stripAnsi(line).includes("NEW DAILY LOOP"))));
  assert.equal(saved.at(-1)?.dismissedReleaseCueId, "cockpit-daily-loop-v1");
});

test("v inside filter mode edits the filter instead of toggling views", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  view.handleInput("v");

  assert.equal(controller.snapshot().filter, "v");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /^│WORKFLOW\s/m);
});

test("stage grouping snaps selection to the first eligible Active row", () => {
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("bk", "backlogged"), bucket: "backlog", bucketChangedAt: 1 },
    { ...session("a", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } },
  ] });
  const view = new SessionsView(controller, () => {});
  controller.selectSession("bk");

  view.handleInput("S");
  assert.equal(controller.snapshot().selectedId, "a");
});

test("board empty state blocks pin actions on hidden non-Active selections", () => {
  const pinned: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("plain", "plain"), bucket: "backlog", bucketChangedAt: 1 }] });
  const view = new SessionsView(controller, () => {}, {
    pinSidePane: (sessionId) => { pinned.push(sessionId); return { kind: "pinned", session: `pi-agent-hub-${sessionId}`, slot: 1 }; },
    sidePaneState: () => ({ slots: [undefined, undefined, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("S");
  view.handleInput("P");
  assert.deepEqual(pinned, []);
  assert.match(stripAnsi(view.render(80).join("\n")), /No Active sessions/);
  view.handleInput("S");
  view.handleInput("P");
  assert.deepEqual(pinned, ["plain"]);
});

test("named pin presence updates rendering without registry mutation", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  let state = { slots: [undefined, undefined, undefined, undefined] as (string | undefined)[], capacity: 2, constrained: false, splitPercent: 50, activeSessionId: undefined as string | undefined };
  const view = new SessionsView(controller, () => {}, { sidePaneState: () => state });
  const before = controller.snapshot().registry;
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /[▢▣]/);
  state = { ...state, slots: ["docs", "api", undefined, undefined], activeSessionId: "api" };
  const rendered = stripAnsi(view.render(100).join("\n"));
  assert.match(rendered, /PINNED · ▢1 docs · ▣2 api/);
  assert.match(rendered, /○ ▣2 api/);
  assert.match(rendered, /○ ▢1 docs/);
  assert.strictEqual(controller.snapshot().registry, before);
});

test("number keys assign exact slots and Alt+number focuses occupied slots", () => {
  const events: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  controller.selectSession("docs");
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (id, slot) => { events.push(`assign:${id}:${slot}`); return { kind: "pinned", session: `pi-agent-hub-${id}`, slot }; },
    focusSidePaneSlot: (slot) => { events.push(`focus:${slot}`); return { kind: "focused" }; },
    sidePaneState: () => ({ slots: ["api", undefined, undefined, undefined], capacity: 4, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("4");
  view.handleInput("\u001b1");
  assert.deepEqual(events, ["assign:docs:4", "focus:1"]);
});

test("occupied slot refusal names its occupant and does not retarget", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "API"), session("docs", "Docs")] });
  controller.selectSession("docs");
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: () => ({ kind: "occupied", slot: 1, session: "pi-agent-hub-api" }),
    sidePaneState: () => ({ slots: ["api", undefined, undefined, undefined], capacity: 4, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("1");
  assert.match(stripAnsi(view.render(100).join("\n")), /Slot 1 contains API; close it first/);
});

test("P pins or focuses exact selected identity and x closes only that selected pin", () => {
  const events: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  let pinned = ["api"];
  const view = new SessionsView(controller, () => {}, {
    pinSidePane: (id) => { events.push(`pin:${id}`); return { kind: pinned.includes(id) ? "focused" : "pinned", session: `pi-agent-hub-${id}`, slot: 1 }; },
    closeSidePane: (id) => { events.push(`close:${id}`); return { kind: "closed" }; },
    sidePaneState: () => ({ slots: [...pinned, undefined, undefined], activeSessionId: "api", capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("P");
  view.handleInput("x");
  controller.move(1);
  view.handleInput("x");
  pinned = ["api", "docs"];
  view.handleInput("x");
  assert.deepEqual(events, ["pin:api", "close:api", "close:docs"]);
});

test("slot badges and summary preserve holes and focused identity", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "API"), session("docs", "Docs")] });
  const view = new SessionsView(controller, () => {}, {
    sidePaneState: () => ({ slots: ["api", undefined, "docs", undefined], activeSessionId: "docs", capacity: 4, constrained: false, splitPercent: 50 }),
  });
  const rendered = stripAnsi(view.render(100).join("\n"));
  assert.match(rendered, /PINNED · ▢1 API · 2 empty · ▣3 Docs · 4 empty/);
  assert.match(rendered, /▢1 API/);
  assert.match(rendered, /▣3 Docs/);
});

test("canonical Alt+Arrow intents move spatially and Ctrl+Q returns", () => {
  const events: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    focusSidePaneDirection: (direction) => { events.push(direction); return { kind: "focused" }; },
    returnToCockpit: () => { events.push("return"); return { kind: "focused" }; },
  });
  for (const sequence of ["\u001b[1;3D", "\u001b[1;3C", "\u001b[1;3A", "\u001b[1;3B", "\u001bq", "\u0011"]) view.handleInput(sequence);
  assert.deepEqual(events, ["left", "right", "up", "down", "return"]);
});

test("pin mode Enter opens directly below 120 instead of opening the full workspace", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { opened.push(tmuxSession); },
    sidePaneState: () => ({ slots: ["api", undefined, undefined, undefined], activeSessionId: "api", capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.render(60);
  view.handleInput("\r");
  assert.deepEqual(opened, ["pi-agent-hub-api"]);
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /SELECTED SESSION/);
});

test("pinning from the narrow workspace returns input to fleet navigation", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  let pinned: string[] = [];
  const view = new SessionsView(controller, () => {}, {
    pinSidePane: (id) => { pinned = [id]; return { kind: "pinned", session: `pi-agent-hub-${id}`, slot: 1 }; },
    sidePaneState: () => ({ slots: [...pinned, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.render(60);
  view.handleInput("\r");
  view.handleInput("P");
  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "docs");
});

test("plus and minus resize through the catalog only when two pins are available", () => {
  const deltas: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    resizeSidePane: (delta) => { deltas.push(delta); return { kind: "resized", splitPercent: delta > 0 ? 60 : 50 }; },
    sidePaneState: () => ({ slots: ["api", "docs", undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("+");
  view.handleInput("-");
  assert.deepEqual(deltas, [1, -1]);
});

test("F and 1 are reserved while o remains available for configured sends", () => {
  const sent: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    dashboardShortcuts: ["1", "F", "o"].map((key) => ({ key, send: `send-${key}` })),
    runDashboardShortcut: (_id, shortcut) => { sent.push(shortcut.send); },
  });
  for (const key of ["1", "F", "o"]) view.handleInput(key);
  assert.deepEqual(sent, ["send-o"]);
});

test("pin commands block stopped and error sessions but allow live subagents", () => {
  const pinned: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("stopped", "stopped"), status: "stopped" },
    { ...session("error", "error"), status: "error" },
    session("parent", "parent"),
    { ...session("child", "child"), kind: "subagent" as const, parentId: "parent", agentName: "scout" },
  ] });
  const view = new SessionsView(controller, () => {}, {
    pinSidePane: (id) => { pinned.push(id); return { kind: "pinned", session: `pi-agent-hub-${id}`, slot: 1 }; },
    sidePaneState: () => ({ slots: [undefined, undefined, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.revealSession("stopped");
  view.handleInput("P");
  view.revealSession("error");
  view.handleInput("P");
  view.revealSession("child");
  view.handleInput("P");
  assert.deepEqual(pinned, ["child"]);
});

test("pin commands surface capacity and tmux transport failures", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  let fail = false;
  const view = new SessionsView(controller, () => {}, {
    pinSidePane: async () => {
      if (fail) throw new Error("side pane needs tmux — run pi-hub");
      return { kind: "capacity", capacity: 0, pins: 0 };
    },
    sidePaneState: () => ({ slots: [undefined, undefined, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
  });
  view.handleInput("P");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(stripAnsi(view.render(100).join("\n")), /pinning needs 100 columns/);
  fail = true;
  view.handleInput("P");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(stripAnsi(view.render(100).join("\n")), /side pane needs tmux/);
});

function mousePressAtLine(lineIndex: number, x = 22): string {
  return `\u001b[<0;${x};${lineIndex + 1}M`;
}

function mouseReleaseAtLine(lineIndex: number, x = 22): string {
  return `\u001b[<0;${x};${lineIndex + 1}m`;
}

function rowIndexFor(rendered: string[], title: string): number {
  const index = rendered.findIndex((line) => {
    const text = stripAnsi(line);
    return text.includes(title) && /[▸▾·├└│].*[●◐○×-]/.test(text);
  });
  assert.notEqual(index, -1, `missing rendered row for ${title}`);
  return index;
}

test("tier navigator mouse click selects the exact first presentation owner", () => {
  const needs = { ...session("needs", "needs"), status: "waiting" as const, context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } } };
  const active = { ...session("active", "active"), status: "running" as const };
  const archived = { ...session("archived", "archived"), status: "stopped" as const, bucket: "archived" as const, bucketChangedAt: 1 };
  const controller = new SessionsController({ version: 1, sessions: [needs, active, archived] });
  const saved: SessionsViewState[] = [];
  const view = new SessionsView(controller, () => {}, {
    initialViewState: { grouping: "project", collapsedSections: ["archived"] },
    saveViewState: (state) => { saved.push(state); },
  });

  let rendered = view.render(100);
  const activeNav = rendered.findIndex((line) => /^│ACTIVE\s+1/.test(stripAnsi(line)));
  assert.notEqual(activeNav, -1);
  view.handleInput(mousePressAtLine(activeNav, 3));
  assert.equal(controller.selected()?.id, "active");

  rendered = view.render(100);
  const archiveNav = rendered.findIndex((line) => /^│ARCHIVED\s+1/.test(stripAnsi(line)));
  assert.notEqual(archiveNav, -1);
  view.handleInput(mousePressAtLine(archiveNav, 3));
  assert.equal(controller.selected()?.id, "archived");
  assert.deepEqual(saved.at(-1), { grouping: "project" });
});

test("tier navigator and fleet hit maps do not overlap at the column boundary", () => {
  const needs = { ...session("needs", "needs"), status: "waiting" as const, context: { version: 1 as const, updatedAt: 2, attention: { kind: "question" as const, text: "Choose" } } };
  const active = { ...session("active", "active"), status: "running" as const };
  const controller = new SessionsController({ version: 1, sessions: [needs, active] });
  const view = new SessionsView(controller, () => {});
  const rendered = view.render(100);
  const activeRow = rowIndexFor(rendered, "active");

  view.handleInput(mousePressAtLine(activeRow, 18));
  assert.equal(controller.selected()?.id, "needs");
  view.handleInput(mousePressAtLine(activeRow, 19));
  assert.equal(controller.selected()?.id, "active");
});

test("workspace actions ignore the terminal outer border", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(120);
  const openRow = rendered.findIndex((line) => stripAnsi(line).includes("Enter Open"));
  assert.notEqual(openRow, -1);

  view.handleInput(mousePressAtLine(openRow, 120));

  assert.deepEqual(switched, []);
});

test("tier navigator reaches an orphan subagent presentation owner", () => {
  const quiet = session("quiet", "quiet");
  const orphan = { ...session("orphan", "orphan"), status: "running" as const, kind: "subagent" as const, parentId: "missing", agentName: "scout", taskPreview: "Inspect orphan" };
  const controller = new SessionsController({ version: 1, sessions: [quiet, orphan] });
  const view = new SessionsView(controller, () => {});
  const rendered = view.render(100);
  const activeNav = rendered.findIndex((line) => /^│ACTIVE\s+1/.test(stripAnsi(line)));
  assert.notEqual(activeNav, -1);

  view.handleInput(mousePressAtLine(activeNav, 3));

  assert.equal(controller.selected()?.id, "orphan");
});

test("single mouse click selects without opening", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);

  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "docs")));

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, []);
});

test("card continuation rows select and double-click open their narrow workspace", () => {
  const switched: string[] = [];
  let now = 100;
  const rich = (id: string, title: string) => ({
    ...session(id, title),
    workflow: { ...VIEW_WORKFLOW, activeIndex: 1, ticketId: `${id}-001`, activity: { id: "working", label: "Working" } },
    context: { version: 1 as const, updatedAt: 1, ticket: { id: `${id}-001`, subtitle: `${title} subtitle` } },
  });
  const controller = new SessionsController({ version: 1, sessions: [rich("api", "api"), rich("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    attachOutsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  view.handleInput("v");
  const rendered = view.render(100);
  const continuationIndex = rendered.findIndex((line) => stripAnsi(line).includes("#docs-001"));
  assert.notEqual(continuationIndex, -1);

  view.handleInput(mousePressAtLine(continuationIndex));
  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, []);

  now = 300;
  view.handleInput(mousePressAtLine(continuationIndex));
  assert.deepEqual(switched, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /docs\s+○ idle/);
  view.handleInput("\r");
  assert.deepEqual(switched, ["pi-agent-hub-docs"]);
});

test("double-click opens the narrow workspace before the live session", () => {
  const switched: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    attachOutsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);
  const docsClick = mousePressAtLine(rowIndexFor(rendered, "docs"));

  view.handleInput(docsClick);
  view.handleInput(mouseReleaseAtLine(rowIndexFor(rendered, "docs")));
  now = 300;
  view.handleInput(docsClick);

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /docs\s+○ idle/);
  view.handleInput("\r");
  assert.deepEqual(switched, ["pi-agent-hub-docs"]);
});

test("double-click opens the live session directly when the workspace is persistent", () => {
  const switched: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    attachOutsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(120);
  const docsClick = mousePressAtLine(rowIndexFor(rendered, "docs"));

  view.handleInput(docsClick);
  now = 300;
  view.handleInput(docsClick);

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, ["pi-agent-hub-docs"]);
});

test("persistent workspace double-click obeys the catalog availability guard", () => {
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { now: () => now });
  const rendered = view.render(120);
  const apiClick = mousePressAtLine(rowIndexFor(rendered, "api"));

  view.handleInput(apiClick);
  now = 300;
  view.handleInput(apiClick);

  const workspace = stripAnsi(view.render(120).join("\n"));
  assert.match(workspace, /▸ A\s+Archive/);
  assert.doesNotMatch(workspace, /▸ Enter\s+Open/);
});

test("navigation follows the shared projection across lifecycle sections and subagents", () => {
  const parent = session("active", "active");
  const child = { ...session("child", "child"), kind: "subagent" as const, parentId: "active", agentName: "child" };
  const backlog = { ...session("backlog", "backlog"), bucket: "backlog" as const };
  const archived = { ...session("archived", "archived"), bucket: "archived" as const };
  const controller = new SessionsController({ version: 1, sessions: [parent, child, backlog, archived] });
  const view = new SessionsView(controller, () => {});

  // The default project tree is collapsed, so navigation starts on the parent.
  view.render(100);
  assert.equal(controller.snapshot().selectedId, "active");
  view.handleInput("j"); // Backlog is a normal Quiet row.
  assert.equal(controller.snapshot().selectedId, "backlog");
  view.handleInput("j"); // Archived header is the only lifecycle target.
  assert.equal(controller.snapshot().selectedId, "backlog");
  view.handleInput("j"); // archived row
  assert.equal(controller.snapshot().selectedId, "archived");
  view.handleInput("k");
  assert.equal(controller.snapshot().selectedId, "archived");

  view.handleInput("S");
  view.render(100);
  assert.equal(controller.snapshot().selectedId, "active");
  assert.doesNotMatch(stripAnsi(view.render(100).join("\\n")), /child/);
  view.handleInput(" ");
  assert.match(stripAnsi(view.render(100).join("\\n")), /child/);
});

test("Archived is the only collapsible project section and persists its state", () => {
  const sessions = [
    session("active", "active"),
    { ...session("backlog", "backlog"), bucket: "backlog" as const },
    { ...session("archived", "archived"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const saved: SessionsViewState[] = [];
  const controller = new SessionsController({ version: 1, sessions });
  const view = new SessionsView(controller, () => {}, { saveViewState: (state) => saved.push(state) });

  view.handleInput("j"); // backlog row
  assert.equal(controller.snapshot().selectedId, "backlog");
  view.handleInput("j"); // Archived header
  assert.match(stripAnsi(view.render(80).join("\n")), /▌▾ ARCHIVED/);
  view.handleInput("\r");
  const collapsed = stripAnsi(view.render(80).join("\n"));
  assert.match(collapsed, /▸ ARCHIVED/);
  assert.doesNotMatch(collapsed, /\n.*○ archived/);
  assert.match(collapsed, /backlog/);
  assert.deepEqual(saved.at(-1), { grouping: "project", collapsedSections: ["archived"] });
});

test("Archived header selection blocks session actions and Enter collapses it", () => {
  const events: string[] = [];
  const sessions = [
    session("active", "active"),
    { ...session("archived", "archived"), bucket: "archived" as const, bucketChangedAt: 1 },
  ];
  const controller = new SessionsController({ version: 1, sessions });
  const view = new SessionsView(controller, () => {}, {
    attachOutsideTmux: () => { events.push("attach"); },
    archiveSession: () => { events.push("archive"); },
    reorderSelected: () => { events.push("reorder"); },
  });
  view.render(60);
  view.handleInput("j"); // Archived header
  view.handleInput("i");
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /why this status/);
  assert.match(stripAnsi(view.render(60).join("\n")), /select a session to show status evidence/);
  for (const key of ["A", "J", "\r"]) view.handleInput(key);
  assert.deepEqual(events, []);
  assert.match(stripAnsi(view.render(80).join("\n")), /▸ ARCHIVED/);
});

test("archive disclosure toggles with keyboard and blocks stale session actions", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const events: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: archived });
  const view = new SessionsView(controller, () => {}, {
    archiveSession: (id) => { events.push(`archive:${id}`); },
    reorderSelected: () => { events.push("reorder"); },
    pinSidePane: (id) => { events.push(`pin:${id}`); return { kind: "pinned", session: `pi-agent-hub-${id}`, slot: 1 }; },
    sidePaneState: () => ({ slots: [undefined, undefined, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
    restart: (id) => { events.push(`restart:${id}`); },
  });

  for (let index = 0; index < 5; index += 1) view.handleInput("j");
  assert.match(stripAnsi(view.render(80).join("\n")), /… 2 older archived/);

  for (const key of ["A", "J", "P", "r"]) view.handleInput(key);
  assert.deepEqual(events, []);

  view.handleInput("\r");
  assert.match(stripAnsi(view.render(80).join("\n")), /⌃ show fewer/);
  assert.match(stripAnsi(view.render(80).join("\n")), /archive-6/);

  view.handleInput("\r");
  assert.match(stripAnsi(view.render(80).join("\n")), /… 2 older archived/);
  assert.doesNotMatch(stripAnsi(view.render(80).join("\n")), /archive-6/);
});

test("every session-dependent route is inert while archive disclosure is selected", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const keys = ["x", "+", "-", "P", "N", "f", "g", "G", "s", "m", "w", "a", "A", "B", "U", "d", "r", "R", "p", "J"];

  for (const key of keys) {
    const events: string[] = [];
    const view = new SessionsView(new SessionsController({ version: 1, sessions: archived }), () => {}, {
      dashboardShortcuts: [{ key: "x", send: "status" }],
      runDashboardShortcut: () => { events.push("shortcut"); },
      syncPiName: () => { events.push("sync"); return { status: "unavailable" }; },
      skills: () => { events.push("skills"); return []; },
      mcpServers: () => { events.push("mcp"); return []; },
      acknowledge: () => { events.push("acknowledge"); },
      archiveSession: () => { events.push("archive"); },
      backlogSession: () => { events.push("backlog"); },
      restoreSession: () => { events.push("restore"); },
      pinSidePane: () => { events.push("pin"); return { kind: "pinned", session: "pi-agent-hub-archive", slot: 1 }; },
      closeSidePane: () => { events.push("close-pin"); return { kind: "closed" }; },
      resizeSidePane: () => { events.push("resize"); return { kind: "resized", splitPercent: 50 }; },
      sidePaneState: () => ({ slots: [undefined, undefined, undefined, undefined], capacity: 2, constrained: false, splitPercent: 50 }),
      reorderSelected: () => { events.push("reorder"); },
    });
    for (let index = 0; index < 5; index += 1) view.handleInput("j");

    view.handleInput(key);

    assert.deepEqual(events, [], `key ${key} reached a stale session action`);
    assert.match(stripAnsi(view.render(80).join("\n")), /older archived|show fewer/, `key ${key} left disclosure mode`);
  }
});

test("global new-session action remains available on archive disclosure", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const view = new SessionsView(new SessionsController({ version: 1, sessions: archived }), () => {});
  for (let index = 0; index < 5; index += 1) view.handleInput("j");

  view.handleInput("n");

  assert.match(stripAnsi(view.render(80).join("\n")), /New session/);
});

test("archive disclosure toggles on double-click without opening a session", () => {
  let now = 100;
  const switched: string[] = [];
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const view = new SessionsView(new SessionsController({ version: 1, sessions: archived }), () => {}, {
    now: () => now,
    switchInsideTmux: (id) => { switched.push(id); },
  });
  const rendered = view.render(80);
  const disclosureLine = rendered.findIndex((line) => stripAnsi(line).includes("older archived"));
  assert.notEqual(disclosureLine, -1);
  const click = mousePressAtLine(disclosureLine);

  view.handleInput(click);
  now = 200;
  view.handleInput(click);

  assert.match(stripAnsi(view.render(80).join("\n")), /⌃ show fewer/);
  assert.deepEqual(switched, []);
});

test("archive filter reveals hidden matches and clearing restores collapse", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const controller = new SessionsController({ version: 1, sessions: archived });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  for (const character of "archive-6") view.handleInput(character);
  view.handleInput("\r");
  assert.match(stripAnsi(view.render(80).join("\n")), /archive-6/);

  view.handleInput("\u001b");
  const restored = stripAnsi(view.render(80).join("\n"));
  assert.match(restored, /… 2 older archived/);
  assert.doesNotMatch(restored, /archive-6/);
  assert.notEqual(controller.snapshot().selectedId, "archive-6");
});

test("archive disclosure selection repairs when pruning removes the toggle", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const controller = new SessionsController({ version: 1, sessions: archived });
  const view = new SessionsView(controller, () => {});
  for (let index = 0; index < 5; index += 1) view.handleInput("j");

  controller.snapshot().registry.sessions.splice(5, 2);
  const rendered = stripAnsi(view.render(80).join("\n"));

  assert.doesNotMatch(rendered, /older archived|show fewer/);
  assert.ok(controller.snapshot().selectedId);
});

test("double-click opens the narrow workspace before restarting a stopped session", () => {
  const restarted: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), status: "stopped" }] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    restart: (sessionId) => { restarted.push(sessionId); },
  });
  const rendered = view.render(100);
  const click = mousePressAtLine(rowIndexFor(rendered, "api"));

  view.handleInput(click);
  assert.deepEqual(restarted, []);
  now = 300;
  view.handleInput(click);

  assert.deepEqual(restarted, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /api\s+- stopped/);
  assert.match(stripAnsi(view.render(100).join("\n")), /▸ Enter\s+Restart/);
  view.handleInput("\r");
  assert.deepEqual(restarted, ["api"]);
});

test("double-click expires and is cancelled by keyboard input", () => {
  const switched: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);
  const docsClick = mousePressAtLine(rowIndexFor(rendered, "docs"));

  view.handleInput(docsClick);
  now = 600;
  view.handleInput(docsClick);
  now = 700;
  view.handleInput("j");
  view.handleInput(docsClick);

  assert.deepEqual(switched, []);
});

test("clicking a different row starts a new double-click sequence", () => {
  const switched: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);

  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "api")));
  now = 200;
  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "docs")));

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, []);
});

test("non-row mouse input cancels a pending double-click", () => {
  const switched: string[] = [];
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    now: () => now,
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);
  const docsLine = rowIndexFor(rendered, "docs");
  const headerLine = rendered.findIndex((line) => stripAnsi(line).includes("QUIET"));
  assert.notEqual(headerLine, -1, "missing cockpit tier heading");

  view.handleInput(mousePressAtLine(docsLine));
  now += 50;
  view.handleInput(mousePressAtLine(headerLine));
  now += 50;
  view.handleInput(mousePressAtLine(docsLine));
  now += 50;
  view.handleInput("\u001b[<65;5;5M");
  now += 50;
  view.handleInput(mousePressAtLine(docsLine));
  now += 50;
  view.handleInput(mousePressAtLine(docsLine, 99));
  now += 50;
  view.handleInput(mousePressAtLine(docsLine));

  assert.deepEqual(switched, []);
});

test("mouse clicks ignore headings and execute exact workspace action rows", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(120);
  const before = controller.snapshot().selectedId;

  const headerIndex = rendered.findIndex((line) => stripAnsi(line).includes("QUIET"));
  const openIndex = rendered.findIndex((line) => /Enter\s+Open/.test(stripAnsi(line)));
  assert.notEqual(headerIndex, -1, "missing cockpit tier heading");
  assert.notEqual(openIndex, -1, "missing workspace Open action");
  view.handleInput(mousePressAtLine(headerIndex));
  assert.equal(controller.snapshot().selectedId, before);
  assert.deepEqual(switched, []);
  view.handleInput(mousePressAtLine(openIndex, 110));
  assert.deepEqual(switched, ["pi-agent-hub-api"]);
});

test("workspace More commands click opens the palette and stale action IDs stay inert", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(120);
  const openIndex = rendered.findIndex((line) => /Enter\s+Open/.test(stripAnsi(line)));
  const actionsIndex = rendered.findIndex((line) => /:\s+Actions/.test(stripAnsi(line)));
  assert.notEqual(openIndex, -1);
  assert.notEqual(actionsIndex, -1);

  controller.selectSession("docs");
  view.handleInput(mousePressAtLine(openIndex, 110));
  assert.deepEqual(switched, []);
  assert.match(stripAnsi(view.render(120).join("\n")), /command target changed and is no longer available/);

  const current = view.render(120);
  const currentActions = current.findIndex((line) => /:\s+Actions/.test(stripAnsi(line)));
  view.handleInput(mousePressAtLine(currentActions, 110));
  assert.match(stripAnsi(view.render(120).join("\n")), /ACTIONS/);
});

test("mouse wheel moves selection", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});
  view.render(100);

  view.handleInput("\u001b[<65;5;5M");
  assert.equal(controller.snapshot().selectedId, "docs");
  view.handleInput("\u001b[<64;5;5M");
  assert.equal(controller.snapshot().selectedId, "api");
});

test("mouse sequences are consumed while rename form is open", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, { renameSession: () => {} });
  view.render(100);
  view.handleInput("R");
  view.handleInput("\u001b[<0;3;4M");
  view.handleInput("\u001b[<0;3;4m");

  assert.equal(controller.snapshot().selectedId, "api");
  assert.match(stripAnsi(view.render(100).join("\n")), /Rename session/);
});

test("mouse press only dismisses restart choices and wheel is ignored", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (sessionId) => { opened.push(sessionId); },
    restart: () => {},
  });
  const rendered = view.render(100);

  view.handleInput("r");
  view.handleInput("\u001b[<65;5;5M");
  assert.equal(controller.snapshot().selectedId, "api");
  assert.match(stripAnsi(view.render(100).join("\n")), /target\s+api/);

  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "docs")));
  assert.equal(controller.snapshot().selectedId, "api");
  assert.deepEqual(opened, []);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /Restart api/);
});

function manyViewSessions(count: number): ManagedSession[] {
  return Array.from({ length: count }, (_, index) => session(`s${index}`, `session-${index}`));
}

test("short dashboard renders to terminal rows and clicks visible rows", () => {
  const controller = new SessionsController({ version: 1, sessions: manyViewSessions(20) });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 15 });
  const rendered = view.render(100);

  assert.equal(rendered.length, 15);
  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "session-7")));

  assert.equal(controller.snapshot().selectedId, "s7");
});

test("sidebar dashboard renders readable primary controls", () => {
  const controller = new SessionsController({ version: 1, sessions: manyViewSessions(3) });
  const view = new SessionsView(controller, () => {}, {
    terminalRows: () => 15,
    sidePaneState: () => ({ slots: ["s0", undefined, undefined, undefined], activeSessionId: "s0", capacity: 2, constrained: false, splitPercent: 50 }),
  });
  const rendered = view.render(42).map(stripAnsi);

  assert.match(rendered.at(-2) ?? "", /1–4 Slot · x Close/);
  assert.doesNotMatch(rendered.at(-2) ?? "", /…/);
});

test("mouse hit map follows scrolled list window", () => {
  const controller = new SessionsController({ version: 1, sessions: manyViewSessions(25) });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 15 });
  for (let i = 0; i < 15; i += 1) view.handleInput("j");
  const rendered = view.render(100);
  const visibleTarget = stripAnsi(rendered.find((line) => line.includes("session-12")) ?? "");
  assert.match(visibleTarget, /session-12/);

  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "session-12")));

  assert.equal(controller.snapshot().selectedId, "s12");
});

test("mouse clicks on list scroll indicators are ignored", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: manyViewSessions(20) });
  const view = new SessionsView(controller, () => {}, {
    terminalRows: () => 15,
    switchInsideTmux: (sessionId) => { opened.push(sessionId); },
  });
  const rendered = view.render(100);
  const indicator = rendered.findIndex((line) => stripAnsi(line).includes("↓"));
  assert.notEqual(indicator, -1, "missing scroll indicator");

  view.handleInput(mousePressAtLine(indicator));

  assert.equal(controller.snapshot().selectedId, "s0");
  assert.deepEqual(opened, []);
});

test("mouse wheel keeps selected row inside the bounded render", () => {
  const controller = new SessionsController({ version: 1, sessions: manyViewSessions(20) });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 15 });

  for (let i = 0; i < 12; i += 1) view.handleInput("\u001b[<65;5;5M");
  const rendered = view.render(100).map(stripAnsi);

  assert.equal(controller.snapshot().selectedId, "s12");
  assert.ok(rendered.some((line) => /▌│ .*session-12/.test(line)), rendered.join("\n"));
});

test("short help dialog is clipped with a resize marker", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 12 });

  view.handleInput("?");
  const rendered = view.render(100).map(stripAnsi);

  assert.equal(rendered.length, 12);
  assert.match(rendered.at(-1) ?? "", /… resize for full help/);
});

test("enter triggers attach action outside tmux", () => {
  const oldTmux = process.env.TMUX;
  delete process.env.TMUX;
  try {
    let attached: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, { attachOutsideTmux: (tmuxSession) => { attached = tmuxSession; } });
    view.handleInput("\r");
    assert.equal(attached, "pi-agent-hub-api");
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter inside tmux flashes switch command then restores footer without touching clipboard", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let now = 100;
    let switched: string | undefined;
    let copied: string | undefined;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      attachOutsideTmux: () => { throw new Error("outside attach should not run inside tmux"); },
      switchInsideTmux: (tmuxSession) => { switched = tmuxSession; },
      copy: (text) => { copied = text; },
      now: () => now,
    });

    view.handleInput("\r");

    assert.equal(switched, "pi-agent-hub-api");
    assert.equal(copied, undefined);
    assert.match(view.render(100).join("\n"), /tmux switch-client -t pi-agent-hub-api/);
    now = 1_700;
    const rendered = view.render(100).join("\n");
    assert.doesNotMatch(rendered, /tmux switch-client -t pi-agent-hub-api/);
    assert.match(rendered, /Enter Workspace .* : Actions .* \? Help/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on waiting session marks read before switching inside tmux", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let resolveAcknowledge: (() => void) | undefined;
    const events: string[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const };
    const controller = new SessionsController({ version: 1, sessions: [waiting] });
    const view = new SessionsView(controller, () => {}, {
      acknowledge: () => new Promise<void>((resolve) => {
        events.push("acknowledge");
        resolveAcknowledge = resolve;
      }),
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
    });

    view.handleInput("\r");

    assert.deepEqual(events, ["acknowledge"]);
    resolveAcknowledge?.();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["acknowledge", "switch:pi-agent-hub-api"]);
    const rendered = stripAnsi(view.render(100).join("\n"));
    assert.doesNotMatch(rendered, /marking read/);
    assert.match(rendered, /tmux switch-client -t pi-agent-hub-api/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("question Answer focuses the exact pinned session without opening another target", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const events: string[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    const controller = new SessionsController({ version: 1, sessions: [waiting, session("docs", "docs")] });
    const view = new SessionsView(controller, () => {}, {
      focusPinnedSession: async (id) => { events.push(`focus:${id}`); return { kind: "focused" }; },
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
      acknowledgeSession: (id, requestId) => { events.push(`ack:${id}:${requestId}`); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["focus:api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("new-user question coaching retires only after successful focus and Ctrl+Q return", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const saved: SessionsViewState[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [waiting] }), () => {}, {
      initialViewState: { grouping: "project", cockpitOnboarding: { cohort: "new", phase: "learning" } },
      saveViewState: (state) => { saved.push(state); },
      focusPinnedSession: async () => ({ kind: "focused" }),
      switchInsideTmux: async () => {},
      returnToCockpit: async () => ({ kind: "focused" }),
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saved.at(-1)?.cockpitOnboarding, {
      cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "question-1",
    });

    view.handleInput("\u001bq");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved.at(-1)?.cockpitOnboarding?.phase, "awaiting-return");

    view.handleInput("\u0011");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(saved.at(-1)?.cockpitOnboarding, { cohort: "new", phase: "complete" });
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("failed question focus or handoff never starts the coaching trip", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const waiting = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    for (const actions of [
      { focusPinnedSession: async () => { throw new Error("focus failed"); }, switchInsideTmux: async () => {} },
      { focusPinnedSession: async () => ({ kind: "unavailable" as const }), switchInsideTmux: async () => { throw new Error("switch failed"); } },
    ]) {
      const saved: SessionsViewState[] = [];
      const view = new SessionsView(new SessionsController({ version: 1, sessions: [waiting] }), () => {}, {
        initialViewState: { grouping: "project", cockpitOnboarding: { cohort: "new", phase: "learning" } },
        saveViewState: (state) => { saved.push(state); },
        acknowledgeSession: () => {},
        ...actions,
      });
      view.handleInput("\r");
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(saved.some((state) => state.cockpitOnboarding?.phase === "awaiting-return"), false);
    }
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("a fulfilled but unavailable handoff does not start the coaching trip", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const saved: SessionsViewState[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [waiting] }), () => {}, {
      initialViewState: { grouping: "project", cockpitOnboarding: { cohort: "new", phase: "learning" } },
      saveViewState: (state) => { saved.push(state); },
      focusPinnedSession: async () => ({ kind: "unavailable" }),
      acknowledgeSession: () => {},
      switchInsideTmux: async () => false,
    });
    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved.some((state) => state.cockpitOnboarding?.phase === "awaiting-return"), false);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("full-screen Ctrl+Q receipt completes a persisted pending trip", () => {
  const saved: SessionsViewState[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    initialViewState: { grouping: "project", cockpitOnboarding: {
      cohort: "new", phase: "awaiting-return", sessionId: "api", requestId: "question-1",
    } },
    saveViewState: (state) => { saved.push(state); },
  });

  view.completeFullScreenReturn("ctrl-q");

  assert.deepEqual(saved.at(-1)?.cockpitOnboarding, { cohort: "new", phase: "complete" });
});

test("question Answer falls back to acknowledge then open when the exact session is not pinned", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const events: string[] = [];
    const waiting = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    const controller = new SessionsController({ version: 1, sessions: [waiting] });
    const view = new SessionsView(controller, () => {}, {
      focusPinnedSession: async (id) => { events.push(`focus:${id}`); return { kind: "unavailable" }; },
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
      acknowledgeSession: (id, requestId) => { events.push(`ack:${id}:${requestId}`); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["focus:api", "ack:api:question-1", "switch:pi-agent-hub-api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("Answer revalidates question context before choosing the pin route", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const events: string[] = [];
    const selected = { ...session("api", "api"), status: "waiting" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as "question" | "ready", text: "Choose release" } } };
    const controller = new SessionsController({ version: 1, sessions: [selected] });
    const view = new SessionsView(controller, () => {}, {
      focusPinnedSession: (id) => { events.push(`focus:${id}`); return { kind: "focused" }; },
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
      acknowledgeSession: (id) => { events.push(`ack:${id}`); },
    });

    selected.context.attention = { requestId: "ready-2", kind: "ready", text: "Review result" };
    view.handleInput("\r");

    assert.deepEqual(events, ["ack:api", "switch:pi-agent-hub-api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("narrow question flow opens the workspace before Answer routes to Pi", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const events: string[] = [];
    const waiting = { ...session("api", "api"), status: "idle" as const,
      context: { version: 1 as const, updatedAt: 2, attention: { requestId: "question-1", kind: "question" as const, text: "Choose release" } } };
    const controller = new SessionsController({ version: 1, sessions: [waiting] });
    const view = new SessionsView(controller, () => {}, {
      focusPinnedSession: (id) => { events.push(`focus:${id}`); return { kind: "focused" }; },
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
    });

    view.render(80);
    view.handleInput("\r");
    assert.deepEqual(events, []);
    assert.match(stripAnsi(view.render(80).join("\n")), /Answer in the Pi session/);
    assert.match(stripAnsi(view.render(80).join("\n")), /Enter  Answer/);

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["focus:api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("external rename action selects the target session and opens rename dialog", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {});

  controller.move(1);

  assert.equal(view.openRenameForTmuxSession("pi-agent-hub-api"), true);
  const rendered = stripAnsi(view.render(100).join("\n"));

  assert.equal(controller.selected()?.id, "api");
  assert.match(rendered, /Rename session/);
  assert.match(rendered, /api/);
  assert.doesNotMatch(rendered, /rename api:/);
});

test("external rename action switches back to the session after rename", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let resolveRename: (() => void) | undefined;
    const events: string[] = [];
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      renameSession: (id, title) => new Promise<void>((resolve) => {
        events.push(`rename:${id}:${title}`);
        resolveRename = resolve;
      }),
      switchInsideTmux: (tmuxSession) => { events.push(`switch:${tmuxSession}`); },
    });

    assert.equal(view.openRenameForTmuxSession("pi-agent-hub-api"), true);
    view.handleInput(" ");
    view.handleInput("v");
    view.handleInput("2");
    view.handleInput("\r");

    assert.deepEqual(events, ["rename:api:api v2"]);
    resolveRename?.();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(events, ["rename:api:api v2", "switch:pi-agent-hub-api"]);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("inside tmux switch action errors show in footer", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    let now = 100;
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, {
      switchInsideTmux: async () => { throw new Error("switch failed"); },
      now: () => now,
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));
    now = 2_000;

    assert.match(view.render(100).join("\n"), /switch failed: switch failed/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on stopped session restarts instead of switching to missing tmux session", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const stopped = { ...session("api", "api"), status: "stopped" as const };
    const restarted: string[] = [];
    const switched: string[] = [];
    const controller = new SessionsController({ version: 1, sessions: [stopped] });
    const view = new SessionsView(controller, () => {}, {
      restart: async (id) => { restarted.push(id); },
      switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(restarted, ["api"]);
    assert.deepEqual(switched, []);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on error session restarts instead of switching to missing tmux session", async () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const dead = { ...session("api", "api"), status: "error" as const };
    const restarted: string[] = [];
    const switched: string[] = [];
    const controller = new SessionsController({ version: 1, sessions: [dead] });
    const view = new SessionsView(controller, () => {}, {
      restart: async (id) => { restarted.push(id); },
      switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    });

    view.handleInput("\r");
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(restarted, ["api"]);
    assert.deepEqual(switched, []);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("enter on stopped session without restart action reports unavailable transport", () => {
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), status: "stopped" }] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("\r");

  assert.match(view.render(100).join("\n"), /restart transport unavailable/);
});

test("new form worktree row toggles with space", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");

  assert.match(view.render(120).join("\n"), /▎ worktree\s+\[ \] off/);

  view.handleInput(" ");

  assert.match(view.render(120).join("\n"), /▎ worktree\s+\[x\] on/);
  assert.match(view.render(120).join("\n"), /space toggle/);
});

test("new form worktree toggle submits a branch without a title input", () => {
  let created: { cwd: string; group: string; worktree?: { branch: string } } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u0014");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /worktree\s+\[x\] on/);
  assert.match(rendered, /branch/);
  assert.doesNotMatch(rendered, /\n│▎?\s+title\s/);
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "feature/api") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", worktree: { branch: "feature/api" } });
});

test("new form worktree toggle can turn off without title state", () => {
  let created: { cwd: string; group: string; worktree?: { branch: string } } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u0014");
  view.handleInput("\u0014");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /worktree\s+\[ \] off/);
  assert.doesNotMatch(rendered, /\n│▎?\s+title\s/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "api" });
});

test("new form printable a and x edit the focused field instead of activating shortcuts", () => {
  let created: { cwd: string; group: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  view.handleInput("x");
  view.handleInput("a");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/api", group: "apixa" });
});

test("new form preserves a user-edited group across primary cwd changes", () => {
  let created: { cwd: string; group: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\t");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\u001b[Z");
  view.handleInput("\u001b[Z");
  view.handleInput("\u000e");
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "backend" });
});

test("new form worktree mode supports additional repos", () => {
  let created: unknown;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\u0014");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "feature/api") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web"], worktree: { branch: "feature/api" } });
});

test("new form add repo shortcut submits one additional cwd", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  assert.match(view.render(120).join("\n"), /\+ repo/);
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web"] });
});

test("new form add repo shortcut supports more than two additional cwds", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  for (const repo of ["/tmp/web", "/tmp/shared", "/tmp/docs"]) {
    view.handleInput("\u001ba");
    for (const char of repo) view.handleInput(char);
  }
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web", "/tmp/shared", "/tmp/docs"] });
});

test("new form remove shortcut removes focused extra repo and omits blank rows", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  for (const char of "/tmp/web") view.handleInput(char);
  view.handleInput("\u001ba");
  view.handleInput("\u001bx");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web"] });
});

test("new form remove shortcut is a no-op on primary repo", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  view.handleInput("\u001bx");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api" });
});

test("new form can default to selected session cwd, group, and all additional repos", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const controller = new SessionsController({
    version: 1,
    sessions: [{ ...session("api", "api"), cwd: "/repo/api", group: "backend", additionalCwds: ["/repo/web", "/repo/shared", "/repo/docs"] }],
  });
  const view = new SessionsView(controller, () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => {
      const selected = controller.selected();
      return {
        cwd: selected?.cwd ?? "/dashboard",
        group: selected?.group,
        knownCwds: ["/dashboard", "/repo/api", "/repo/web", "/repo/shared", "/repo/docs"],
        additionalCwds: selected?.additionalCwds,
      };
    },
  });
  view.handleInput("n");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /\/repo\/api/);
  assert.match(rendered, /\/repo\/web/);
  assert.match(rendered, /\/repo\/shared/);
  assert.match(rendered, /\/repo\/docs/);
  assert.match(rendered, /backend/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/repo/api", group: "backend", additionalCwds: ["/repo/web", "/repo/shared", "/repo/docs"] });
});

test("new form per-field validation focuses first invalid field on enter", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api" }),
  });
  view.handleInput("n");
  for (let i = 0; i < "/tmp/api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");
  const invalid = view.render(120).join("\n");
  assert.match(invalid, /New session/);
  assert.match(invalid, /primary is required/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(120).join("\n"), /primary is required/);
});

test("new form ctrl-n cycles primary cwd suggestions and updates group only", () => {
  let created: { cwd: string; group: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/web", "/tmp/api"] }),
  });
  view.handleInput("n");
  view.handleInput("\u000e");
  const rendered = view.render(120).join("\n");
  assert.match(rendered, /\/tmp\/web/);
  assert.match(rendered, /web/);
  view.handleInput("\r");
  assert.deepEqual(created, { cwd: "/tmp/web", group: "web" });
});

test("new form ctrl-n cycles cwd suggestions on extra repo fields", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  view.handleInput("\u000e");
  view.handleInput("\u000e");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web"] });
});

test("new form repo picker selects primary cwd and updates group", () => {
  let created: { cwd: string; group: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web-client"] }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  assert.match(view.render(120).join("\n"), /Recent repos/);
  for (const char of "client") view.handleInput(char);
  view.handleInput("\r");
  assert.match(view.render(120).join("\n"), /\/tmp\/web-client/);
  assert.match(view.render(120).join("\n"), /web-client/);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/web-client", group: "web-client" });
});

test("new form repo picker selects extra repo without changing group", () => {
  let created: { cwd: string; group: string; additionalCwds?: string[] } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\u001ba");
  view.handleInput("\u000f");
  for (const char of "web") view.handleInput(char);
  view.handleInput("\r");
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api", additionalCwds: ["/tmp/web"] });
});

test("new form repo picker escape preserves form state", () => {
  let created: { cwd: string; group: string } | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    createSession: (input) => { created = input; },
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  for (const char of "web") view.handleInput(char);
  view.handleInput("\u001b");
  assert.match(view.render(120).join("\n"), /New session/);
  view.handleInput("\r");

  assert.deepEqual(created, { cwd: "/tmp/api", group: "api" });
});

test("new form repo picker enter with no match stays open", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\u000f");
  for (const char of "zzz") view.handleInput(char);
  view.handleInput("\r");

  const rendered = view.render(120).join("\n");
  assert.match(rendered, /Recent repos/);
  assert.match(rendered, /No repos match/);
});

test("new form ctrl-o outside repo fields is a no-op", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    newFormContext: () => ({ cwd: "/tmp/api", knownCwds: ["/tmp/api", "/tmp/web"] }),
  });
  view.handleInput("n");
  view.handleInput("\t");
  view.handleInput("\u000f");

  assert.match(view.render(120).join("\n"), /New session/);
  assert.doesNotMatch(view.render(120).join("\n"), /Recent repos/);
});

test("delete dialog requires confirmation and escape cancels", () => {
  let deleted: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: (id) => { deleted = id; } });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Delete session/);
  assert.match(rendered, /api/);
  assert.match(rendered, /▶ d delete session/);
  view.handleInput("\u001b");
  assert.equal(deleted, undefined);
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog confirms with second d", () => {
  let deleted: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: (id) => { deleted = id; } });

  view.handleInput("d");
  view.handleInput("d");
  assert.equal(deleted, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog offers subagent-only cleanup for parent sessions", () => {
  let closed: string | undefined;
  let deleted: string | undefined;
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, {
    closeSubagents: (id) => { closed = id; },
    deleteSession: (id) => { deleted = id; },
  });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /1 subagent/);
  assert.match(rendered, /s\s+close subagents only/);
  assert.match(rendered, /d\s+delete session \+ subagents/);
  view.handleInput("s");

  assert.equal(closed, "api");
  assert.equal(deleted, undefined);
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog keeps full delete on d confirmation", () => {
  let closed: string | undefined;
  let deleted: string | undefined;
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, {
    closeSubagents: (id) => { closed = id; },
    deleteSession: (id) => { deleted = id; },
  });

  view.handleInput("d");
  view.handleInput("d");

  assert.equal(deleted, "api");
  assert.equal(closed, undefined);
});

test("delete dialog does not offer subagent-only cleanup for selected subagent", () => {
  const parent = session("api", "api");
  const child = { ...session("child", "smoke"), kind: "subagent" as const, parentId: parent.id, agentName: "smoke" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {}, { closeSubagents: () => {}, deleteSession: () => {} });

  controller.move(1);
  view.handleInput("d");
  const rendered = view.render(100).join("\n");

  assert.match(rendered, /target\s+smoke/);
  assert.doesNotMatch(rendered, /close subagents only/);
});

test("delete dialog distinguishes forgetting and discarding worktree sessions", () => {
  let deleted: string | undefined;
  let discarded: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, {
    deleteSession: (id) => { deleted = id; },
    discardWorktree: (id) => { discarded = id; },
    finishWorktree: () => {},
  });

  view.handleInput("d");
  const rendered = view.render(100).join("\n");

  assert.match(rendered, /d\s+forget dashboard row only/);
  assert.match(rendered, /keeps worktree and branch/);
  assert.match(rendered, /D\s+discard worktree and branch/);
  assert.match(rendered, /w\s+finish instead/);

  view.handleInput("d");
  assert.equal(deleted, "api");
  assert.equal(discarded, undefined);
});

test("delete dialog shift D discards worktree session", () => {
  let deleted: string | undefined;
  let discarded: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, {
    deleteSession: (id) => { deleted = id; },
    discardWorktree: (id) => { discarded = id; },
  });

  view.handleInput("d");
  view.handleInput("D");

  assert.equal(deleted, undefined);
  assert.equal(discarded, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog w finishes worktree session", () => {
  let deleted: string | undefined;
  let discarded: string | undefined;
  let finished: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, {
    deleteSession: (id) => { deleted = id; },
    discardWorktree: (id) => { discarded = id; },
    finishWorktree: (id) => { finished = id; },
  });

  view.handleInput("d");
  view.handleInput("w");

  assert.equal(deleted, undefined);
  assert.equal(discarded, undefined);
  assert.equal(finished, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("finish worktree dialog confirms with second w", () => {
  let finished: string | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{
    ...session("api", "api"),
    worktreePath: "/hub/worktrees/api/api-feature",
    worktreeRepoRoot: "/repo/api",
    worktreeBranch: "feature/api",
    worktreeBaseBranch: "main",
    worktreeOwnedByHub: true,
  }] });
  const view = new SessionsView(controller, () => {}, { finishWorktree: (id) => { finished = id; } });

  view.handleInput("w");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Finish worktree/);
  assert.match(rendered, /feature\/api → main/);
  assert.match(rendered, /w finish and merge/);
  view.handleInput("w");

  assert.equal(finished, "api");
  assert.doesNotMatch(view.render(100).join("\n"), /Finish worktree/);
});

test("finish worktree key explains non-worktree sessions", () => {
  let finished: string | undefined;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    finishWorktree: (id) => { finished = id; },
  });

  view.handleInput("w");

  assert.equal(finished, undefined);
  assert.match(view.render(100).join("\n"), /no Hub-owned worktree/);
});

test("delete dialog ignores repeated confirm while async delete is pending", async () => {
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: () => { calls += 1; return pending; } });

  view.handleInput("d");
  view.handleInput("d");
  view.handleInput("d");
  assert.equal(calls, 1);
  assert.match(view.render(100).join("\n"), /deleting/);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(view.render(100).join("\n"), /Delete session/);
});

test("delete dialog keeps async errors visible", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { deleteSession: async () => { throw new Error("delete failed"); } });

  view.handleInput("d");
  view.handleInput("d");
  await new Promise((resolve) => setImmediate(resolve));
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Delete session/);
  assert.match(rendered, /delete failed/);
});

test("controller removeSession keeps neighboring selection", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs"), session("web", "web")] });
  controller.move(1);
  controller.removeSession("docs");
  assert.equal(controller.snapshot().selectedId, "web");
  assert.deepEqual(controller.snapshot().registry.sessions.map((item) => item.id), ["api", "web"]);
});

test("group dialog moves selected session to typed group", () => {
  let moved: { id: string; group: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { changeGroup: (id, group) => { moved = { id, group }; } });

  view.handleInput("g");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Move to group/);
  assert.match(rendered, /▎ group\s+█/);
  assert.match(rendered, /existing or new group label/);
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(moved, { id: "api", group: "backend" });
  assert.doesNotMatch(view.render(100).join("\n"), /Move to group/);
});

test("group dialog validates blank group and escape cancels", () => {
  let moved: { id: string; group: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { changeGroup: (id, group) => { moved = { id, group }; } });

  view.handleInput("g");
  view.handleInput("\r");
  assert.equal(moved, undefined);
  assert.match(view.render(100).join("\n"), /group is required/);

  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(100).join("\n"), /Move to group/);
});

test("group dialog prepopulates and cycles visible existing groups", () => {
  let moved: { id: string; group: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [
    session("api", "api"),
    { ...session("docs", "docs"), group: "docs" },
    { ...session("web", "web"), group: "web" },
  ] });
  const view = new SessionsView(controller, () => {}, { changeGroup: (id, group) => { moved = { id, group }; } });

  view.handleInput("g");
  let rendered = stripAnsi(view.render(120).join("\n"));
  assert.match(rendered, /Move to group/);
  assert.match(rendered, /group\s+docs█/);
  assert.match(rendered, /ctrl-n\/p cycle 2 existing groups/);

  view.handleInput("\u000e");
  rendered = stripAnsi(view.render(120).join("\n"));
  assert.match(rendered, /group\s+web█/);

  view.handleInput("\u0010");
  rendered = stripAnsi(view.render(120).join("\n"));
  assert.match(rendered, /group\s+docs█/);

  view.handleInput("\r");
  assert.deepEqual(moved, { id: "api", group: "docs" });
});

test("group dialog cycles groups from the filtered dashboard", () => {
  const controller = new SessionsController({ version: 1, sessions: [
    session("api", "api"),
    { ...session("docs", "docs"), group: "docs" },
    { ...session("web", "web"), group: "web" },
  ] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  for (const char of "web") view.handleInput(char);
  view.handleInput("\r");
  controller.selectSession("web");
  view.handleInput("g");

  const rendered = stripAnsi(view.render(120).join("\n"));
  assert.match(rendered, /Move to group/);
  assert.match(rendered, /group\s+█/);
  assert.match(rendered, /existing or new group label/);
});

test("R opens rename form for selected session title", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    renameSession: (id, title) => { renamed = { id, title }; },
  });

  view.handleInput("R");
  const rendered = stripAnsi(view.render(100).join("\n"));
  assert.match(rendered, /Rename session/);
  assert.match(rendered, /title\s+api█/);
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "backend" });
  assert.doesNotMatch(view.render(100).join("\n"), /Rename session/);
});

test("R requires stopped and error sessions to restart before rename", () => {
  for (const status of ["stopped", "error"] as const) {
    const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), status }] });
    const view = new SessionsView(controller, () => {});
    view.handleInput("R");
    const rendered = stripAnsi(view.render(100).join("\n"));
    assert.match(rendered, /restart the Pi session before renaming/);
    assert.doesNotMatch(rendered, /Rename session/);
  }
});

test("narrow rename form keeps a long title and cursor visible", () => {
  const title = "Market Snapshot Workflow Review and Export";
  const controller = new SessionsController({ version: 1, sessions: [session("market", title)] });
  const view = new SessionsView(controller, () => {}, { renameSession: () => {} });

  view.handleInput("R");
  const rendered = view.render(42);
  const plain = rendered.map(stripAnsi);
  const titleLine = plain.find((line) => line.includes("title")) ?? "";

  assert.match(plain.join("\n"), /Rename session/);
  assert.match(titleLine, /….*█/);
  assert.ok(rendered.every((line) => visibleWidth(line) <= 42));
});

test("rename form supports cursor movement and mid-line editing", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("R");
  view.handleInput("\u001b[D");
  view.handleInput("X");
  assert.match(stripAnsi(view.render(100).join("\n")), /apX[█▌]i/);
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "apXi" });
});

test("rename form supports word movement and word backspace", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "alpha beta gamma")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("R");
  view.handleInput("\u001b[1;5D");
  view.handleInput("\u0017");
  view.handleInput("\r");

  assert.deepEqual(renamed, { id: "api", title: "alpha gamma" });
});

test("rename form validates blank title", () => {
  let renamed: { id: string; title: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: (id, title) => { renamed = { id, title }; } });

  view.handleInput("R");
  for (let i = 0; i < "api".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");

  assert.equal(renamed, undefined);
  assert.match(view.render(100).join("\n"), /title is required/);
});

test("custom Ctrl+N dashboard shortcut sends session-name refresh to selected live session", async () => {
  const runs: Array<{ sessionId: string; send: string }> = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    dashboardShortcuts: [{ key: "C-n", label: "refresh name", send: "/session-name refresh" }],
    runDashboardShortcut: async (sessionId, shortcut) => { runs.push({ sessionId, send: shortcut.send }); },
  });

  view.handleInput("\x0e");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(runs, [{ sessionId: "api", send: "/session-name refresh" }]);
  assert.match(stripAnsi(view.render(100).join("\n")), /refresh name → api/);
});

test("custom dashboard shortcut blocks subagent stopped and error rows", () => {
  const blockedSessions: ManagedSession[] = [
    { ...session("child", "child"), kind: "subagent", parentId: "missing", agentName: "scout" },
    { ...session("stopped", "stopped"), status: "stopped" },
    { ...session("error", "error"), status: "error" },
  ];
  const messages: RegExp[] = [/unavailable for subagents/, /session is not live/, /session is not live/];

  for (let i = 0; i < blockedSessions.length; i += 1) {
    let called = false;
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [blockedSessions[i]!] }), () => {}, {
      dashboardShortcuts: [{ key: "C-n", send: "/session-name refresh" }],
      runDashboardShortcut: () => { called = true; },
    });
    view.handleInput("\x0e");
    assert.equal(called, false);
    assert.match(stripAnsi(view.render(100).join("\n")), messages[i]!);
  }
});

test("custom dashboard shortcuts only run in normal mode", () => {
  let called = false;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    dashboardShortcuts: [{ key: "C-n", send: "/session-name refresh" }],
    runDashboardShortcut: () => { called = true; },
  });

  view.handleInput("/");
  view.handleInput("\x0e");

  assert.equal(called, false);
});

test("custom dashboard shortcut reports unavailable without a transport action", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    dashboardShortcuts: [{ key: "C-n", send: "/session-name refresh" }],
  });

  view.handleInput("\x0e");

  assert.match(stripAnsi(view.render(100).join("\n")), /shortcut transport unavailable/);
});

test("p opens footer send prompt and submits message to selected live session", async () => {
  const sent: Array<{ tmuxSession: string; message: string }> = [];
  let now = 100;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: async (tmuxSession, message) => { sent.push({ tmuxSession, message }); },
    now: () => now,
  });

  view.handleInput("p");
  const rawPrompt = view.render(100).join("\n");
  assert.match(rawPrompt, /\u001b\[5m█\u001b\[25m/);
  const prompt = stripAnsi(rawPrompt);
  assert.match(prompt, /pi agent hub/);
  assert.match(prompt, /▌│ ·\s+○ api/);
  assert.match(prompt, /send to api: █/);
  assert.doesNotMatch(prompt, /Send to api/);
  now = 1_100;
  assert.match(view.render(100).join("\n"), /\u001b\[5m▌\u001b\[25m/);
  for (const char of "fix it") view.handleInput(char);
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, [{ tmuxSession: "pi-agent-hub-api", message: "fix it" }]);
  assert.match(stripAnsi(view.render(100).join("\n")), /sent → api/);
  now = 3_000;
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /sent → api/);
});

test("unlink ticket sends the exact clear command to the bound session", async () => {
  const sent: Array<{ tmuxSession: string; message: string }> = [];
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("api", "api"), workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, ticketId: "ENG-42", updatedAt: 2 } },
    session("docs", "docs"),
  ] });
  const view = new SessionsView(controller, () => {}, {
    sendMessage: async (tmuxSession, message) => { sent.push({ tmuxSession, message }); },
  });

  view.handleInput(":");
  view.handleInput("u");
  view.handleInput("n");
  view.handleInput("l");
  view.handleInput("i");
  view.handleInput("n");
  view.handleInput("k");
  view.handleInput(" ");
  view.handleInput("t");
  view.handleInput("i");
  view.handleInput("c");
  view.handleInput("k");
  view.handleInput("e");
  view.handleInput("t");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(sent, [{ tmuxSession: "pi-agent-hub-api", message: "/wf-clear" }]);
  assert.match(stripAnsi(view.render(100).join("\n")), /ticket clear sent → api/);
  assert.equal(controller.snapshot().registry.sessions.length, 2);
});

test("themed footer text remains styled when input is truncated", () => {
  const theme = { ...darkTheme, dim: "#010203", border: "#040506" };
  const cases = [
    { key: "p", expected: "send to api:" },
  ];

  for (const { key, expected } of cases) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
      sendMessage: () => {},
    }, theme);
    view.handleInput(key);
    for (const char of "界".repeat(52)) view.handleInput(char);

    const footer = view.render(50).at(-2) ?? "";
    assert.match(footer, /\u001b\[38;2;1;2;3m/);
    assert.match(stripAnsi(footer), new RegExp(`${expected}.*…`));
    assert.ok(stripAnsi(footer).length <= 50, stripAnsi(footer));
  }
});

test("footer send prompt validates blank message and escape cancels", () => {
  const sent: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: (_tmuxSession, message) => { sent.push(message); },
  });

  view.handleInput("p");
  view.handleInput("\r");
  assert.match(stripAnsi(view.render(100).join("\n")), /message is required/);
  view.handleInput("\u001b");

  assert.deepEqual(sent, []);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /send to api/);
});

test("send shortcut blocks subagent stopped and error rows", () => {
  const blockedSessions: ManagedSession[] = [
    { ...session("child", "child"), kind: "subagent", parentId: "missing", agentName: "scout" },
    { ...session("stopped", "stopped"), status: "stopped" },
    { ...session("error", "error"), status: "error" },
  ];
  const messages: RegExp[] = [/unavailable for subagents/, /session is not live/, /session is not live/];

  for (let i = 0; i < blockedSessions.length; i += 1) {
    let called = false;
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [blockedSessions[i]!] }), () => {}, {
      sendMessage: () => { called = true; },
    });
    view.handleInput("p");
    assert.equal(called, false);
    assert.match(stripAnsi(view.render(100).join("\n")), messages[i]!);
  }
});

test("send shortcut allows all live statuses", () => {
  for (const status of ["starting", "running", "waiting", "idle"] as const) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [{ ...session(status, status), status }] }), () => {}, {
      sendMessage: () => {},
    });
    view.handleInput("p");
    assert.match(stripAnsi(view.render(100).join("\n")), new RegExp(`send to ${status}:`));
  }
});

test("send shortcut reports unavailable without a transport action", () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {});

  view.handleInput("p");

  assert.match(stripAnsi(view.render(100).join("\n")), /send transport unavailable/);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /send to api/);
});

test("send action errors show in footer", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    sendMessage: async () => { throw new Error("send failed"); },
  });

  view.handleInput("p");
  view.handleInput("h");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stripAnsi(view.render(100).join("\n")), /send failed/);
});

test("e remains a rename alias", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { renameSession: () => {} });

  view.handleInput("e");

  assert.match(stripAnsi(view.render(100).join("\n")), /Rename session/);
});

test("group rename dialog renames selected session current group", () => {
  let renamed: { from: string; to: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), group: "backend" }, { ...session("docs", "docs"), group: "backend" }] });
  const view = new SessionsView(controller, () => {}, { renameGroup: (from, to) => { renamed = { from, to }; } });

  view.handleInput("G");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Rename group/);
  assert.match(rendered, /▎ to\s+backend█/);
  assert.match(rendered, /renames all sessions currently in backend/);
  for (let i = 0; i < "backend".length; i += 1) view.handleInput("\u007f");
  for (const char of "api") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(renamed, { from: "backend", to: "api" });
  assert.doesNotMatch(view.render(100).join("\n"), /Rename group/);
});

test("group rename dialog validates blank group", () => {
  let renamed: { from: string; to: string } | undefined;
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), group: "backend" }] });
  const view = new SessionsView(controller, () => {}, { renameGroup: (from, to) => { renamed = { from, to }; } });

  view.handleInput("G");
  for (let i = 0; i < "backend".length; i += 1) view.handleInput("\u007f");
  view.handleInput("\r");

  assert.equal(renamed, undefined);
  assert.match(view.render(100).join("\n"), /group is required/);
});

test("Shift+F opens the fork form and submits compact mode", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  let compact: boolean | undefined;
  const view = new SessionsView(controller, () => {}, { forkSession: (_id, input) => { compact = input.compact; } });
  view.handleInput("F");
  assert.match(view.render(120).join("\n"), /Fork and compact/);
  view.handleInput("\r");
  assert.equal(compact, true);
});

test("fork dialog reports async action errors", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: async () => { throw new Error("history is not saved yet"); } });
  view.handleInput("f");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(view.render(120).join("\n"), /history is not saved yet/);
});

test("fork dialog blocks other registry writes while async action is pending", () => {
  let resolveFork: (() => void) | undefined;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { forkSession: () => new Promise<void>((resolve) => { resolveFork = resolve; }) });
  view.handleInput("f");
  view.handleInput("\r");
  view.handleInput("a");
  assert.equal(controller.snapshot().registry.sessions[0]?.acknowledgedAt, undefined);
  resolveFork?.();
});

test("async skills picker loads before rendering", async () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: async () => [{ name: "repo-rules", enabled: false }],
  });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /loading skills/);

  await new Promise((resolve) => setImmediate(resolve));

  assert.match(view.render(100).join("\n"), /Skills/);
  assert.match(view.render(100).join("\n"), /repo-rules/);
});

test("async picker loading keeps the project target from open through apply", async () => {
  const first = session("first", "first");
  const second = session("second", "second");
  const controller = new SessionsController({ version: 1, sessions: [first, second] });
  let release!: () => void;
  const loading = new Promise<void>((resolve) => { release = resolve; });
  let loadedFor: unknown;
  let appliedTo: unknown;
  const view = new SessionsView(controller, () => {}, {
    skills: async (target) => { loadedFor = target; await loading; return [{ name: "repo-rules", enabled: false }]; },
    applySkills: (_items, target) => { appliedTo = target; },
  });

  view.handleInput("s");
  controller.selectSession(second.id);
  release();
  await loading;
  await new Promise((resolve) => setImmediate(resolve));
  view.handleInput("\r");

  assert.deepEqual(loadedFor, { sessionId: first.id, projectCwd: first.cwd });
  assert.deepEqual(appliedTo, { sessionId: first.id, projectCwd: first.cwd });
});

test("skills picker toggles and applies with restart prompt", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    applySkills: (items) => { applied = items; },
  });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /Skills/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.[0]?.enabled, true);
  assert.match(view.render(100).join("\n"), /restart session to reload skills/);
});

test("picker apply reports async errors instead of success", async () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    applySkills: async () => { throw new Error("write failed"); },
  });
  view.handleInput("s");
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(view.render(100).join("\n"), /write failed/);
  assert.doesNotMatch(view.render(100).join("\n"), /restart session to reload skills/);
});

test("picker left and right arrows switch columns", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "api-tools", enabled: false }, { name: "repo-rules", enabled: true }],
    applySkills: (items) => { applied = items; },
  });

  view.handleInput("s");
  view.handleInput("\u001b[C");
  view.handleInput(" ");
  view.handleInput("\r");

  assert.equal(applied?.find((item) => item.name === "repo-rules")?.enabled, false);
});

test("picker search filters visible items before toggling", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "api-tools", enabled: false }, { name: "docs-tools", enabled: false }],
    applySkills: (items) => { applied = items; },
  });
  view.handleInput("s");
  for (const char of "docs") view.handleInput(char);
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /search: docs/);
  assert.match(rendered, /docs-tools/);
  assert.doesNotMatch(rendered, /api-tools/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.find((item) => item.name === "docs-tools")?.enabled, true);
  assert.equal(applied?.find((item) => item.name === "api-tools")?.enabled, false);
});

test("picker search accepts j k and e as text", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "jekyll", enabled: false }, { name: "docs", enabled: false }],
  });
  view.handleInput("s");
  for (const char of "jek") view.handleInput(char);
  const rendered = view.render(80).join("\n");
  assert.match(rendered, /search: jek/);
  assert.match(rendered, /jekyll/);
  assert.doesNotMatch(rendered, /docs/);
});

test("skills picker displays pool dir and saves edited pool", async () => {
  let saved: string | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "old-skill", enabled: false }],
    skillPoolDir: () => "",
    saveSkillPoolDir: async (dir) => {
      saved = dir;
      return [{ name: "new-skill", enabled: false }];
    },
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  for (const char of "/tmp/new-skills") view.handleInput(char);
  view.handleInput("\r");
  await new Promise((resolve) => setImmediate(resolve));

  const rendered = view.render(100).join("\n");
  assert.equal(saved, "/tmp/new-skills");
  assert.match(rendered, /pool: \/tmp\/new-skills/);
  assert.match(rendered, /new-skill/);
  assert.match(rendered, /skill pool saved/);
  assert.doesNotMatch(rendered, /old-skill/);
});

test("skills picker rejects blank pool dir without saving", () => {
  let called = false;
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    skillPoolDir: () => "   ",
    saveSkillPoolDir: () => { called = true; return []; },
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  view.handleInput("\r");

  assert.equal(called, false);
  assert.match(view.render(100).join("\n"), /skill pool dir cannot be blank/);
});

test("escape during skill pool edit keeps picker open", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [{ name: "repo-rules", enabled: false }],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("s");
  view.handleInput("\x1be");
  view.handleInput("\u001b");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Skills/);
  assert.match(rendered, /pool: \/tmp\/skills/);
});

test("empty skills picker still opens when pool dir can be edited", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    skills: () => [],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("s");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Skills/);
  assert.match(rendered, /pool: \/tmp\/skills/);
  assert.match(rendered, /No items match/);
});

test("mcp picker does not edit skill pool", () => {
  const view = new SessionsView(new SessionsController(), () => {}, {
    mcpServers: () => [{ name: "filesystem", enabled: false }],
    skillPoolDir: () => "/tmp/skills",
  });

  view.handleInput("m");
  view.handleInput("\x1be");

  const rendered = view.render(100).join("\n");
  assert.match(rendered, /MCP/);
  assert.doesNotMatch(rendered, /pool:/);
  assert.doesNotMatch(rendered, /Alt\+E edit pool/);
});

test("mcp picker toggles and applies with restart prompt", () => {
  let applied: Array<{ name: string; enabled: boolean }> | undefined;
  const view = new SessionsView(new SessionsController(), () => {}, {
    mcpServers: () => [{ name: "filesystem", enabled: false }],
    applyMcpServers: (items) => { applied = items; },
  });
  view.handleInput("m");
  assert.match(view.render(100).join("\n"), /MCP/);
  view.handleInput(" ");
  view.handleInput("\r");
  assert.equal(applied?.[0]?.enabled, true);
  assert.match(view.render(100).join("\n"), /restart session to reload MCP tools/);
});

test("empty picker shows nothing available and escape clears it", () => {
  const view = new SessionsView(new SessionsController(), () => {}, { skills: () => [] });
  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /skills: nothing available/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(100).join("\n"), /skills: nothing available/);
});

test("themed footer messages keep terminal width", () => {
  const view = new SessionsView(new SessionsController(), () => {}, { skills: () => [] }, darkTheme);
  view.handleInput("s");
  for (const line of view.render(80)) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
});

test("setTheme updates rendered ANSI without changing visible width", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {}, { ...darkTheme, accent: "#010203" });
  const before = view.render(80);

  view.setTheme({ ...darkTheme, accent: "#040506" });
  const after = view.render(80);

  assert.notEqual(after.join("\n"), before.join("\n"));
  assert.deepEqual(after.map(stripAnsi), before.map(stripAnsi));
  for (const line of after) assert.ok(stripAnsi(line).length <= 80, stripAnsi(line));
});

test("restart requires confirmation and supports new conversation", () => {
  const restarted: string[] = [];
  const fresh: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), restartNew: (id) => fresh.push(id) });
  view.handleInput("r");
  const rendered = view.render(100).join("\n");
  assert.match(rendered, /Restart session/);
  assert.match(rendered, /▶ r restart selected/);
  assert.match(rendered, /▶ n new conversation/);
  assert.match(rendered, /▶ a restart active/);
  assert.deepEqual(restarted, []);
  view.handleInput("n");
  assert.deepEqual(fresh, ["api"]);
  assert.deepEqual(restarted, []);

  view.handleInput("r");
  view.handleInput("r");
  assert.deepEqual(restarted, ["api"]);
});

test("restart dialog stays open until answered", () => {
  let now = 100;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { now: () => now, restart: () => {} });
  view.handleInput("r");
  now = 2_200;
  assert.match(view.render(100).join("\n"), /Restart session/);
});

test("restart dialog supports restart all", () => {
  let restartedAll = false;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, { restart: () => {}, restartAll: () => { restartedAll = true; } });

  view.handleInput("r");
  view.handleInput("a");

  assert.equal(restartedAll, true);
  assert.doesNotMatch(view.render(100).join("\n"), /Restart session/);
});

test("escape cancels pending restart", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("r");
  view.handleInput("\u001b");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("escape clearing filter also cancels hidden pending restart", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id), now: () => 100 });
  view.handleInput("/");
  view.handleInput("a");
  view.handleInput("\r");
  view.handleInput("r");
  view.handleInput("\u001b");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("restart confirmation ignores non-confirmation keys", () => {
  const restarted: string[] = [];
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    restart: (id) => restarted.push(id),
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
    now: () => 100,
    skills: () => [],
  });

  view.handleInput("r");
  view.handleInput("\r");
  assert.deepEqual(switched, []);
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("?");
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("s");
  assert.match(view.render(100).join("\n"), /Restart session/);

  view.handleInput("r");
  assert.deepEqual(restarted, ["api"]);
});

test("zero-match filter blocks selected actions", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "zzz") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  view.handleInput("r");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("filter matching ignores parent cwd directories for action selection", () => {
  const restarted: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), cwd: "/tmp/hidden-parent/api" }] });
  const view = new SessionsView(controller, () => {}, { restart: (id) => restarted.push(id) });
  view.handleInput("/");
  for (const char of "hidden") view.handleInput(char);
  assert.match(view.render(100).join("\n"), /No sessions match/);
  view.handleInput("\r");
  view.handleInput("r");
  view.handleInput("r");
  assert.deepEqual(restarted, []);
});

test("starting no-match filter clears stale attach flash", () => {
  const oldTmux = process.env.TMUX;
  process.env.TMUX = "/tmp/tmux";
  try {
    const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
    const view = new SessionsView(controller, () => {}, { switchInsideTmux: () => {} });
    view.handleInput("\r");
    assert.match(view.render(100).join("\n"), /switch-client/);
    view.handleInput("/");
    for (const char of "zzz") view.handleInput(char);
    assert.doesNotMatch(view.render(100).join("\n"), /switch-client/);
  } finally {
    if (oldTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = oldTmux;
  }
});

test("attention band locates the exact request without hijacking Enter or selected-row acknowledgement", async () => {
  const now = 100_000;
  const api = { ...session("api", "API"), status: "waiting" as const };
  const docs = {
    ...session("docs", "Docs"), status: "idle" as const, acknowledgedAt: 1,
    context: { version: 1 as const, updatedAt: now, attention: { requestId: "req/1", kind: "question" as const, text: "Choose release" } },
  };
  const controller = new SessionsController({ version: 1, sessions: [api, docs] });
  const acknowledgements: Array<[string, string | undefined]> = [];
  const opened: string[] = [];
  const view = new SessionsView(controller, () => {}, {
    now: () => now, terminalRows: () => 24,
    acknowledgeSession: (id, requestId) => { acknowledgements.push([id, requestId]); },
    attachOutsideTmux: (tmuxSession) => { opened.push(tmuxSession); },
  });
  view.setAttentionAnnouncements([{ sessionId: "docs", requestId: "req/1", kind: "question", text: "Choose release", title: "Docs", announcedAt: now, expiresAt: now + 6_000 }]);

  let rendered = view.render(100);
  let announcementLine = rendered.findIndex((line) => stripAnsi(line).includes(": locate"));
  assert.notEqual(announcementLine, -1);
  view.handleInput(":");
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /: locate/);
  view.handleInput("\u001b");
  rendered = view.render(100);
  announcementLine = rendered.findIndex((line) => stripAnsi(line).includes(": locate"));
  view.handleInput("a");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(acknowledgements, [["api", undefined]]);
  assert.equal(controller.snapshot().selectedId, "api");

  view.handleInput(mousePressAtLine(announcementLine, 40));
  assert.equal(controller.snapshot().selectedId, "docs");
  assert.equal(opened.length, 0);
  view.handleInput("a");
  assert.deepEqual(acknowledgements, [["api", undefined], ["docs", "req/1"]]);

  const runningController = new SessionsController({ version: 1, sessions: [{ ...api, status: "running" }, docs] });
  const recordOpen = (tmuxSession: string) => { opened.push(tmuxSession); };
  const runningView = new SessionsView(runningController, () => {}, { attachOutsideTmux: recordOpen, switchInsideTmux: recordOpen });
  runningView.setAttentionAnnouncements([{ sessionId: "docs", requestId: "req/1", kind: "question", text: "Choose release", title: "Docs", announcedAt: now, expiresAt: now + 6_000 }]);
  runningView.render(120);
  runningView.handleInput("\r");
  assert.deepEqual(opened, ["pi-agent-hub-api"]);
});

test("command palette toggles the persisted attention bell without adding a binding", async () => {
  let enabled = false;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    terminalRows: () => 30,
    attentionDelivery: {
      attentionBellEnabled: () => enabled,
      setAttentionBell: async (next) => { enabled = next; },
    },
  });

  view.render(100);
  view.handleInput(":");
  for (const char of "attention bell") view.handleInput(char);
  assert.match(stripAnsi(view.render(100).join("\n")), /Attention bell: Off/);
  view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  assert.equal(enabled, true);
  assert.match(stripAnsi(view.render(100).join("\n")), /attention bell · On/);
});

test("attention bell write failure keeps the effective value unchanged", async () => {
  let enabled = false;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    terminalRows: () => 30,
    attentionDelivery: {
      attentionBellEnabled: () => enabled,
      setAttentionBell: async () => { throw new Error("config locked"); },
    },
  });
  view.render(100);
  view.handleInput(":");
  for (const char of "attention bell") view.handleInput(char);
  view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  assert.equal(enabled, false);
  assert.match(stripAnsi(view.render(100).join("\n")), /config locked/);
});

test("colon opens the bottom command ledger and Escape returns to the cockpit", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  const palette = stripAnsi(view.render(100).join("\n"));
  assert.match(palette, /Search actions, sessions, filters/);
  assert.match(palette, /ACTIONS/);
  assert.match(palette, /Actions/);
  assert.match(palette, /Enter Workspace.*: Actions.*\? Help/);

  view.handleInput("\u001b");
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /Search actions, sessions, filters/);
});

test("command palette stays bounded and never executes hidden rows at short heights", () => {
  for (const height of [3, 4, 5]) {
    let opened = 0;
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
      attachOutsideTmux: () => { opened += 1; },
      terminalRows: () => height,
    });
    view.render(60);
    view.handleInput(":");
    const rendered = view.render(60);
    assert.equal(rendered.length, height);
    assert.match(stripAnsi(rendered.join("\n")), /resize to use command palette/);
    view.handleInput("\r");
    assert.equal(opened, 0);
    view.handleInput("\u001b");
  }

  for (const height of [6, 7, 8, 9]) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
      attachOutsideTmux: () => {},
      terminalRows: () => height,
    });
    view.render(60);
    view.handleInput(":");
    const rendered = view.render(60);
    assert.equal(rendered.length, height);
    assert.match(stripAnsi(rendered.join("\n")), /ACTIONS/);
    assert.match(stripAnsi(rendered.join("\n")), /Open/);
  }
});

test("palette session results select and reveal without opening", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const opened: string[] = [];
  const view = new SessionsView(controller, () => {}, {
    attachOutsideTmux: (tmuxSession) => { opened.push(tmuxSession); },
    terminalRows: () => 30,
  });

  view.render(100);
  view.handleInput(":");
  for (const char of "docs") view.handleInput(char);
  assert.match(stripAnsi(view.render(100).join("\n")), /docs/);
  view.handleInput("\r");

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(opened, []);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /Search actions, sessions, filters/);
});

test("palette session results follow cockpit order before hidden rows", () => {
  const quiet = session("quiet", "Task quiet");
  const error = { ...session("error", "Task error"), status: "error" as const };
  const controller = new SessionsController({ version: 1, sessions: [quiet, error] });
  controller.setFilter("quiet");
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  for (const char of "task") view.handleInput(char);
  const rendered = view.render(100).map(stripAnsi);
  const errorIndex = rendered.findIndex((line) => line.includes("Task error"));
  const quietIndex = rendered.findIndex((line) => line.includes("Task quiet"));

  assert.ok(errorIndex >= 0 && quietIndex >= 0);
  assert.ok(errorIndex < quietIndex);
});

test("palette mouse clicks execute items and outside clicks close without leaking", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  for (const char of "docs") view.handleInput(char);
  const palette = view.render(100);
  const docsLine = palette.findIndex((line) => stripAnsi(line).includes("docs") && !stripAnsi(line).includes(": docs"));
  assert.notEqual(docsLine, -1);
  view.handleInput(mousePressAtLine(docsLine));
  assert.equal(controller.snapshot().selectedId, "docs");

  view.handleInput(":");
  const reopened = view.render(100);
  const searchLine = reopened.findIndex((line) => stripAnsi(line).includes("Search actions, sessions, filters"));
  view.handleInput(mousePressAtLine(searchLine));
  assert.match(stripAnsi(view.render(100).join("\n")), /Search actions, sessions, filters/);
  view.handleInput(mousePressAtLine(0));
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /Search actions, sessions, filters/);
  assert.equal(controller.snapshot().selectedId, "docs");
});

test("palette session activation clears only an excluding fleet filter", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  controller.setFilter("api");
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  for (const char of "docs") view.handleInput(char);
  view.handleInput("\r");

  assert.equal(controller.snapshot().filter, undefined);
  assert.equal(controller.snapshot().selectedId, "docs");
});

test("palette reveals an older collapsed Archived result from the workflow board", () => {
  const archived = Array.from({ length: 7 }, (_, index) => ({
    ...session(`archive-${index}`, `archive-${index}`),
    status: "stopped" as const,
    bucket: "archived" as const,
    bucketChangedAt: 700 - index,
  }));
  const controller = new SessionsController({ version: 1, sessions: [session("active", "active"), ...archived] });
  const saved: SessionsViewState[] = [];
  const view = new SessionsView(controller, () => {}, {
    initialViewState: { grouping: "stage", collapsedSections: ["archived"] },
    saveViewState: (state) => { saved.push(state); },
    terminalRows: () => 30,
  });

  view.render(100);
  view.handleInput(":");
  for (const char of "archive-6") view.handleInput(char);
  view.handleInput("\r");
  const rendered = stripAnsi(view.render(100).join("\n"));

  assert.equal(controller.snapshot().selectedId, "archive-6");
  assert.match(rendered, /ARCHIVED/);
  assert.match(rendered, /archive-6/);
  assert.doesNotMatch(rendered, /OTHER ACTIVE/);
  assert.deepEqual(saved, []);
});

test("palette action target cannot drift when selection changes", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  for (const char of "rename") view.handleInput(char);
  assert.match(stripAnsi(view.render(100).join("\n")), /Rename…/);
  controller.selectSession("docs");
  view.handleInput("\r");

  const rendered = stripAnsi(view.render(100).join("\n"));
  assert.doesNotMatch(rendered, /title .*docs/);
  assert.match(rendered, /target changed|no longer available/);
});

test("palette shows blocked actions with reasons and does not execute them", () => {
  const child = { ...session("child", "child"), kind: "subagent" as const, parentId: "owner", agentName: "worker" };
  let archived = false;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [child] }), () => {}, {
    archiveSession: () => { archived = true; },
    terminalRows: () => 30,
  });

  view.render(100);
  view.handleInput(":");
  for (const char of "archive") view.handleInput(char);
  assert.match(stripAnsi(view.render(100).join("\n")), /unavailable for subagents/);
  view.handleInput("\r");

  assert.equal(archived, false);
  assert.match(stripAnsi(view.render(100).join("\n")), /unavailable for subagents/);
});

test("palette and direct v execute configured dashboard shortcuts", () => {
  const sent: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    dashboardShortcuts: [{ key: "C-x", label: "Summarize", send: "/summary" }, { key: "v", label: "Verify", send: "/verify" }],
    runDashboardShortcut: (id, shortcut) => { sent.push(`${id}:${shortcut.send}`); },
    terminalRows: () => 30,
  });

  view.render(100);
  view.handleInput("v");
  view.handleInput(":");
  for (const char of "summarize") view.handleInput(char);
  view.handleInput("\r");

  assert.deepEqual(sent, ["api:/verify", "api:/summary"]);
});

test("palette exposes named status filters and direct Help", () => {
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("api", "api"), status: "running" },
    session("docs", "docs"),
  ] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30 });

  view.render(100);
  view.handleInput(":");
  for (const char of "status: running") view.handleInput(char);
  view.handleInput("\r");
  assert.equal(controller.snapshot().filter, "running");
  assert.match(stripAnsi(view.render(100).join("\n")), /api/);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /docs/);

  view.handleInput("\u001b");
  view.handleInput("?");
  assert.match(stripAnsi(view.render(100).join("\n")), /pi agent hub help/);
});

test("resize below the minimum width clears stale workspace hit targets", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const wide = view.render(120);
  const openRow = wide.findIndex((line) => stripAnsi(line).includes("Enter Open"));
  assert.notEqual(openRow, -1);

  view.render(39);
  view.handleInput(mousePressAtLine(openRow, 110));

  assert.deepEqual(switched, []);
});

test("colon is inert below the minimum dashboard width", () => {
  const view = new SessionsView(new SessionsController(), () => {});
  view.render(39);
  view.handleInput(":");
  assert.doesNotMatch(stripAnsi(view.render(39).join("\n")), /Search actions, sessions, filters/);
});
