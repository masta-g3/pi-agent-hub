import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { RuntimeSession } from "../src/core/types.js";
import { validateDashboardShortcuts } from "../src/core/dashboard-shortcuts.js";
import {
  buildDashboardCommands,
  commandForKey,
  searchDashboardCommands,
  selectWorkspaceCommands,
  dashboardFooter,
  pinnedDashboardFooter,
  type DashboardCommand,
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
  pinSidePane: true, assignSidePaneSlot: true, focusSidePaneSlot: true, closeSidePane: true, resizeSidePane: true,
  acknowledge: true, attentionBell: true,
};

const emptyPinState = {
  slots: [undefined, undefined, undefined, undefined] as (string | undefined)[],
  activeSessionId: undefined, count: 0, capacity: 2, constrained: false,
};

test("catalog has deterministic group order, target-bound IDs, and all direct aliases", () => {
  const selected = session("alpha");
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities, pinState: emptyPinState });
  assert.deepEqual([...new Set(commands.map((command) => command.group))], ["actions", "sessions", "filters", "views"]);
  assert.equal(new Set(commands.map((command) => command.id)).size, commands.length);
  assert.equal(commands.find((command) => command.label === "Rename…")?.id, "action:alpha:rename");
  assert.equal(commands.find((command) => command.label === "Rename…")?.targetSessionId, "alpha");
  assert.deepEqual(commands.find((command) => command.label === "Rename…")?.bindings.map((binding) => binding.key), ["R", "e"]);
  assert.deepEqual(commands.find((command) => command.label === "Sync Pi name")?.bindings.map((binding) => binding.key), ["N", "M-n"]);
  assert.deepEqual(commands.find((command) => command.label === "Open in Pi")?.bindings.map((binding) => binding.key), ["Enter", "C-m", "C-j"]);
  assert.equal(commandForKey(commands, "e")?.id, "action:alpha:rename");
  assert.equal(commandForKey(commands, "F")?.id, "action:alpha:fork-compact");
  assert.equal(commandForKey(commands, "\r")?.id, "action:alpha:open");
  const catalogBindings = new Set(commands.flatMap((command) => command.bindings.map((binding) => binding.key)));
  for (const binding of [
    "Enter", "C-m", "C-j", "r", "p", "R", "e", "N", "M-n", "f", "F", "g", "G", "A", "B", "b", "U",
    "d", "w", "s", "m", "P", "1", "2", "3", "4", "x", "+", "-", "i", "a", "K", "Shift+Up", "J", "Shift+Down",
    "/", "n", "t", "v", "S", ":", "?", "q", "M-1", "M-2", "M-3", "M-4",
  ]) assert.ok(catalogBindings.has(binding), `missing binding ${binding}`);
  assert.equal(commands.some((command) => command.id === "view:density"), false);
});

test("Backlog visibility is a catalog-owned toggle distinct from moving a session", () => {
  const selected = session("alpha");
  const hidden = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, filter: "release", capabilities: allCapabilities });
  const shown = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, filter: "lifecycle:active,archived release", capabilities: allCapabilities });
  assert.equal(hidden.find((command) => command.id === "view:backlog")?.label, "Hide backlog");
  assert.equal(shown.find((command) => command.id === "view:backlog")?.label, "Show backlog");
  assert.equal(buildDashboardCommands({ sessions: [selected], selectedId: selected.id, filter: "lifecycle:active,backlog release", capabilities: allCapabilities }).find((command) => command.id === "view:backlog")?.label, "Hide backlog");
  assert.equal(buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities }).find((command) => command.id === "action:alpha:backlog")?.displayKey, "B");
});

test("footer keeps request navigation and palette first at every width", () => {
  for (const width of [61, 80, 99, 100, 119, 120, 160]) {
    for (const requestCount of [0, 1]) {
      const footer = dashboardFooter(width, { requestCount });
      assert.match(footer, /^\] Next request · p Reply · : All actions · \? Help/);
      assert.doesNotMatch(footer, /Enter|Workspace/);
      assert.ok(visibleWidth(footer) <= width - 2, `${width}: ${footer}`);
    }
  }
});

test("footer uses stable Backlog text while catalog labels stay contextual", () => {
  assert.match(dashboardFooter(160), /b Backlog/);
  assert.match(dashboardFooter(160, { filter: "lifecycle:active,archived" }), /b Backlog/);
});

test("phone request hint keeps the existing tap-target order and only uses spare space", () => {
  assert.equal(dashboardFooter(44, { requestCount: 1 }), dashboardFooter(44));
  assert.equal(dashboardFooter(60, { requestCount: 1 }), "] Next request · p Reply · : All actions · ? Help");
});

test("configured shortcuts cannot shadow lowercase Backlog visibility", () => {
  assert.throws(() => validateDashboardShortcuts([{ key: "b", send: "status" }]), /conflicts with a built-in/);
});

test("coaching does not replace the stable inbox footer", () => {
  for (const width of [30, 40, 60, 80, 120, 160]) assert.equal(dashboardFooter(width, { coaching: true }), dashboardFooter(width));
  assert.equal(dashboardFooter(30), "] Next · p Reply · : Actions");
});

test("coaching retains truthful workspace and request hints", () => {
  for (const width of [61, 80, 100, 160]) {
    const footer = dashboardFooter(width, { coaching: true, requestCount: 1 });
    assert.match(footer, /^\] Next request · p Reply · : All actions · \? Help/);
    assert.ok(visibleWidth(footer) <= width - 2, `${width}: ${footer}`);
  }
});

test("pinned footer is derived from catalog-owned action metadata", () => {
  assert.equal(pinnedDashboardFooter(42), "x Close · : Actions · ? Help");
  assert.equal(pinnedDashboardFooter(80), "1–4 Assign · Alt+1–4 Focus · x Close · Ctrl+Q Return · : · ?");
  assert.equal(pinnedDashboardFooter(120), "1–4 Assign · Alt+1–4 Focus · P Next · x Close · Ctrl+Q Return · : Actions · ? Help");
});

test("pin commands use target-bound identity, dynamic labels, and exact availability reasons", () => {
  const selected = session("alpha");
  const command = (values: Parameters<typeof buildDashboardCommands>[0], name: string) =>
    buildDashboardCommands(values).find((item) => item.id === `action:alpha:${name}`)!;
  const input = { sessions: [selected], selectedId: selected.id, capabilities: allCapabilities };

  assert.deepEqual([command({ ...input, pinState: emptyPinState }, "pin").label, command({ ...input, pinState: emptyPinState }, "pin").enabled], ["Pin next free slot", true]);
  const pinned = { slots: [selected.id, undefined, undefined, undefined], activeSessionId: selected.id, count: 1, capacity: 2, constrained: false };
  assert.deepEqual([command({ ...input, pinState: pinned }, "pin").label, command({ ...input, pinState: pinned }, "pin").enabled], ["Focus slot 1", true]);
  assert.equal(command({ ...input, pinState: pinned }, "close-pin").enabled, true);
  assert.equal(command({ ...input, pinState: emptyPinState }, "close-pin").disabledReason, "session is not pinned");
  assert.equal(command({ ...input, pinState: { ...emptyPinState, capacity: 0 } }, "pin").disabledReason, "pinning needs 100 columns; use Enter instead");
  assert.equal(command({ ...input, pinState: { ...emptyPinState, slots: ["one", "two", undefined, undefined], count: 2 } }, "pin").disabledReason, "a third pin needs 160 columns; close a pin or use Enter instead");
  assert.equal(command({ ...input, pinState: { ...emptyPinState, capacity: 4, slots: ["1", "2", "3", "4"], count: 4 } }, "pin").disabledReason, "4 sessions are already pinned; close a pin or use Enter instead");
  assert.equal(command({ ...input, pinState: { ...emptyPinState, constrained: true } }, "pin").disabledReason, "pin layout is constrained; widen the dashboard or close a pin");
  assert.equal(command({ ...input, pinState: emptyPinState }, "size-increase").disabledReason, "pin at least two sessions to resize");
  const pair = { slots: [selected.id, "two", undefined, undefined], activeSessionId: selected.id, count: 2, capacity: 2, constrained: false };
  assert.equal(command({ ...input, pinState: pair }, "size-increase").enabled, true);
  assert.equal(command({ ...input, pinState: { ...pair, constrained: true } }, "size-increase").disabledReason, "pin layout is constrained; widen the dashboard before resizing");
  assert.equal(command({ ...input, pinState: pair, capabilities: { ...allCapabilities, resizeSidePane: false } }, "size-decrease").disabledReason, "resize transport unavailable");
  assert.equal(command({ ...input, pinState: emptyPinState, capabilities: { ...allCapabilities, pinSidePane: false } }, "pin").disabledReason, "pin transport unavailable");
  assert.equal(command({ ...input, sessions: [session("alpha", { status: "stopped" })], pinState: emptyPinState }, "pin").disabledReason, "session is not live");
  assert.equal(command({ ...input, pinState: pinned, capabilities: { ...allCapabilities, closeSidePane: false } }, "close-pin").disabledReason, "close pin transport unavailable");
});

test("slot commands assign exact free destinations and name occupied conflicts", () => {
  const alpha = session("alpha");
  const beta = session("beta", { title: "API" });
  const commands = (pinState: typeof emptyPinState) => buildDashboardCommands({ sessions: [alpha, beta], selectedId: alpha.id, capabilities: allCapabilities, pinState });
  assert.equal(commands(emptyPinState).find((item) => item.id === "action:alpha:slot-1")?.enabled, true);
  assert.equal(commandForKey(commands(emptyPinState), "1")?.id, "action:alpha:slot-1");
  const occupied = { ...emptyPinState, slots: ["beta", undefined, undefined, undefined], count: 1 };
  const slot1 = commands(occupied).find((item) => item.id === "action:alpha:slot-1")!;
  assert.equal(slot1.enabled, false);
  assert.equal(slot1.disabledReason, "Slot 1 contains API; close it first");
  assert.equal(commandForKey(commands(occupied), "\u001b1")?.id, "view:focus-slot-1");
  assert.equal(commands(occupied).find((item) => item.id === "view:focus-slot-2")?.disabledReason, "slot 2 is empty");
  assert.equal(commands(occupied).find((item) => item.id === "action:alpha:slot-3")?.enabled, true);
  const full = { ...emptyPinState, slots: ["beta", undefined, "gamma", undefined], count: 2 };
  assert.equal(commands(full).find((item) => item.id === "action:alpha:slot-4")?.disabledReason, "a third pin needs 160 columns; close a pin or use Enter instead");
});

test("linked ticket context disables manual rename with the naming owner reason", () => {
  const linked = session("linked", {
    context: { version: 1, updatedAt: 2, ticket: { id: "naming-001", subtitle: "Stable ticket names" } },
  });
  const rename = buildDashboardCommands({ sessions: [linked], selectedId: linked.id, capabilities: allCapabilities })
    .find((command) => command.id === "action:linked:rename");

  assert.equal(rename?.enabled, false);
  assert.equal(rename?.disabledReason, "linked ticket owns the session name");
});

test("selected action availability mirrors row and capability guards with reasons", () => {
  const stopped = session("stopped", { status: "stopped" });
  const commands = buildDashboardCommands({ sessions: [stopped], selectedId: stopped.id, capabilities: {} });
  const byLabel = (label: string) => commands.find((command) => command.label === label)!;
  assert.deepEqual([byLabel("Restart").enabled, byLabel("Restart").disabledReason], [false, "restart transport unavailable"]);
  assert.deepEqual([byLabel("Rename…").enabled, byLabel("Rename…").disabledReason], [false, "restart the Pi session before renaming"]);
  assert.deepEqual([byLabel("Reply").enabled, byLabel("Reply").disabledReason], [false, "session is not live"]);
  assert.deepEqual([byLabel("Finish worktree…").enabled, byLabel("Finish worktree…").disabledReason], [false, "no Hub-owned worktree"]);

  const child = session("child", { kind: "subagent", parentId: "owner" });
  const childCommands = buildDashboardCommands({ sessions: [child], selectedId: child.id, capabilities: allCapabilities });
  assert.equal(childCommands.find((command) => command.label === "Fork…")?.disabledReason, "unavailable for subagents");
  assert.equal(childCommands.find((command) => command.label === "Restart choices…")?.disabledReason, "unavailable for subagents");
});

test("attention view commands are exact, unbound, and stateful", () => {
  const selected = session("alpha", { status: "idle", acknowledgedAt: 10, context: { version: 1, updatedAt: 20, attention: { requestId: "req/1", kind: "question", text: "Choose" } } });
  const commands = buildDashboardCommands({
    sessions: [selected], selectedId: selected.id, capabilities: allCapabilities,
    attentionRequests: [{ sessionId: "alpha", requestId: "req/1" }], attentionBellEnabled: false,
  });
  const locate = commands.find((command) => command.id.startsWith("view:locate-attention:"))!;
  assert.equal(locate.id, "view:locate-attention:alpha:req%2F1");
  assert.equal(locate.targetSessionId, "alpha");
  assert.equal(locate.attentionRequestId, "req/1");
  assert.deepEqual(locate.bindings, []);
  assert.equal(locate.enabled, true);
  assert.equal(commands.find((command) => command.id === "action:alpha:mark-read")?.enabled, true);

  const bell = commands.find((command) => command.id === "view:attention-bell")!;
  assert.equal(bell.label, "Attention bell: Off");
  assert.match(bell.hint, /turn on/);
  assert.deepEqual(bell.bindings, []);
  assert.equal(commandForKey(commands, "a")?.id, "action:alpha:mark-read");
  assert.equal(commandForKey(commands, "\r")?.id, "action:alpha:open");

  const selectionBlocked = buildDashboardCommands({
    sessions: [selected],
    capabilities: allCapabilities,
    attentionRequests: [{ sessionId: "alpha", requestId: "req/1" }],
    interactionBlockedReason: "select a visible session first",
  });
  assert.equal(selectionBlocked.find((command) => command.id.startsWith("view:locate-attention:"))?.enabled, true);
  assert.equal(selectionBlocked.find((command) => command.id === "view:attention-bell")?.enabled, true);
  assert.equal(selectionBlocked.some((command) => command.id === "action:alpha:mark-read"), false);

  const on = buildDashboardCommands({ sessions: [selected], capabilities: allCapabilities, attentionBellEnabled: true });
  assert.equal(on.find((command) => command.id === "view:attention-bell")?.label, "Attention bell: On");
  assert.match(on.find((command) => command.id === "view:attention-bell")?.hint ?? "", /turn off/);
  assert.equal(on.some((command) => command.id.startsWith("view:locate-attention:")), false);
});

test("unread idle attention remains acknowledgeable without a live announcement", () => {
  const selected = session("idle-request", {
    status: "idle",
    context: { version: 1, updatedAt: 2, attention: { requestId: "req-idle", kind: "ready", text: "Review result" } },
  });
  const command = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities })
    .find((item) => item.id === "action:idle-request:mark-read");
  assert.equal(command?.enabled, true);
});

test("ordinary idle rows remain non-acknowledgeable without an active request", () => {
  const selected = session("idle", { status: "idle" });
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities });
  assert.equal(commands.find((command) => command.id === "action:idle:mark-read")?.enabled, false);
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
    configuredShortcuts: [{ key: "C-x", label: "Summarize", send: "/summary" }, { key: "!", send: "/urgent" }, { key: "z", send: "/verify" }],
  });
  const configured = commands.filter((command) => command.id.startsWith("shortcut:"));
  assert.deepEqual(configured.map((command) => command.id), ["shortcut:alpha:0:C-x", "shortcut:alpha:1:!", "shortcut:alpha:2:z"]);
  assert.deepEqual(configured.map((command) => command.label), ["Summarize", "/urgent", "/verify"]);
  assert.equal(commandForKey(commands, "\u0018")?.id, "shortcut:alpha:0:C-x");
  assert.equal(commandForKey(commands, "z")?.id, "shortcut:alpha:2:z");

  const stopped = buildDashboardCommands({ sessions: [{ ...selected, status: "error" }], selectedId: selected.id, capabilities: allCapabilities, configuredShortcuts: [{ key: "!", send: "/urgent" }] });
  assert.equal(stopped.find((command) => command.id.startsWith("shortcut:"))?.disabledReason, "session is not live");
});

test("fleet grouping command uses v and is disabled on the workflow board", () => {
  const fleet = buildDashboardCommands({ sessions: [], grouping: "project", fleetGrouping: "status" });
  const toggle = fleet.find((command) => command.id === "view:fleet-grouping");
  assert.equal(toggle?.displayKey, "v");
  assert.equal(toggle?.label, "Group fleet by repo");
  assert.equal(toggle?.enabled, true);
  assert.equal(commandForKey(fleet, "v")?.id, "view:fleet-grouping");

  const repo = buildDashboardCommands({ sessions: [], grouping: "project", fleetGrouping: "repo" });
  assert.equal(repo.find((command) => command.id === "view:fleet-grouping")?.label, "Group fleet by status");

  const board = buildDashboardCommands({ sessions: [], grouping: "stage", fleetGrouping: "repo" });
  const disabled = board.find((command) => command.id === "view:fleet-grouping");
  assert.equal(disabled?.enabled, false);
  assert.equal(disabled?.disabledReason, "return to the fleet first");
});

test("repo fleet disables manual session reorder", () => {
  const selected = session("alpha");
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, grouping: "project", fleetGrouping: "repo" });
  assert.equal(commands.find((command) => command.id === "action:alpha:reorder-up")?.disabledReason, "switch to Status grouping to reorder");
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

test("workspace selection keeps guidance exceptional and aligns the primary action", () => {
  const cases: Array<{
    name: string;
    values: Partial<RuntimeSession>;
    guidance?: string;
    actions: string[];
    primaryLabel: string;
  }> = [
    { name: "question", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "question", text: "Which release?" } } }, actions: ["open", "mark-read"], primaryLabel: "Open in Pi" },
    { name: "ready", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "ready", text: "Review the result" } } }, actions: ["open", "send", "mark-read"], primaryLabel: "Open in Pi" },
    { name: "blocked", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "blocked", text: "Need access" } } }, actions: ["send", "open", "mark-read"], primaryLabel: "Reply" },
    { name: "error", values: { status: "error" }, guidance: "Check Details before restarting.", actions: ["info", "open", "archive"], primaryLabel: "Details" },
    { name: "stopped", values: { status: "stopped", bucket: "backlog" }, guidance: "Restart to continue.", actions: ["open", "restore", "archive"], primaryLabel: "Restart" },
    { name: "subagent", values: { kind: "subagent", parentId: "owner", status: "idle" }, actions: ["open", "info"], primaryLabel: "Open in Pi" },
    { name: "archived", values: { bucket: "archived", status: "idle" }, actions: ["open", "archive", "restore"], primaryLabel: "Open in Pi" },
    { name: "backlog", values: { bucket: "backlog", status: "idle" }, actions: ["open", "restore", "archive"], primaryLabel: "Open in Pi" },
    { name: "idle", values: { status: "idle" }, actions: ["open", "send", "archive"], primaryLabel: "Open in Pi" },
    { name: "active", values: { status: "running" }, actions: ["open", "pin", "archive"], primaryLabel: "Open in Pi" },
    { name: "closed-stopped", values: { status: "stopped", closure: "done", bucket: "archived" }, actions: ["restore", "open", "delete"], primaryLabel: "Reopen" },
    { name: "closed-running", values: { status: "running", closure: "abandoned", bucket: "archived" }, actions: ["restore", "open", "delete"], primaryLabel: "Reopen" },
    { name: "closed-question", values: { status: "waiting", closure: "done", bucket: "archived", context: { version: 1, updatedAt: 2, attention: { kind: "question", text: "Which release?" } } }, actions: ["open", "restore", "mark-read"], primaryLabel: "Open in Pi" },
    { name: "closed-error", values: { status: "error", closure: "done", bucket: "archived" }, guidance: "Check Details before restarting.", actions: ["info", "restore", "open"], primaryLabel: "Details" },
  ];

  for (const item of cases) {
    const selected = session(item.name, { piSessionId: "pi", interaction: { version: 1, instanceId: "instance" }, ...item.values });
    const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities, pinState: emptyPinState,
      interactionState: { questionProtocol: false, pending: [], messageDelivery: "idle" },
    });
    const workspace = selectWorkspaceCommands(selected, commands, 3);
    assert.equal(workspace.guidance, item.guidance, item.name);
    assert.deepEqual(workspace.actions.map((command) => command.id), item.actions.map((name) => `action:${selected.id}:${name}`), item.name);
    assert.equal(workspace.actions[0]?.label, item.primaryLabel, item.name);
    assert.equal(workspace.moreCommand.id, "view:palette", item.name);
    assert.equal(workspace.moreCommand.displayKey, ":", item.name);
  }
});

test("configured shortcuts cannot claim any built-in catalog key", () => {
  const selected = session("keys", { status: "idle" });
  const keys = new Set(buildDashboardCommands({ sessions: [selected], selectedId: selected.id }).flatMap((command) => command.bindings.map((binding) => binding.key)));
  for (const key of keys) assert.throws(() => validateDashboardShortcuts([{ key, send: "x" }]), /conflicts/, key);
});

test("copy path binds the exact handoff evidence and replaces mark read in the workspace", () => {
  const attention = { requestId: "req-1", kind: "ready" as const, text: "Review", artifact: "/tmp/agent work/v.md" };
  const build = (values: Partial<RuntimeSession>, capabilities: DashboardCommandCapabilities = { ...allCapabilities, copyPath: true }) => {
    const selected = session("handoff", { status: "idle", piSessionId: "pi", interaction: { version: 1, instanceId: "instance" }, context: { version: 1, updatedAt: 2, attention }, ...values });
    const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities, pinState: emptyPinState,
      interactionState: { questionProtocol: false, pending: [], messageDelivery: "idle" } });
    return { selected, commands, copy: commands.find((command) => command.id.startsWith("action:handoff:copy-path")) };
  };
  const ready = build({});
  assert.equal(ready.copy?.id, "action:handoff:copy-path:req-1");
  assert.equal(ready.copy?.enabled, true);
  assert.equal(ready.copy?.displayKey, "y");
  assert.equal(commandForKey(ready.commands, "y")?.id, ready.copy?.id);
  assert.deepEqual(selectWorkspaceCommands(ready.selected, ready.commands, 3).actions.map((command) => command.id),
    ["action:handoff:open", "action:handoff:send", "action:handoff:copy-path:req-1"]);
  const blocked = build({ context: { version: 1, updatedAt: 2, attention: { ...attention, kind: "blocked" } } });
  assert.deepEqual(selectWorkspaceCommands(blocked.selected, blocked.commands, 3).actions.map((command) => command.id),
    ["action:handoff:send", "action:handoff:open", "action:handoff:copy-path:req-1"]);

  for (const values of [
    { status: "running" as const },
    { context: { version: 1 as const, updatedAt: 2, attention: { ...attention, artifact: undefined } } },
  ]) assert.equal(build(values).copy?.enabled, false);
  assert.equal(build({}, allCapabilities).copy?.enabled, false);
  assert.throws(() => validateDashboardShortcuts([{ key: "y", send: "hello" }]), /conflicts/);
});

test("workspace selection reuses exact enabled descriptors and respects the action cap", () => {
  const selected = session("exact", { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "question", text: "Choose" } } });
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: { ...allCapabilities, sendMessage: false } });
  const workspace = selectWorkspaceCommands(selected, commands, 2);
  const open = commands.find((command) => command.id === "action:exact:open")!;
  const markRead = commands.find((command) => command.id === "action:exact:mark-read")!;
  const palette = commands.find((command) => command.id === "view:palette")!;

  assert.deepEqual(workspace.actions, [open, markRead]);
  assert.strictEqual(workspace.actions[0], open);
  assert.strictEqual(workspace.moreCommand, palette);
  assert.ok(workspace.actions.every((command) => command.enabled && command.targetSessionId === selected.id));
  assert.equal(workspace.actions.some((command) => command.id === "action:exact:send"), false);
  assert.equal(workspace.guidance, undefined);
  assert.equal(open.label, "Open in Pi");
  assert.equal(open.hint, "focus the real Pi questionnaire");
  assert.deepEqual(
    workspace.actions.map(({ label, displayKey, hint, enabled }) => ({ label, displayKey, hint, enabled })),
    [open, markRead].map(({ label, displayKey, hint, enabled }) => ({ label, displayKey, hint, enabled })),
  );
  assert.deepEqual(selectWorkspaceCommands(selected, commands, 0).actions, []);

  const blocked = session("blocked-no-send", { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "blocked", text: "Need access" } } });
  const blockedCommands = buildDashboardCommands({ sessions: [blocked], selectedId: blocked.id, capabilities: { ...allCapabilities, sendMessage: false } });
  const blockedWorkspace = selectWorkspaceCommands(blocked, blockedCommands, 3);
  assert.equal(blockedWorkspace.guidance, undefined);
  assert.equal(blockedWorkspace.actions[0]?.id, "action:blocked-no-send:open");

  const stopped = session("stopped-no-restart", { status: "stopped", bucket: "backlog" });
  const stoppedCommands = buildDashboardCommands({ sessions: [stopped], selectedId: stopped.id, capabilities: {} });
  const stoppedWorkspace = selectWorkspaceCommands(stopped, stoppedCommands, 3);
  assert.equal(stoppedWorkspace.guidance, undefined);
  assert.equal(stoppedWorkspace.actions[0]?.id, "action:stopped-no-restart:restore");
});

test("workspace selection ignores attention outside waiting and idle states", () => {
  const selected = session("running-attention", { status: "running", context: { version: 1, updatedAt: 2, attention: { kind: "question", text: "Old question" } } });
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities, pinState: emptyPinState });
  assert.deepEqual(selectWorkspaceCommands(selected, commands, 3).actions.map((command) => command.id), [
    "action:running-attention:open", "action:running-attention:pin", "action:running-attention:archive",
  ]);
});

test("named filters include lifecycle, status, and sorted current groups", () => {
  const commands = buildDashboardCommands({ sessions: [session("b", { group: "Zulu" }), session("a", { group: "alpha" })] });
  assert.deepEqual(commands.filter((command) => command.group === "filters").map((command) => command.id), [
    "filter:open", "filter:clear", "filter:lifecycle:active", "filter:lifecycle:backlog", "filter:lifecycle:archived",
    "filter:status:starting", "filter:status:running", "filter:status:waiting", "filter:status:idle", "filter:status:error", "filter:status:stopped",
    "filter:group:alpha", "filter:group:Zulu",
  ]);
});

test("A opens Archive for open parents, U is the only Reopen, and C is unbound", () => {
  const open = session("open", { status: "running" });
  const archived = session("archived", { status: "idle", bucket: "archived" });
  const closed = session("closed", { status: "stopped", closure: "done", bucket: "archived" });
  const child = session("child", { kind: "subagent", parentId: "open" });
  const build = (selected: RuntimeSession) => buildDashboardCommands({ sessions: [open, archived, closed, child], selectedId: selected.id, capabilities: allCapabilities, pinState: emptyPinState });
  const reopenOrClose = (commands: DashboardCommand[]) => commands.filter((command) => /:(close|reopen)$/.test(command.id) || command.bindings.some((binding) => binding.key === "C"));

  const openCommands = build(open);
  assert.deepEqual(reopenOrClose(openCommands), []);
  assert.equal(commandForKey(openCommands, "C"), undefined);
  assert.equal(commandForKey(openCommands, "c")?.id, "view:conversation");
  assert.equal(commandForKey(openCommands, "A")?.id, "action:open:archive");
  assert.equal(commandForKey(openCommands, "A")?.label, "Archive…");
  assert.equal(commandForKey(openCommands, "A")?.enabled, true);
  assert.equal(commandForKey(openCommands, "U")?.label, "Restore active");
  assert.equal(commandForKey(openCommands, "U")?.enabled, false);
  assert.ok(searchDashboardCommands(openCommands, "archive").some((command) => command.id === "action:open:archive"));
  assert.ok(searchDashboardCommands(openCommands, "abandoned").some((command) => command.id === "action:open:archive"));

  assert.equal(commandForKey(build(archived), "A")?.enabled, true);

  const closedCommands = build(closed);
  assert.deepEqual(reopenOrClose(closedCommands), []);
  assert.equal(commandForKey(closedCommands, "A")?.enabled, false);
  assert.match(commandForKey(closedCommands, "A")?.disabledReason ?? "", /Reopen/);
  assert.equal(commandForKey(closedCommands, "U")?.id, "action:closed:restore");
  assert.equal(commandForKey(closedCommands, "U")?.label, "Reopen");
  assert.equal(commandForKey(closedCommands, "U")?.enabled, true);
  assert.equal(commandForKey(closedCommands, "B")?.enabled, false);
  assert.match(commandForKey(closedCommands, "B")?.disabledReason ?? "", /Reopen/);
  assert.equal(commandForKey(closedCommands, "d")?.id, "action:closed:delete");
  assert.equal(commandForKey(closedCommands, "a")?.id, "action:closed:mark-read");
  const workspace = selectWorkspaceCommands(closed, closedCommands, 3);
  assert.deepEqual(workspace.actions.filter((command) => command.label === "Reopen").map((command) => command.id), ["action:closed:restore"]);

  const childCommands = build(child);
  assert.equal(commandForKey(childCommands, "A")?.enabled, false);
  assert.match(commandForKey(childCommands, "A")?.disabledReason ?? "", /subagent/);
});
