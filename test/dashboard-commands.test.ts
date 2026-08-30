import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSession } from "../src/core/types.js";
import {
  buildDashboardCommands,
  commandForKey,
  searchDashboardCommands,
  selectWorkspaceCommands,
  pinnedDashboardFooter,
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
  assert.deepEqual(commands.find((command) => command.label === "Open")?.bindings.map((binding) => binding.key), ["Enter", "C-m", "C-j"]);
  assert.equal(commandForKey(commands, "e")?.id, "action:alpha:rename");
  assert.equal(commandForKey(commands, "F")?.id, "action:alpha:fork-compact");
  assert.equal(commandForKey(commands, "\r")?.id, "action:alpha:open");
  const catalogBindings = new Set(commands.flatMap((command) => command.bindings.map((binding) => binding.key)));
  for (const binding of [
    "Enter", "C-m", "C-j", "r", "p", "R", "e", "N", "M-n", "f", "F", "g", "G", "A", "B", "U",
    "d", "w", "s", "m", "P", "1", "2", "3", "4", "x", "+", "-", "i", "a", "K", "Shift+Up", "J", "Shift+Down",
    "/", "n", "t", "S", ":", "?", "q", "M-1", "M-2", "M-3", "M-4",
  ]) assert.ok(catalogBindings.has(binding), `missing binding ${binding}`);
  assert.equal(commands.some((command) => command.id === "view:density"), false);
  assert.equal(catalogBindings.has("v"), false);
});

test("pinned footer is derived from catalog-owned action metadata", () => {
  assert.equal(pinnedDashboardFooter(42), "1–4 Slot · x Close · Ctrl+Q · : · ?");
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
  assert.equal(commands(emptyPinState).find((item) => item.id === "action:alpha:slot-3")?.disabledReason, "slot 3 needs 160 columns");
});

test("selected action availability mirrors row and capability guards with reasons", () => {
  const stopped = session("stopped", { status: "stopped" });
  const commands = buildDashboardCommands({ sessions: [stopped], selectedId: stopped.id, capabilities: {} });
  const byLabel = (label: string) => commands.find((command) => command.label === label)!;
  assert.deepEqual([byLabel("Restart").enabled, byLabel("Restart").disabledReason], [false, "restart transport unavailable"]);
  assert.deepEqual([byLabel("Rename…").enabled, byLabel("Rename…").disabledReason], [false, "restart the Pi session before renaming"]);
  assert.deepEqual([byLabel("Send text…").enabled, byLabel("Send text…").disabledReason], [false, "session is not live"]);
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

test("ordinary idle rows remain non-acknowledgeable without an active request", () => {
  const selected = session("idle", { status: "idle", context: { version: 1, updatedAt: 20, attention: { requestId: "req", kind: "ready", text: "Review" } } });
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
    configuredShortcuts: [{ key: "C-x", label: "Summarize", send: "/summary" }, { key: "!", send: "/urgent" }, { key: "v", send: "/verify" }],
  });
  const configured = commands.filter((command) => command.id.startsWith("shortcut:"));
  assert.deepEqual(configured.map((command) => command.id), ["shortcut:alpha:0:C-x", "shortcut:alpha:1:!", "shortcut:alpha:2:v"]);
  assert.deepEqual(configured.map((command) => command.label), ["Summarize", "/urgent", "/verify"]);
  assert.equal(commandForKey(commands, "\u0018")?.id, "shortcut:alpha:0:C-x");
  assert.equal(commandForKey(commands, "v")?.id, "shortcut:alpha:2:v");

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

test("workspace selection keeps guidance exceptional and aligns the primary action", () => {
  const cases: Array<{
    name: string;
    values: Partial<RuntimeSession>;
    guidance?: string;
    actions: string[];
    primaryLabel: string;
  }> = [
    { name: "question", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "question", text: "Which release?" } } }, guidance: "Answer in the Pi session.", actions: ["open", "mark-read"], primaryLabel: "Answer" },
    { name: "ready", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "ready", text: "Review the result" } } }, guidance: "Review the completed result.", actions: ["open", "send", "mark-read"], primaryLabel: "Open" },
    { name: "blocked", values: { status: "waiting", context: { version: 1, updatedAt: 2, attention: { kind: "blocked", text: "Need access" } } }, guidance: "Resolve the reported blocker.", actions: ["send", "open", "mark-read"], primaryLabel: "Send text…" },
    { name: "error", values: { status: "error" }, guidance: "Check Details before restarting.", actions: ["info", "open"], primaryLabel: "Details" },
    { name: "stopped", values: { status: "stopped", bucket: "backlog" }, guidance: "Restart to continue.", actions: ["open", "restore"], primaryLabel: "Restart" },
    { name: "subagent", values: { kind: "subagent", parentId: "owner", status: "idle" }, actions: ["open", "info"], primaryLabel: "Open" },
    { name: "archived", values: { bucket: "archived", status: "idle" }, actions: ["open", "restore", "delete"], primaryLabel: "Open" },
    { name: "backlog", values: { bucket: "backlog", status: "idle" }, actions: ["open", "restore", "archive"], primaryLabel: "Open" },
    { name: "idle", values: { status: "idle" }, actions: ["open", "send", "archive"], primaryLabel: "Open" },
    { name: "active", values: { status: "running" }, actions: ["open", "pin"], primaryLabel: "Open" },
  ];

  for (const item of cases) {
    const selected = session(item.name, item.values);
    const commands = buildDashboardCommands({ sessions: [selected], selectedId: selected.id, capabilities: allCapabilities, pinState: emptyPinState });
    const workspace = selectWorkspaceCommands(selected, commands, 3);
    assert.equal(workspace.guidance, item.guidance, item.name);
    assert.deepEqual(workspace.actions.map((command) => command.id), item.actions.map((name) => `action:${selected.id}:${name}`), item.name);
    assert.equal(workspace.actions[0]?.label, item.primaryLabel, item.name);
    assert.equal(workspace.moreCommand.id, "view:palette", item.name);
    assert.equal(workspace.moreCommand.displayKey, ":", item.name);
  }
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
  assert.equal(workspace.guidance, "Answer in the Pi session.");
  assert.equal(open.label, "Answer");
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
    "action:running-attention:open", "action:running-attention:pin",
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
