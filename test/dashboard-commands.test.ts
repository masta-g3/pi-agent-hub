import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSession } from "../src/core/types.js";
import {
  buildDashboardCommands,
  commandForKey,
  searchDashboardCommands,
  type DashboardCommandCapabilities,
} from "../src/tui/dashboard-commands.js";

function session(id: string, values: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id, title: `Session ${id}`, cwd: `/repo/${id}`, group: "default", tmuxSession: `tmux-${id}`,
    status: "running", createdAt: 1, updatedAt: 1, ...values,
  };
}

const allCapabilities: DashboardCommandCapabilities = {
  openSession: true, restart: true, deleteSession: true, finishWorktree: true,
  forkSession: true, renameSession: true, syncPiName: true, sendMessage: true, runConfiguredShortcut: true,
  skills: true, mcp: true, theme: true,
  resetSidePane: true, assignSidePane: true, closeSidePane: true, focusSidePane: true,
  acknowledge: true,
};

test("catalog has deterministic group order, target-bound IDs, and all direct aliases", () => {
  const selected = session("alpha");
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities });
  assert.deepEqual([...new Set(commands.map((command) => command.group))], ["actions", "sessions", "filters", "views"]);
  assert.equal(new Set(commands.map((command) => command.id)).size, commands.length);
  assert.equal(commands.find((command) => command.label === "Rename…")?.id, "action:alpha:rename");
  assert.equal(commands.find((command) => command.label === "Rename…")?.targetSessionId, "alpha");
  assert.deepEqual(commands.find((command) => command.label === "Rename…")?.bindings.map((binding) => binding.key), ["R", "e"]);
  assert.deepEqual(commands.find((command) => command.label === "Sync Pi name")?.bindings.map((binding) => binding.key), ["N", "M-n"]);
  assert.deepEqual(commands.find((command) => command.label === "Open")?.bindings.map((binding) => binding.key), ["Enter", "C-m", "C-j"]);
  assert.equal(commandForKey(commands, "e")?.id, "action:alpha:rename");
  assert.equal(commandForKey(commands, "\r")?.id, "action:alpha:open");
  const catalogBindings = new Set(commands.flatMap((command) => command.bindings.map((binding) => binding.key)));
  for (const binding of [
    "Enter", "C-m", "C-j", "r", "p", "R", "e", "N", "M-n", "f", "g", "G", "A", "B", "U",
    "d", "w", "s", "m", "o", "1", "2", "3", "4", "i", "a", "K", "Shift+Up", "J", "Shift+Down",
    "/", "n", "F", "x", "t", "v", "S", ":", "?", "q",
  ]) assert.ok(catalogBindings.has(binding), `missing binding ${binding}`);
});

test("selected action availability mirrors row and capability guards with reasons", () => {
  const stopped = session("stopped", { status: "stopped" });
  const commands = buildDashboardCommands({ sessions: [stopped], selectedId: stopped.id, capabilities: {} });
  const byLabel = (label: string) => commands.find((command) => command.label === label)!;
  assert.deepEqual([byLabel("Open").enabled, byLabel("Open").disabledReason], [false, "restart transport unavailable"]);
  assert.deepEqual([byLabel("Rename…").enabled, byLabel("Rename…").disabledReason], [false, "restart the Pi session before renaming"]);
  assert.deepEqual([byLabel("Send text…").enabled, byLabel("Send text…").disabledReason], [false, "session is not live"]);
  assert.deepEqual([byLabel("Finish worktree…").enabled, byLabel("Finish worktree…").disabledReason], [false, "no Hub-owned worktree"]);

  const child = session("child", { kind: "subagent", parentId: "owner" });
  const childCommands = buildDashboardCommands({ sessions: [child], selectedId: child.id, capabilities: allCapabilities });
  assert.equal(childCommands.find((command) => command.label === "Fork…")?.disabledReason, "unavailable for subagents");
  assert.equal(childCommands.find((command) => command.label === "Restart choices…")?.disabledReason, "unavailable for subagents");
});

test("no selection keeps global, filter, and view commands without target actions", () => {
  const commands = buildDashboardCommands({ sessions: [], capabilities: allCapabilities });
  assert.equal(commands.some((command) => command.targetSessionId), false);
  assert.ok(commands.some((command) => command.id === "action:new"));
  assert.ok(commands.some((command) => command.id === "filter:open"));
  assert.ok(commands.some((command) => command.id === "view:help"));
});

test("configured shortcuts bind the exact session and preserve validated order", () => {
  const selected = session("alpha");
  const commands = buildDashboardCommands({
    sessions: [selected], selectedId: selected.id, capabilities: allCapabilities,
    configuredShortcuts: [{ key: "C-x", label: "Summarize", send: "/summary" }, { key: "!", send: "/urgent" }],
  });
  const configured = commands.filter((command) => command.id.startsWith("shortcut:"));
  assert.deepEqual(configured.map((command) => command.id), ["shortcut:alpha:0:C-x", "shortcut:alpha:1:!"]);
  assert.deepEqual(configured.map((command) => command.label), ["Summarize", "/urgent"]);
  assert.equal(commandForKey(commands, "\u0018")?.id, "shortcut:alpha:0:C-x");

  const stopped = buildDashboardCommands({ sessions: [{ ...selected, status: "error" }], selectedId: selected.id, capabilities: allCapabilities, configuredShortcuts: [{ key: "!", send: "/urgent" }] });
  assert.equal(stopped.find((command) => command.id.startsWith("shortcut:"))?.disabledReason, "session is not live");
});

test("session search composes bounded matchesFilter context and preserves fleet order", () => {
  const previewOnly = session("preview", { title: "Plain", resultSummary: "secret pane output" });
  const rich = session("rich", {
    title: "Builder", cwd: "/code/widget-api", additionalCwds: ["/code/docs-site"], group: "Release",
    status: "waiting", bucket: "backlog", taskPreview: "audit tokenizer",
    context: { version: 1, updatedAt: 2, ticket: { id: "cockpit-42", subtitle: "Intent search", description: "Find bounded metadata" }, attention: { kind: "question", text: "Which release?" } },
    workflow: { steps: [{ id: "execute", short: "EX" }], activeIndex: 0, updatedAt: 2, activity: { id: "compile", label: "Compiling catalog" }, plan: { nextStep: "Run focused tests" } },
  });
  const commands = buildDashboardCommands({ sessions: [previewOnly, rich], selectedId: rich.id, capabilities: allCapabilities });
  for (const query of ["builder", "release", "widget-api", "docs-site", "audit tokenizer", "cockpit-42", "intent search", "bounded metadata", "which release", "compiling catalog", "backlog", "waiting", "focused tests"]) {
    assert.deepEqual(searchDashboardCommands(commands, query).filter((command) => command.group === "sessions").map((command) => command.id), ["session:rich"], query);
  }
  assert.deepEqual(searchDashboardCommands(commands, "secret pane").filter((command) => command.group === "sessions"), []);
  assert.deepEqual(searchDashboardCommands(commands, "plain").filter((command) => command.group === "sessions").map((command) => command.id), ["session:preview"]);
});

test("named filters include lifecycle, status, and sorted current groups", () => {
  const commands = buildDashboardCommands({ sessions: [session("b", { group: "Zulu" }), session("a", { group: "alpha" })] });
  assert.deepEqual(commands.filter((command) => command.group === "filters").map((command) => command.id), [
    "filter:open", "filter:clear", "filter:lifecycle:active", "filter:lifecycle:backlog", "filter:lifecycle:archived",
    "filter:status:starting", "filter:status:running", "filter:status:waiting", "filter:status:idle", "filter:status:error", "filter:status:stopped",
    "filter:group:alpha", "filter:group:Zulu",
  ]);
});
