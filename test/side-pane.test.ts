import test from "node:test";
import assert from "node:assert/strict";
import {
  assignSidePaneSlot,
  closeSidePane,
  closeSidePaneShowing,
  closeSidePanes,
  focusSidePane,
  focusSidePaneSlot,
  pinLayout,
  slotLayout,
  pinSidePane,
  rectangleNeighbor,
  resizeSidePane,
  sidebarRepairWidth,
  sidePaneCapacity,
  sidePaneStatus,
  type PaneRectangle,
  type SidePaneSlot,
} from "../src/app/side-pane.js";
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

const row = (id: number, tty: number, active: number, left: number, top: number, width: number, height: number, windowWidth = 160, title = "", slot?: SidePaneSlot) =>
  `%${id}\t/dev/ttys00${tty}\t${active}\t${left}\t${top}\t${width}\t${height}\t${windowWidth}\t60\t${slot ?? ""}\t${title}\n`;
const dashboard = (windowWidth = 160, width = 42) => row(1, 1, 1, 0, 0, width, 59, windowWidth, "Dashboard");
const clients = (...entries: [number, string][]) => entries.map(([tty, session]) => `client-${tty}\t/dev/ttys00${tty}\t${session}\t%${tty}\tattached\n`).join("");
const sessions = clients([2, "pi-agent-hub-api"], [3, "pi-agent-hub-docs"], [4, "pi-agent-hub-api"]);

function layout(count: number, windowWidth: number, contentWidth: number, splitPercent = 50) {
  return pinLayout({ count, windowWidth, contentWidth, windowHeight: 60, splitPercent });
}

test("capacity has exact whole-window thresholds", () => {
  assert.equal(sidePaneCapacity(99), 0);
  assert.equal(sidePaneCapacity(100), 2);
  assert.equal(sidePaneCapacity(159), 2);
  assert.equal(sidePaneCapacity(160), 4);
});

test("named layouts implement stacked, side-by-side, spanning, and grid geometry", () => {
  assert.deepEqual(layout(1, 100, 57), [{ left: 0, top: 0, width: 57, height: 59 }]);
  assert.deepEqual(layout(2, 119, 76), [
    { left: 0, top: 0, width: 76, height: 29 },
    { left: 0, top: 30, width: 76, height: 29 },
  ]);
  assert.deepEqual(layout(2, 120, 77), [
    { left: 0, top: 0, width: 38, height: 59 },
    { left: 39, top: 0, width: 38, height: 59 },
  ]);
  assert.deepEqual(layout(3, 160, 117), [
    { left: 0, top: 0, width: 58, height: 29 },
    { left: 59, top: 0, width: 58, height: 59 },
    { left: 0, top: 30, width: 58, height: 29 },
  ]);
  assert.deepEqual(layout(4, 160, 117), [
    { left: 0, top: 0, width: 58, height: 29 },
    { left: 59, top: 0, width: 58, height: 29 },
    { left: 0, top: 30, width: 58, height: 29 },
    { left: 59, top: 30, width: 58, height: 29 },
  ]);
});

test("full slots preserve quadrant identity and medium-width slot order", () => {
  assert.deepEqual([...slotLayout(new Set([1, 2]), { windowWidth: 119, contentWidth: 76, windowHeight: 60 })], [
    [1, { left: 0, top: 0, width: 76, height: 29 }],
    [2, { left: 0, top: 30, width: 76, height: 29 }],
  ]);
  assert.deepEqual([...slotLayout(new Set([1, 2, 4]), { windowWidth: 119, contentWidth: 76, windowHeight: 60 })], [
    [1, { left: 0, top: 0, width: 38, height: 59 }],
    [2, { left: 39, top: 0, width: 37, height: 29 }],
    [4, { left: 39, top: 30, width: 37, height: 29 }],
  ]);
  assert.deepEqual([...slotLayout(new Set([1, 3]), { windowWidth: 160, contentWidth: 117, windowHeight: 60, splitPercent: 60 })], [
    [1, { left: 0, top: 0, width: 117, height: 35 }],
    [3, { left: 0, top: 36, width: 117, height: 23 }],
  ]);
  assert.deepEqual([...slotLayout(new Set([1, 3, 4]), { windowWidth: 160, contentWidth: 117, windowHeight: 60 })], [
    [1, { left: 0, top: 0, width: 58, height: 29 }],
    [3, { left: 0, top: 30, width: 58, height: 29 }],
    [4, { left: 59, top: 0, width: 58, height: 59 }],
  ]);
});

test("split geometry clamps to 30/70", () => {
  assert.equal(layout(2, 120, 77, 10)[0]?.width, 23);
  assert.equal(layout(2, 120, 77, 90)[0]?.width, 53);
  assert.equal(layout(2, 119, 76, 60)[0]?.height, 35);
});

test("sidebar repair preserves the 38-cell named pin minimum", () => {
  assert.equal(sidebarRepairWidth(60, 120), 42);
  assert.equal(sidebarRepairWidth(12, 160), 42);
  assert.equal(sidebarRepairWidth(72, 160), 60);
  assert.equal(sidebarRepairWidth(12, 99), 42);
  assert.equal(sidebarRepairWidth(12, 79), 40);
});

test("status returns ordered named pins, canonical duplicates, active identity, and ignores user panes", async () => {
  const panes = dashboard() + row(3, 3, 0, 102, 0, 58, 59, 160, "LIVE · Docs", 2)
    + row(4, 4, 0, 43, 30, 58, 29, 160, "duplicate", 3)
    + row(2, 2, 1, 43, 0, 58, 29, 160, "LIVE · API", 1)
    + row(9, 9, 0, 43, 0, 117, 59, 160, "shell");
  const status = await sidePaneStatus({ ownPane: "%1" }, sidePaneExec(panes, sessions + clients([9, "shell"])));
  assert.deepEqual(status.pins.map((pin) => [pin.session, pin.slot, pin.paneId, pin.tty, pin.title]), [
    ["pi-agent-hub-api", 1, "%2", "/dev/ttys002", "LIVE · API"],
    ["pi-agent-hub-docs", 2, "%3", "/dev/ttys003", "LIVE · Docs"],
  ]);
  assert.deepEqual(status.duplicatePaneIds, ["%4"]);
  assert.equal(status.activeSessionId, "pi-agent-hub-api");
  assert.equal(status.capacity, 4);
  assert.equal(status.constrained, false);
  assert.equal(status.own?.id, "%1");
});

test("status marks existing pins constrained after window contraction", async () => {
  const panes = dashboard(90) + row(2, 2, 0, 43, 0, 47, 29, 90, "", 1) + row(3, 3, 0, 43, 30, 47, 29, 90, "", 2);
  const status = await sidePaneStatus({ ownPane: "%1" }, sidePaneExec(panes, sessions));
  assert.equal(status.capacity, 0);
  assert.equal(status.constrained, true);
  assert.equal(status.pins.length, 2);
});

test("status repairs missing and duplicate transient slot tags in geometry order", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 58, 59, 160, "API")
    + row(3, 3, 0, 102, 0, 58, 59, 160, "Docs", 1);
  const exec = sidePaneExec(panes, sessions);
  const status = await sidePaneStatus({ ownPane: "%1" }, exec);
  assert.deepEqual(status.pins.map((pin) => [pin.session, pin.slot]), [["pi-agent-hub-docs", 1], ["pi-agent-hub-api", 2]]);
  assert.equal(exec.calls.some((call) => call.args.join(" ") === "set-option -p -t %2 @pi_hub_slot 2"), true);
});

test("exact slot assignment refuses an occupied destination without mutation", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "API", 1);
  const exec = sidePaneExec(panes, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 1 }, exec), {
    kind: "occupied", slot: 1, session: "pi-agent-hub-api",
  });
  assert.equal(exec.calls.some((call) => call.args[0] === "kill-pane" || call.args[0] === "split-window"), false);
});

test("exact slot assignment preserves holes and focus targets the tagged slot", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "API", 1);
  const exec = sidePaneExec(panes, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await assignSidePaneSlot({ target: "pi-agent-hub-docs", ownPane: "%1", slot: 4 }, exec), {
    kind: "pinned", session: "pi-agent-hub-docs", slot: 4,
  });
  assert.equal(exec.calls.some((call) => call.args.join(" ").endsWith("@pi_hub_slot 4")), true);
  const focusExec = sidePaneExec(dashboard() + row(3, 3, 0, 43, 0, 117, 59, 160, "Docs", 4), clients([3, "pi-agent-hub-docs"]));
  assert.deepEqual(await focusSidePaneSlot({ ownPane: "%1", slot: 4 }, focusExec), { kind: "focused" });
  assert.deepEqual(focusExec.calls.at(-1)?.args, ["select-pane", "-t", "%3"]);
});

test("pin appends to the lowest free slot without eviction, uses LIVE title, presizes, resets, and keeps cockpit focus", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "", 1);
  const exec = sidePaneExec(panes, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await pinSidePane({ target: "pi-agent-hub-docs", ownPane: "%1", titleFor: (target) => target.endsWith("docs") ? "Docs" : "API" }, exec), {
    kind: "pinned", session: "pi-agent-hub-docs", slot: 2,
  });
  assert.equal(exec.calls.some((call) => call.args.join(" ").includes("resize-window -t pi-agent-hub-docs")), true);
  assert.equal(exec.calls.some((call) => call.args.join(" ").includes("-T LIVE 2 · Docs")), true);
  assert.equal(exec.calls.filter((call) => call.args.includes("window-size") && call.args.includes("latest")).length, 2);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("pin focuses an existing identity and reconciles duplicate panes", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "", 1) + row(4, 4, 0, 43, 30, 117, 29, 160, "", 2);
  const exec = sidePaneExec(panes, clients([2, "pi-agent-hub-api"], [4, "pi-agent-hub-api"]));
  assert.deepEqual(await pinSidePane({ target: "pi-agent-hub-api", ownPane: "%1" }, exec), { kind: "focused", session: "pi-agent-hub-api", slot: 1 });
  assert.equal(exec.calls.some((call) => call.args.join(" ") === "kill-pane -t %4"), true);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%2"]);
});

test("unexpected pre-size failure restores original slots instead of being swallowed", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "", 1);
  let failed = false;
  const exec = fakeTmux((call) => {
    if (call.args[0] === "list-panes") return { stdout: panes, stderr: "" };
    if (call.args[0] === "list-clients") return { stdout: clients([2, "pi-agent-hub-api"]), stderr: "" };
    if (call.args[0] === "resize-window" && call.args.includes("pi-agent-hub-docs") && !failed) {
      failed = true;
      throw new Error("resize transport failed");
    }
    if (call.args[0] === "split-window") return { stdout: "%10\n", stderr: "" };
    return { stdout: "", stderr: "" };
  });
  await assert.rejects(() => pinSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, exec), /resize transport failed/);
  assert.match(exec.calls.filter((call) => call.args[0] === "split-window").at(-1)?.args.at(-1) ?? "", /pi-agent-hub-api/);
});

test("failed rebuild restores the original slot attachments before surfacing the error", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 59, 160, "", 1);
  let splitCalls = 0;
  const exec = fakeTmux((call) => {
    if (call.args[0] === "list-panes") return { stdout: panes, stderr: "" };
    if (call.args[0] === "list-clients") return { stdout: clients([2, "pi-agent-hub-api"]), stderr: "" };
    if (call.args[0] === "split-window") {
      splitCalls += 1;
      if (splitCalls === 1) throw new Error("split failed");
      return { stdout: "%10\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
  await assert.rejects(() => pinSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, exec), /split failed/);
  const splits = exec.calls.filter((call) => call.args[0] === "split-window");
  assert.equal(splits.length, 2);
  assert.match(splits[1]!.args.at(-1) ?? "", /pi-agent-hub-api/);
  assert.deepEqual(exec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("pin refuses new assignments while a contracted high slot survives", async () => {
  const panes = dashboard(120) + row(2, 2, 0, 43, 0, 77, 59, 120, "", 4);
  const exec = sidePaneExec(panes, clients([2, "pi-agent-hub-api"]));
  assert.deepEqual(await pinSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, exec), { kind: "capacity", capacity: 2, pins: 1 });
  assert.equal(exec.calls.some((call) => call.args[0] === "kill-pane" || call.args[0] === "split-window"), false);
});

test("pin refuses at capacity before pane mutation", async () => {
  const panes = dashboard(120) + row(2, 2, 0, 43, 0, 38, 59, 120, "", 1) + row(3, 3, 0, 82, 0, 38, 59, 120, "", 2);
  const exec = sidePaneExec(panes, sessions);
  assert.deepEqual(await pinSidePane({ target: "pi-agent-hub-web", ownPane: "%1" }, exec), { kind: "capacity", capacity: 2, pins: 2 });
  assert.equal(exec.calls.some((call) => call.args[0] === "kill-pane" || call.args[0] === "split-window"), false);
});

test("focus and close target managed session identity", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 58, 59, 160, "", 1) + row(3, 3, 0, 102, 0, 58, 59, 160, "", 2);
  const focusExec = sidePaneExec(panes, sessions);
  assert.deepEqual(await focusSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, focusExec), { kind: "focused" });
  assert.deepEqual(focusExec.calls.at(-1)?.args, ["select-pane", "-t", "%3"]);
  const closeExec = sidePaneExec(panes, sessions);
  assert.deepEqual(await closeSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, closeExec), { kind: "closed" });
  assert.equal(closeExec.calls.some((call) => call.args.join(" ") === "kill-pane -t %2"), true);
  assert.equal(closeExec.calls.some((call) => call.args.join(" ") === "kill-pane -t %3"), true);
  assert.deepEqual(closeExec.calls.at(-1)?.args, ["select-pane", "-t", "%1"]);
});

test("closing a contracted high slot rebuilds the surviving full-slot topology", async () => {
  const panes = dashboard(120)
    + row(2, 2, 0, 43, 0, 38, 29, 120, "", 1)
    + row(3, 3, 0, 82, 0, 38, 29, 120, "", 2)
    + row(4, 4, 0, 43, 30, 38, 29, 120, "", 3)
    + row(5, 5, 0, 82, 30, 38, 29, 120, "", 4);
  const exec = sidePaneExec(panes, clients(
    [2, "pi-agent-hub-api"], [3, "pi-agent-hub-docs"], [4, "pi-agent-hub-web"], [5, "pi-agent-hub-test"],
  ));
  assert.deepEqual(await closeSidePane({ target: "pi-agent-hub-docs", ownPane: "%1" }, exec), { kind: "closed" });
  assert.equal(exec.calls.some((call) => call.args.join(" ").endsWith("@pi_hub_slot 3")), true);
  assert.equal(exec.calls.some((call) => call.args.join(" ").endsWith("@pi_hub_slot 4")), true);
});

test("resize changes the main split by ten points and rebuilds safely", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 58, 59, 160, "", 1) + row(3, 3, 0, 102, 0, 58, 59, 160, "", 2);
  const exec = sidePaneExec(panes, sessions);
  assert.deepEqual(await resizeSidePane({ ownPane: "%1", delta: 10 }, exec), { kind: "resized", splitPercent: 60 });
  const horizontal = exec.calls.find((call) => call.args[0] === "split-window" && call.args.includes("-h") && call.args.includes("%10"));
  assert.equal(horizontal?.args.includes("46"), true);
  assert.equal(exec.calls.filter((call) => call.args.includes("window-size")).length, 2);
});

test("resize applies the main split vertically for one occupied slot column", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 117, 29, 160, "", 1) + row(3, 3, 0, 43, 30, 117, 29, 160, "", 3);
  const exec = sidePaneExec(panes, sessions);
  assert.deepEqual(await resizeSidePane({ ownPane: "%1", delta: 1 }, exec), { kind: "resized", splitPercent: 60 });
  const vertical = exec.calls.find((call) => call.args[0] === "split-window" && call.args.includes("-v"));
  assert.equal(vertical?.args.includes("23"), true);

  const rightPanes = dashboard() + row(2, 2, 0, 43, 0, 117, 29, 160, "", 2) + row(3, 3, 0, 43, 30, 117, 29, 160, "", 4);
  const rightExec = sidePaneExec(rightPanes, sessions);
  assert.deepEqual(await resizeSidePane({ ownPane: "%1", delta: 1 }, rightExec), { kind: "resized", splitPercent: 60 });
  const rightVertical = rightExec.calls.find((call) => call.args[0] === "split-window" && call.args.includes("-v"));
  assert.equal(rightVertical?.args.includes("23"), true);
});

test("resize refuses a contracted constrained layout without mutation", async () => {
  const panes = dashboard(99) + row(2, 2, 0, 43, 0, 56, 29, 99, "", 1) + row(3, 3, 0, 43, 30, 56, 29, 99, "", 2);
  const exec = sidePaneExec(panes, sessions);
  assert.deepEqual(await resizeSidePane({ ownPane: "%1", delta: 1 }, exec), { kind: "unavailable" });
  assert.equal(exec.calls.some((call) => call.args[0] === "kill-pane" || call.args[0] === "split-window"), false);
});

test("rectangle neighbor requires directional overlap and uses deterministic ties", () => {
  const source: PaneRectangle = { left: 0, top: 0, width: 40, height: 59 };
  const candidates = [
    { paneId: "%3", rect: { left: 41, top: 30, width: 40, height: 29 } },
    { paneId: "%2", rect: { left: 41, top: 0, width: 40, height: 29 } },
    { paneId: "%9", rect: { left: 90, top: 70, width: 10, height: 10 } },
  ];
  assert.equal(rectangleNeighbor(source, candidates, "right")?.paneId, "%2");
  assert.equal(rectangleNeighbor(source, candidates, "left"), undefined);
  assert.equal(rectangleNeighbor(candidates[1]!.rect, [{ paneId: "%1", rect: source }], "left")?.paneId, "%1");
});

test("close showing and all use pane IDs and tolerate disappearance", async () => {
  const panes = dashboard() + row(2, 2, 0, 43, 0, 58, 59, 160, "", 1) + row(3, 3, 0, 102, 0, 58, 59, 160, "", 2);
  const showing = sidePaneExec(panes, sessions);
  assert.equal(await closeSidePaneShowing({ target: "pi-agent-hub-docs", ownPane: "%1" }, showing), true);
  assert.deepEqual(showing.calls.at(-1)?.args, ["kill-pane", "-t", "%3"]);
  const all = sidePaneExec(panes, sessions);
  await closeSidePanes({ ownPane: "%1" }, all);
  assert.equal(all.calls.filter((call) => call.args[0] === "kill-pane").length, 2);
});
