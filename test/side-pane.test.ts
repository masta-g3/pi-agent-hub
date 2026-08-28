import test from "node:test";
import assert from "node:assert/strict";
import { assignSidePaneSlot, closeSidePaneShowing, closeSidePanes, closeSidePaneSlot, focusSidePaneSlot, quadrantGeometry, resetSidePane, sidebarRepairWidth, sidePaneStatus, type SidePaneSlot } from "../src/app/side-pane.js";
import type { TmuxExec } from "../src/core/tmux.js";
import type { CommandResult } from "../src/core/types.js";

interface Call { command: string; args: string[] }

function fakeTmux(handler: (call: Call) => CommandResult | Promise<CommandResult>): TmuxExec & { calls: Call[] } {
  const calls: Call[] = [];
  return { calls, async exec(command, args) { const call = { command, args }; calls.push(call); return handler(call); } };
}

function sidePaneExec(panes: string, clients: string): TmuxExec & { calls: Call[] } {
  let nextPane = 10;
  return fakeTmux((call) => {
    if (call.args[0] === "list-panes") return { stdout: panes, stderr: "" };
    if (call.args[0] === "list-clients") return { stdout: clients, stderr: "" };
    if (call.args[0] === "split-window") return { stdout: `%${nextPane++}\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  });
}

const listPanesCall = ["list-panes", "-t", "%1", "-F", "#{pane_id}\t#{pane_tty}\t#{pane_active}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}\t#{window_width}\t#{window_height}\t#{@pi_hub_slot}\t#{pane_title}"];
const attach = (direction: "-h" | "-v", pane: string, target: string, size: number) => [
  "split-window", "-d", direction, "-l", String(size), "-P", "-F", "#{pane_id}", "-t", pane,
  `env -u TMUX tmux attach-session -t '${target}'`,
];
const presize = (target: string, width: number, height: number) => ["resize-window", "-t", target, "-x", String(width), "-y", String(height)];
const resetSize = (target: string) => ["set-option", "-w", "-t", target, "window-size", "latest"];
const tag = (pane: string, slot: number) => ["set-option", "-p", "-t", pane, "@pi_hub_slot", String(slot)];

const dashboard = "%1 /dev/ttys001 1 0 0 42 59 160 60 \n";
const pane = (id: number, tty: number, left: number, top: number, width: number, height: number, slot?: number, active = 0) =>
  `%${id} /dev/ttys00${tty} ${active} ${left} ${top} ${width} ${height} 160 60 ${slot ?? ""}\n`;
const clients = (...entries: [number, string][]) => entries.map(([tty, session]) => `/dev/ttys00${tty} ${session}\n`).join("");
const one = dashboard + pane(2, 2, 43, 0, 117, 59, 1);
const pair14 = dashboard + pane(2, 2, 43, 0, 58, 59, 1) + pane(3, 3, 102, 0, 58, 59, 4);
const pair12 = dashboard + pane(2, 2, 43, 0, 58, 59, 1) + pane(3, 3, 102, 0, 58, 59, 2);
const pair13 = dashboard + pane(2, 2, 43, 0, 117, 29, 1) + pane(3, 3, 43, 30, 117, 29, 3);
const sessions12 = clients([2, "pi-agent-hub-api"], [3, "pi-agent-hub-docs"]);

function geometry(slots: SidePaneSlot[]) {
  return Object.fromEntries(quadrantGeometry(new Set(slots), 117, 60, 1));
}

test("quadrantGeometry derives expansion and orientation from occupied slots", () => {
  assert.deepEqual(geometry([1]), { 1: { width: 117, height: 59 } });
  assert.deepEqual(geometry([2]), { 2: { width: 117, height: 59 } });
  assert.deepEqual(geometry([1, 2]), { 1: { width: 58, height: 59 }, 2: { width: 58, height: 59 } });
  assert.deepEqual(geometry([1, 3]), { 1: { width: 117, height: 29 }, 3: { width: 117, height: 29 } });
  assert.deepEqual(geometry([1, 4]), { 1: { width: 58, height: 59 }, 4: { width: 58, height: 59 } });
  assert.deepEqual(geometry([1, 2, 3]), { 1: { width: 58, height: 29 }, 2: { width: 58, height: 59 }, 3: { width: 58, height: 29 } });
  assert.deepEqual(geometry([1, 2, 4]), { 1: { width: 58, height: 59 }, 2: { width: 58, height: 29 }, 4: { width: 58, height: 29 } });
  assert.deepEqual(geometry([1, 3, 4]), { 1: { width: 58, height: 29 }, 3: { width: 58, height: 29 }, 4: { width: 58, height: 59 } });
  assert.deepEqual(geometry([1, 2, 3, 4]), {
    1: { width: 58, height: 29 }, 2: { width: 58, height: 29 },
    3: { width: 58, height: 29 }, 4: { width: 58, height: 29 },
  });
});

test("sidePaneStatus preserves tagged holes and active quadrant", async () => {
  const panes = dashboard + pane(2, 2, 43, 0, 58, 59, 1) + pane(3, 3, 102, 0, 58, 59, 4, 1);
  const status = await sidePaneStatus({ ownPane: "%1" }, sidePaneExec(panes, sessions12));
  assert.deepEqual(status.slots, ["pi-agent-hub-api", undefined, undefined, "pi-agent-hub-docs"]);
  assert.deepEqual(status.paneIds, ["%2", undefined, undefined, "%3"]);
  assert.equal(status.activeSlot, 4);
});

test("untagged and duplicate panes self-heal into lowest free geometry slots", async () => {
  const panes = dashboard + pane(2, 2, 43, 0, 58, 59, 4) + pane(3, 3, 102, 0, 58, 59, 4);
  const exec = sidePaneExec(panes, sessions12);
  const status = await sidePaneStatus({ ownPane: "%1" }, exec);
  assert.deepEqual(status.slots, ["pi-agent-hub-docs", undefined, undefined, "pi-agent-hub-api"]);
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%3", 1))), true);
});

test("sidePaneStatus ignores user panes", async () => {
  const exec = sidePaneExec(dashboard + pane(2, 2, 43, 0, 117, 59, 3) + pane(9, 9, 43, 0, 117, 59), clients([2, "pi-agent-hub-api"], [9, "shell"]));
  assert.deepEqual((await sidePaneStatus({ ownPane: "%1" }, exec)).slots, [undefined, undefined, "pi-agent-hub-api", undefined]);
  assert.deepEqual(exec.calls[0]?.args, listPanesCall);
});

test("sidePaneStatus exposes spaced and tab-containing titles", async () => {
  const panes = [
    "%1\t/dev/ttys001\t1\t0\t0\t42\t59\t160\t60\t\tDashboard title",
    "%2\t/dev/ttys002\t0\t43\t0\t117\t59\t160\t60\t1\tPanel title\twith tab",
  ].join("\n") + "\n";
  const status = await sidePaneStatus({ ownPane: "%1" }, sidePaneExec(panes, clients([2, "pi-agent-hub-api"])));
  assert.equal(status.ownTitle, "Dashboard title");
  assert.deepEqual(status.titles, ["Panel title\twith tab", undefined, undefined, undefined]);
});

test("assign opens the requested fixed slot, tags it, and keeps sidebar focus", async () => {
  const exec = sidePaneExec(dashboard, "");
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-api", ownPane: "%1", slot: 4 }, exec), { kind: "opened", slot: 4 });
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%10", 4))), true);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("assigning the shown session's slot closes that panel", async () => {
  const exec = sidePaneExec(one, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-api", ownPane: "%1", slot: 1 }, exec), { kind: "closed" });
  assert.deepEqual(exec.calls.at(-1)?.args, ["kill-pane", "-t", "%2"]);
});

test("assign moves a shown session into a hole and keeps sidebar focus", async () => {
  const exec = sidePaneExec(one, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-api", ownPane: "%1", slot: 3 }, exec), { kind: "moved", slot: 3 });
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%10", 3))), true);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("assign swaps two shown sessions and keeps sidebar focus", async () => {
  const exec = sidePaneExec(pair12, sessions12);
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-api", ownPane: "%1", slot: 2 }, exec), { kind: "moved", slot: 2 });
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%10", 1))), true);
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%11", 2))), true);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("assign retargets an occupied slot in place and keeps sidebar focus", async () => {
  const exec = sidePaneExec(one, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-web", ownPane: "%1", slot: 1 }, exec), { kind: "retargeted", slot: 1 });
  assert.deepEqual(exec.calls.map((call) => call.args).slice(-5), [
    presize("pi-agent-hub-web", 117, 58),
    ["switch-client", "-c", "/dev/ttys002", "-t", "pi-agent-hub-web"],
    resetSize("pi-agent-hub-web"), tag("%2", 1), ["select-pane", "-t", "%1"],
  ]);
});

test("two columns require width while a same-column stack remains allowed", async () => {
  const narrowOne = one.replaceAll("160 60", "100 60");
  const columns = sidePaneExec(narrowOne, clients([2, "pi-agent-hub-api"]));
  const rows = sidePaneExec(narrowOne, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 2 }, columns), { kind: "too-narrow", panels: 2 });
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 3 }, rows), { kind: "opened", slot: 3 });
});

test("moving into a second column respects the minimum panel width", async () => {
  const narrow = pair13.replaceAll("160 60", "100 60");
  const exec = sidePaneExec(narrow, sessions12);
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-api", ownPane: "%1", slot: 2 }, exec), { kind: "too-narrow", panels: 2 });
  assert.equal(exec.calls.some((call) => call.args[0] === "kill-pane"), false);
});

test("close removes an explicit slot, rebuilds survivors, and keeps sidebar focus", async () => {
  const exec = sidePaneExec(pair12, sessions12);
  assert.deepEqual(await closeSidePaneSlot({ ownPane: "%1", slot: 2 }, exec), { kind: "closed" });
  assert.deepEqual(exec.calls.filter((call) => call.args[0] === "split-window").map((call) => call.args), [attach("-h", "%1", "pi-agent-hub-api", 117)]);
  assert.equal(exec.calls.some((call) => call.args[0] === "select-pane" && call.args.length === 3), false);
  assert.deepEqual(await closeSidePaneSlot({ ownPane: "%1", slot: 3 }, sidePaneExec(one, clients([2, "pi-agent-hub-api"]))), { kind: "unavailable" });
});

test("focus uses fixed slot identity", async () => {
  const exec = sidePaneExec(pair14, sessions12);
  assert.deepEqual(await focusSidePaneSlot({ ownPane: "%1", slot: 4 }, exec), { kind: "focused" });
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%3"]);
  assert.deepEqual(await focusSidePaneSlot({ ownPane: "%1", slot: 2 }, sidePaneExec(pair14, sessions12)), { kind: "unavailable" });
});

test("reset replaces with slot 1 and closes a sole matching panel in any slot", async () => {
  const exec = sidePaneExec(pair14, sessions12);
  assert.deepEqual(await resetSidePane({ target: "pi-agent-hub-web", ownPane: "%1" }, exec), { kind: "retargeted", slot: 1 });
  assert.equal(exec.calls.some((call) => JSON.stringify(call.args) === JSON.stringify(tag("%10", 1))), true);
  const sole4 = dashboard + pane(2, 2, 43, 0, 117, 59, 4);
  assert.deepEqual(await resetSidePane({ target: "pi-agent-hub-api", ownPane: "%1" }, sidePaneExec(sole4, clients([2, "pi-agent-hub-api"]))), { kind: "closed" });
});

test("rebuild tolerates vanished panes and pre-size failures but surfaces reset failures", async () => {
  let nextPane = 10;
  const tolerant = fakeTmux((call) => {
    if (call.args[0] === "list-panes") return { stdout: one, stderr: "" };
    if (call.args[0] === "list-clients") return { stdout: clients([2, "pi-agent-hub-api"]), stderr: "" };
    if (call.args[0] === "kill-pane") throw new Error("can't find pane");
    if (call.args[0] === "resize-window") throw new Error("can't find session");
    if (call.args[0] === "split-window") return { stdout: `%${nextPane++}\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  });
  await assert.doesNotReject(() => assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 3 }, tolerant));

  nextPane = 10;
  const failing = fakeTmux((call) => {
    if (call.args[0] === "list-panes") return { stdout: one, stderr: "" };
    if (call.args[0] === "list-clients") return { stdout: clients([2, "pi-agent-hub-api"]), stderr: "" };
    if (call.args[0] === "split-window") return { stdout: `%${nextPane++}\n`, stderr: "" };
    if (call.args[0] === "set-option" && call.args[1] === "-w") throw new Error("reset failed");
    return { stdout: "", stderr: "" };
  });
  await assert.rejects(() => assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 3 }, failing), /reset failed/);
  assert.equal(failing.calls.filter((call) => call.args[0] === "set-option" && call.args[1] === "-w").length, 2);
});

test("sidebar repair and cleanup helpers retain their contracts", async () => {
  assert.equal(sidebarRepairWidth(12, 160), 42);
  assert.equal(sidebarRepairWidth(12, 80), undefined);
  assert.equal(sidebarRepairWidth(40, 160), undefined);
  assert.equal(sidebarRepairWidth(55, 160), undefined);
  assert.equal(sidebarRepairWidth(72, 160), 60);
  assert.equal(sidebarRepairWidth(72, 100), 59);
  const showing = sidePaneExec(pair12, sessions12);
  assert.equal(await closeSidePaneShowing({ target: "pi-agent-hub-docs", ownPane: "%1" }, showing), true);
  assert.deepEqual(showing.calls.at(-1)?.args, ["kill-pane", "-t", "%3"]);
  const all = sidePaneExec(pair12, sessions12);
  await closeSidePanes({ ownPane: "%1" }, all);
  assert.equal(all.calls.filter((call) => call.args[0] === "kill-pane").length, 2);
});
