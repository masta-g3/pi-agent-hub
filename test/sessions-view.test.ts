import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SessionsController } from "../src/app/controller.js";
import { computeStatus } from "../src/core/status.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { darkTheme, stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";
import type { SessionsViewState } from "../src/tui/dialog.js";

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

test("narrow info is action-gated and returns with i or Escape", () => {
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
  let stopped = false;
  let restarted = 0;
  let pane = 0;
  const controller = new SessionsController({ version: 1, sessions: [explained] });
  const view = new SessionsView(controller, () => { stopped = true; }, {
    now: () => now,
    restart: () => { restarted += 1; },
    assignSidePaneSlot: () => { pane += 1; return { status: "assigned", slot: 1 } as never; },
  });

  view.render(60);
  view.handleInput("i");
  const info = stripAnsi(view.render(60).join("\n"));
  assert.match(info, /why this status/);
  assert.match(info, /waiting · NEEDS YOU/);
  assert.doesNotMatch(info, /── NEEDS YOU/);

  for (const key of ["j", "r", "1", "p", "q"]) view.handleInput(key);
  assert.equal(controller.snapshot().selectedId, "api");
  assert.equal(restarted, 0);
  assert.equal(pane, 0);
  assert.equal(stopped, false);

  view.handleInput("i");
  assert.match(stripAnsi(view.render(60).join("\n")), /── NEEDS YOU/);
  view.handleInput("i");
  view.handleInput("\u001b");
  assert.match(stripAnsi(view.render(60).join("\n")), /── NEEDS YOU/);
});

test("info waits for matching evidence from a refresh", async () => {
  const base = session("api", "api");
  const now = 100_000;
  let current = base as typeof base & { statusEvidence?: ReturnType<typeof computeStatus>["evidence"] };
  let registry = { version: 1 as const, sessions: [current] };
  let resolve!: () => void;
  const refresh = new Promise<void>((done) => { resolve = done; });
  const controller = {
    snapshot: () => ({ registry, sessions: [current], selectedId: current.id, preview: "", filter: undefined }),
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
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /why this status/);
  resolve();
  await refresh;
  await new Promise((done) => setImmediate(done));
  assert.match(stripAnsi(view.render(60).join("\n")), /why this status/);
});

test("info stays closed when refresh produces no matching evidence", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { refreshStatusEvidence: async () => {} });

  view.render(60);
  view.handleInput("i");
  await new Promise((done) => setImmediate(done));

  const rendered = stripAnsi(view.render(60).join("\n"));
  assert.doesNotMatch(rendered, /why this status/);
  assert.match(rendered, /status evidence unavailable/);
});

test("narrow info closes when selection changes outside the gated screen", () => {
  const now = 100_000;
  const sessions = ["api", "docs"].map((id) => {
    const base = session(id, id);
    return { ...base, statusEvidence: computeStatus({ session: base, tmux: { exists: true }, now }).evidence };
  });
  const controller = new SessionsController({ version: 1, sessions });
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.render(60);
  view.handleInput("i");
  assert.match(stripAnsi(view.render(60).join("\n")), /why this status/);
  controller.selectSession("docs");
  assert.doesNotMatch(stripAnsi(view.render(60).join("\n")), /why this status/);
});

test("narrow i opens Info after expanded wide details and wide Escape still clears filtering", () => {
  const now = 100_000;
  const base = session("api", "api");
  const explained = { ...base, statusEvidence: computeStatus({ session: base, tmux: { exists: true }, now }).evidence };
  const controller = new SessionsController({ version: 1, sessions: [explained] });
  const view = new SessionsView(controller, () => {}, { now: () => now });

  view.render(100);
  view.handleInput("i");
  view.render(60);
  view.handleInput("i");
  assert.match(stripAnsi(view.render(60).join("\n")), /why this status/);
  view.handleInput("i");

  view.render(100);
  view.handleInput("i");
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
  assert.match(rendered, /1\/2 sessions .* filter: do/);
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
  assert.match(help, /Alt\+Q/);
  assert.match(help, /Ctrl\+Q/);
  assert.match(help, /Alt\+R/);
  assert.match(help, /i toggle/);
  assert.match(help, /p send/);
  assert.match(help, /zero counts are hidden/);
  assert.match(help, /1-4 assign \(stay here\)/);
  assert.match(help, /x then 1-4 close panel/);
  assert.match(help, /F then 1-4 or Alt\+1-4 focus panel/);
  assert.match(help, /o reset to one panel/);
  assert.match(help, /mouse click select · double-click open\/switch/);
  assert.match(help, /v cycle row density/);
  assert.match(help, /t theme settings/);
  assert.match(help, /Project view: Needs you · Health · Active · Quiet/);
  assert.match(help, /only explicit producer attention enters Needs you/);
  assert.match(help, /Archived is flat and chronological/);
  assert.match(help, /Board view lanes canonical workflow sessions by producer step, then OTHER ACTIVE/);
  assert.match(help, /subagent trees: ←\/→ collapse\/expand selected · Shift\+←\/→ all/);
  assert.match(help, /subagent trees start collapsed; Space toggles one board tree/);
  view.handleInput("\u001b");
  assert.doesNotMatch(view.render(80).join("\n"), /pi agent hub help/);
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

  assert.match(stripAnsi(view.render(100).join("\n")), /subagent rows follow their parent section/);
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
  assert.match(stripAnsi(view.render(120).join("\n")), /view lanes/);
  assert.equal(controller.snapshot().selectedId, "a");

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "b", "j wraps to plan lane row");
  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "a", "lane order is plan then execute");
  view.handleInput("k");
  assert.equal(controller.snapshot().selectedId, "b");

  view.handleInput("S");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /view lanes/);
});

test("Space expands and collapses the selected board parent tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker/);
  assert.match(stripAnsi(view.render(120).join("\n")), /api/);

  view.handleInput(" ");
  assert.match(stripAnsi(view.render(120).join("\n")), /api ▾/);
  assert.match(stripAnsi(view.render(120).join("\n")), /worker/);
  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");

  view.handleInput(" ");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker/);
});

test("left and right arrows expand and collapse the selected project tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker/);
  view.handleInput("\u001b[C");
  assert.match(stripAnsi(view.render(120).join("\n")), /api[\s\S]*worker/);

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");
  view.handleInput("\u001b[D");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker/);
});

test("left and right arrows collapse and expand the selected board tree", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const controller = new SessionsController({ version: 1, sessions: [parent, child] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("S");
  view.handleInput("\u001b[C");
  assert.match(stripAnsi(view.render(120).join("\n")), /api ▾[\s\S]*worker/);

  view.handleInput("j");
  assert.equal(controller.snapshot().selectedId, "child");
  view.handleInput("\u001b[D");
  assert.equal(controller.snapshot().selectedId, "parent");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker/);
});

test("shift arrows expand and collapse all project trees", () => {
  const sessions = [
    session("a", "api"),
    { ...session("a-child", "api"), kind: "subagent" as const, parentId: "a", agentName: "api-worker" },
    session("b", "docs"),
    { ...session("b-child", "docs"), kind: "subagent" as const, parentId: "b", agentName: "docs-worker" },
  ];
  const view = new SessionsView(new SessionsController({ version: 1, sessions }), () => {});

  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /api-worker|docs-worker/);
  view.handleInput("\u001b[1;2C");
  assert.match(stripAnsi(view.render(120).join("\n")), /api-worker/);
  assert.match(stripAnsi(view.render(120).join("\n")), /docs-worker/);

  view.handleInput("\u001b[1;2D");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /api-worker|docs-worker/);
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
  assert.match(stripAnsi(view.render(120).join("\n")), /api-worker/);
  assert.match(stripAnsi(view.render(120).join("\n")), /docs-worker/);

  controller.selectSession("b-child");
  view.render(120);
  view.handleInput("\u001b[1;2D");
  assert.equal(controller.snapshot().selectedId, "b");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /api-worker|docs-worker/);
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
  assert.match(stripAnsi(view.render(120).join("\n")), /api[\s\S]*worker/);
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
  assert.match(stripAnsi(view.render(120).join("\n")), /api[\s\S]*worker-special/);
  view.handleInput(" ");

  view.handleInput("\u001b");
  assert.match(stripAnsi(view.render(120).join("\n")), /api/);
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /worker-special/);
});

test("an empty board filter draft keeps collapsed navigation and rendering aligned", () => {
  const parent = { ...session("parent", "api"), workflow: { ...VIEW_WORKFLOW, activeIndex: 1 } };
  const child = { ...session("child", "other"), kind: "subagent" as const, parentId: "parent", agentName: "worker" };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [parent, child] }), () => {});

  view.handleInput("S");
  view.handleInput("/");

  const text = stripAnsi(view.render(120).join("\n"));
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

test("v toggles and persists compact and junction density modes", () => {
  const saved: SessionsViewState[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    saveViewState: (state) => { saved.push(state); },
  });

  view.handleInput("v");
  view.handleInput("v");

  assert.deepEqual(saved, [
    { grouping: "project", density: "all-cards" },
    { grouping: "project", density: "compact" },
  ]);
});

test("v inside filter mode edits the filter instead of toggling views", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("/");
  view.handleInput("v");

  assert.equal(controller.snapshot().filter, "v");
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /view lanes/);
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

test("board empty state blocks actions on hidden non-Active selections", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("plain", "plain"), bucket: "backlog", bucketChangedAt: 1 }] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (sessionId) => { opened.push(sessionId); return { kind: "opened", slot: 1 }; },
  });

  view.handleInput("S");
  view.handleInput("1");
  assert.deepEqual(opened, []);
  assert.match(stripAnsi(view.render(80).join("\n")), /No Active sessions/);

  view.handleInput("S");
  view.handleInput("1");
  assert.deepEqual(opened, ["plain"]);
});

test("side pane presence snapshots render numbered slot glyphs", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const sidePaneSessionIds = new Map([["api", 2], ["docs", 1]]);
  const view = new SessionsView(controller, () => {}, { sidePaneSessionIds: () => sidePaneSessionIds });

  const rendered = stripAnsi(view.render(100).join("\n"));
  assert.match(rendered, /○ ◫2 api/);
  assert.match(rendered, /○ ◫1 docs/);
  assert.doesNotMatch(rendered, /── preview/);
});

test("side pane presence snapshots update without registry mutation", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  let sidePaneSessionIds = new Map<string, number>();
  const view = new SessionsView(controller, () => {}, { sidePaneSessionIds: () => sidePaneSessionIds });

  const withoutPanels = stripAnsi(view.render(100).join("\n"));
  assert.doesNotMatch(withoutPanels, /◫/);
  assert.match(withoutPanels, /── preview/);
  sidePaneSessionIds = new Map([["api", 1]]);
  const withPanel = stripAnsi(view.render(100).join("\n"));
  assert.match(withPanel, /○ ◫1 api/);
  assert.doesNotMatch(withPanel, /── preview/);
});

test("number keys assign the selected live session to matching panel slots", () => {
  const opened: { id: string; slot: number }[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (sessionId, slot) => {
      opened.push({ id: sessionId, slot });
      return { kind: "opened", slot };
    },
  });

  for (const key of ["1", "2", "3", "4"]) view.handleInput(key);

  assert.deepEqual(opened, [1, 2, 3, 4].map((slot) => ({ id: "api", slot })));
  assert.match(stripAnsi(view.render(100).join("\n")), /panel 4: api/);
});

test("shift-number keys no longer focus panel slots", () => {
  const focused: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    focusSidePaneSlot: (slot) => {
      focused.push(slot);
      return { kind: "focused" };
    },
  });

  for (const key of ["!", "@", "#", "$"]) view.handleInput(key);

  assert.deepEqual(focused, []);
});

test("F then a digit focuses the matching panel instead of toggling it", () => {
  const focused: number[] = [];
  const toggled: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    focusSidePaneSlot: (slot) => {
      focused.push(slot);
      return { kind: "focused" };
    },
    assignSidePaneSlot: (_sessionId, slot) => {
      toggled.push(slot);
      return { kind: "opened", slot };
    },
  });

  view.handleInput("F");
  assert.match(stripAnsi(view.render(100).join("\n")), /focus panel: press 1-4/);
  view.handleInput("2");

  assert.deepEqual(focused, [2]);
  assert.deepEqual(toggled, []);
});

test("the F focus chord cancels on non-digits and dialog or mouse input", () => {
  const focused: number[] = [];
  const toggled: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    focusSidePaneSlot: (slot) => {
      focused.push(slot);
      return { kind: "focused" };
    },
    assignSidePaneSlot: (_sessionId, slot) => {
      toggled.push(slot);
      return { kind: "opened", slot };
    },
  });

  view.handleInput("F");
  view.handleInput("?");
  view.handleInput("?");
  view.handleInput("2");

  view.render(100);
  view.handleInput("F");
  view.handleInput("\u001b[<0;3;4M");
  view.handleInput("3");

  view.handleInput("F");
  view.handleInput("j");
  view.handleInput("4");

  assert.deepEqual(focused, []);
  assert.deepEqual(toggled, [2, 3, 4]);
});

test("x then a digit closes that panel and reports unavailable slots", () => {
  const closed: number[] = [];
  const results = [{ kind: "closed" as const }, { kind: "unavailable" as const }];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    closeSidePaneSlot: (slot) => {
      closed.push(slot);
      return results.shift()!;
    },
  });

  view.handleInput("x");
  assert.match(stripAnsi(view.render(100).join("\n")), /close panel: press 1-4/);
  view.handleInput("2");
  assert.match(stripAnsi(view.render(100).join("\n")), /panel 2 closed/);
  view.handleInput("x");
  view.handleInput("3");
  assert.match(stripAnsi(view.render(100).join("\n")), /panel 3 is not open/);
  assert.deepEqual(closed, [2, 3]);
});

test("x close chord disarms on other input and falls through", () => {
  const closed: number[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    closeSidePaneSlot: (slot) => { closed.push(slot); return { kind: "closed" }; },
  });
  view.handleInput("x");
  view.handleInput("j");
  view.handleInput("2");
  assert.deepEqual(closed, []);
  assert.equal(controller.snapshot().selectedId, "api");
});

test("number keys override configured dashboard shortcuts", () => {
  const panelSlots: number[] = [];
  const sent: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    dashboardShortcuts: [{ key: "1", send: "legacy" }, { key: "!", send: "legacy focus" }],
    runDashboardShortcut: (_id, shortcut) => { sent.push(shortcut.send); },
    assignSidePaneSlot: (_sessionId, slot) => {
      panelSlots.push(slot);
      return { kind: "opened", slot };
    },
    focusSidePaneSlot: () => ({ kind: "focused" }),
  });

  view.handleInput("1");
  view.handleInput("!");

  assert.deepEqual(panelSlots, [1]);
  assert.deepEqual(sent, ["legacy focus"]);
});

test("o resets side panels to the selected session", async () => {
  const reset: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    resetSidePane: async (sessionId) => {
      reset.push(sessionId);
      return { kind: "retargeted", slot: 1 };
    },
  });

  view.handleInput("o");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(reset, ["api"]);
  assert.match(stripAnsi(view.render(100).join("\n")), /panel: api/);
});

test("panel shortcuts flash unchanged and assigned fixed slots without implying focus", () => {
  const results = [{ kind: "unchanged" as const, slot: 1 as const }, { kind: "opened" as const, slot: 3 as const }];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: () => results.shift() ?? { kind: "opened", slot: 1 },
  });

  view.handleInput("1");
  assert.match(stripAnsi(view.render(100).join("\n")), /panel 1: api/);
  assert.doesNotMatch(stripAnsi(view.render(100).join("\n")), /focused/);
  view.handleInput("3");
  assert.match(stripAnsi(view.render(100).join("\n")), /panel 3: api/);
});

test("panel shortcuts explain narrow-window refusals", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: () => ({ kind: "too-narrow", panels: 3 }),
  });

  view.handleInput("3");

  assert.match(stripAnsi(view.render(100).join("\n")), /window too narrow for 3 panels/);
});

test("panel shortcuts block stopped and error sessions", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [
    { ...session("stopped", "stopped"), status: "stopped" },
    { ...session("error", "error"), status: "error" },
  ] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (sessionId) => {
      opened.push(sessionId);
      return { kind: "opened", slot: 1 };
    },
    resetSidePane: (sessionId) => {
      opened.push(sessionId);
      return { kind: "opened", slot: 1 };
    },
  });

  view.handleInput("1");
  controller.move(1);
  view.handleInput("o");

  assert.deepEqual(opened, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /session not running/);
});

test("panel shortcuts allow live subagent rows", () => {
  const opened: { id: string; slot: number }[] = [];
  const controller = new SessionsController({ version: 1, sessions: [
    session("parent", "parent"),
    { ...session("child", "child"), kind: "subagent" as const, parentId: "parent", agentName: "scout" },
  ] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (sessionId, slot) => {
      opened.push({ id: sessionId, slot });
      return { kind: "opened", slot };
    },
  });

  controller.move(1);
  view.handleInput("2");

  assert.deepEqual(opened, [{ id: "child", slot: 2 }]);
});

test("panel shortcuts flash tmux guidance from the action", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: async () => { throw new Error("side pane needs tmux — run pi-hub"); },
  });

  view.handleInput("1");
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stripAnsi(view.render(100).join("\n")), /side pane needs tmux — run pi-hub/);
});

test("panel shortcuts are swallowed while a dialog is open", () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, {
    assignSidePaneSlot: (sessionId) => {
      opened.push(sessionId);
      return { kind: "opened", slot: 1 };
    },
  });

  view.handleInput("?");
  view.handleInput("1");
  view.handleInput("o");

  assert.deepEqual(opened, []);
  assert.match(stripAnsi(view.render(100).join("\n")), /pi agent hub help/);
});

function mousePressAtLine(lineIndex: number, x = 3): string {
  return `\u001b[<0;${x};${lineIndex + 1}M`;
}

function mouseReleaseAtLine(lineIndex: number, x = 3): string {
  return `\u001b[<0;${x};${lineIndex + 1}m`;
}

function rowIndexFor(rendered: string[], title: string): number {
  const index = rendered.findIndex((line) => {
    const text = stripAnsi(line);
    return text.includes(title) && /^│[▌ ] [●◐○×-]/.test(text);
  });
  assert.notEqual(index, -1, `missing rendered row for ${title}`);
  return index;
}

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

test("card continuation rows select and double-click open their session", () => {
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
  assert.deepEqual(switched, ["pi-agent-hub-docs"]);
});

test("keyboard and mouse selection changes request an immediate preview", () => {
  let requests = 0;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    selectionChanged: () => { requests += 1; },
  });

  view.handleInput("j");
  const rendered = view.render(100);
  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "api")));
  view.handleInput("/");
  view.handleInput("d");
  view.handleInput("o");

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.equal(requests, 3);
});

test("double-click opens the clicked live session", () => {
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
  now = 350;
  view.handleInput(docsClick);

  assert.equal(controller.snapshot().selectedId, "docs");
  assert.deepEqual(switched, ["pi-agent-hub-docs"]);
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
  assert.deepEqual(saved.at(-1), { grouping: "project", density: "compact", collapsedSections: ["archived"] });
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
    assignSidePaneSlot: (id) => { events.push(`panel:${id}`); return { kind: "opened", slot: 1 }; },
    restart: (id) => { events.push(`restart:${id}`); },
  });

  for (let index = 0; index < 5; index += 1) view.handleInput("j");
  assert.match(stripAnsi(view.render(80).join("\n")), /… 2 older archived/);

  for (const key of ["A", "J", "1", "r"]) view.handleInput(key);
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
  const keys = ["x", "N", "f", "g", "G", "s", "m", "w", "a", "A", "B", "U", "d", "r", "R", "p", "1", "o", "J"];

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
      assignSidePaneSlot: () => { events.push("panel"); return { kind: "opened", slot: 1 }; },
      resetSidePane: () => { events.push("reset"); return { kind: "opened", slot: 1 }; },
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

test("double-click restarts a stopped session", () => {
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

test("mouse clicks ignore cockpit tier headings and details pane", () => {
  const switched: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, {
    switchInsideTmux: (tmuxSession) => { switched.push(tmuxSession); },
  });
  const rendered = view.render(100);
  const before = controller.snapshot().selectedId;

  const headerIndex = rendered.findIndex((line) => stripAnsi(line).includes("QUIET"));
  assert.notEqual(headerIndex, -1, "missing cockpit tier heading");
  view.handleInput(mousePressAtLine(headerIndex));
  view.handleInput(mousePressAtLine(rowIndexFor(rendered, "docs"), 99));

  assert.equal(controller.snapshot().selectedId, before);
  assert.deepEqual(switched, []);
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
  const view = new SessionsView(controller, () => {});
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
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 15, sidePaneSessionIds: () => new Map([["s0", 1]]) });
  const rendered = view.render(42).map(stripAnsi);

  assert.match(rendered.at(-2) ?? "", /1-4 Set · x# Close · F# Focus · \? Help/);
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
  assert.ok(rendered.some((line) => /▌ .*session-12/.test(line)), rendered.join("\n"));
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
    assert.match(rendered, /Enter Open .* i Info .* \? Help/);
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

test("enter on stopped session without restart action explains the recovery key", () => {
  const controller = new SessionsController({ version: 1, sessions: [{ ...session("api", "api"), status: "stopped" }] });
  const view = new SessionsView(controller, () => {});

  view.handleInput("\r");

  assert.match(view.render(100).join("\n"), /session stopped; press r twice to restart/);
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

test("selected session surfaces cached skill count", () => {
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api")] });
  const view = new SessionsView(controller, () => {}, { skillCount: (cwd) => cwd === "/tmp/api" ? 2 : undefined });

  assert.match(view.render(120).join("\n"), /skills 2\s+s\/m edit/);
});


test("i toggles selected session metadata expansion", () => {
  const controller = new SessionsController({
    version: 1,
    sessions: [{
      ...session("api", "api"),
      cwd: "/repo/api",
      additionalCwds: ["/repo/web"],
      workspaceCwd: "/state/workspaces/api",
    }],
  });
  const view = new SessionsView(controller, () => {});

  const compact = view.render(120).join("\n");
  assert.match(compact, /\/repo\/api · 2 repos/);
  assert.doesNotMatch(compact, /group default/);
  assert.doesNotMatch(compact, /extra\s+\/repo\/web/);

  view.handleInput("i");
  const expanded = view.render(120).join("\n");
  assert.match(expanded, /extra\s+\/repo\/web/);
  assert.match(expanded, /runtime\s+\/state\/workspaces\/api/);

  view.handleInput("i");
  assert.doesNotMatch(view.render(120).join("\n"), /extra\s+\/repo\/web/);
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
  const view = new SessionsView(controller, () => {}, { closeSubagents: () => {} });

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

test("finish worktree key ignores non-worktree sessions", () => {
  let finished: string | undefined;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [session("api", "api")] }), () => {}, {
    finishWorktree: (id) => { finished = id; },
  });

  view.handleInput("w");

  assert.equal(finished, undefined);
  assert.match(view.render(100).join("\n"), /selected session is not a worktree/);
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
  const view = new SessionsView(controller, () => {});

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
  const messages: RegExp[] = [/subagent rows cannot receive input/, /session is not live/, /session is not live/];

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

  assert.match(stripAnsi(view.render(100).join("\n")), /shortcut unavailable/);
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
  assert.match(prompt, /▌ . api/);
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
  const messages: RegExp[] = [/subagent rows cannot receive input/, /session is not live/, /session is not live/];

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

  assert.match(stripAnsi(view.render(100).join("\n")), /send unavailable/);
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
  const view = new SessionsView(controller, () => {});

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
  const view = new SessionsView(controller, () => {}, { now: () => now });
  view.handleInput("r");
  now = 2_200;
  assert.match(view.render(100).join("\n"), /Restart session/);
});

test("restart dialog supports restart all", () => {
  let restartedAll = false;
  const controller = new SessionsController({ version: 1, sessions: [session("api", "api"), session("docs", "docs")] });
  const view = new SessionsView(controller, () => {}, { restartAll: () => { restartedAll = true; } });

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
    const view = new SessionsView(controller, () => {});
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
