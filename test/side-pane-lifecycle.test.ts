import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSidePaneLifecycle } from "../src/app/side-pane-lifecycle.js";
import { darkTmuxChrome } from "../src/core/chrome.js";
import type { TmuxExec } from "../src/core/tmux.js";
import type { CommandResult, ManagedSession, RuntimeSession } from "../src/core/types.js";

interface FakePane { id: string; tty: string; session: string; slot?: 1 | 2 | 3 | 4; title?: string; active: boolean }

class NamedPaneTmux implements TmuxExec {
  readonly commands: string[] = [];
  readonly events: string[] = [];
  readonly panes: FakePane[];
  ownActive = true;
  ownTitle = "Dashboard";
  ownWidth = 42;
  windowWidth = 160;
  failSplit?: Error;
  failPinTitle?: Error;
  failBorder?: Error;
  nextSplit?: Promise<void>;
  nextListPanes?: Promise<CommandResult>;
  private nextPane = 10;

  constructor(initial: { session: string; slot?: 1 | 2 | 3 | 4; active?: boolean; title?: string }[] = []) {
    this.panes = initial.map((pane, index) => ({ id: `%${index + 2}`, tty: `/dev/ttys00${index + 2}`, slot: (index + 1) as 1 | 2 | 3 | 4, active: pane.active ?? false, ...pane }));
    this.ownActive = !this.panes.some((pane) => pane.active);
  }

  paneOutput(): string {
    const own = `%1\t/dev/ttys001\t${this.ownActive ? 1 : 0}\t0\t0\t${this.ownWidth}\t59\t${this.windowWidth}\t60\t\t${this.ownTitle}\n`;
    const contentWidth = this.windowWidth - this.ownWidth - 1;
    return own + this.panes.map((pane, index) => {
      const count = this.panes.length;
      const twoColumns = this.windowWidth >= 120 && count > 1;
      const left = this.ownWidth + 1 + (twoColumns && index % 2 ? Math.floor(contentWidth / 2) + 1 : 0);
      const top = count > 2 && index > 1 ? 30 : count === 2 && !twoColumns && index === 1 ? 30 : 0;
      const width = twoColumns ? Math.floor((contentWidth - 1) / 2) : contentWidth;
      const height = count > 2 || (count === 2 && !twoColumns) ? 29 : 59;
      return `${pane.id}\t${pane.tty}\t${pane.active ? 1 : 0}\t${left}\t${top}\t${width}\t${height}\t${this.windowWidth}\t60\t${pane.slot ?? ""}\t${pane.title ?? ""}\n`;
    }).join("");
  }

  async exec(command: string, args: string[]): Promise<CommandResult> {
    assert.equal(command, "tmux");
    this.commands.push(args.join(" "));
    const action = args[0];
    if (action === "list-panes") {
      this.events.push("inspect");
      if (this.nextListPanes) {
        const pending = this.nextListPanes;
        this.nextListPanes = undefined;
        return pending;
      }
      return { stdout: this.paneOutput(), stderr: "" };
    }
    if (action === "list-clients") return { stdout: this.panes.map((pane) => `client-${pane.id}\t${pane.tty}\t${pane.session}\t${pane.id}\tattached\n`).join(""), stderr: "" };
    if (action === "list-keys") return { stdout: "", stderr: "" };
    if (action === "split-window") {
      if (this.failSplit) throw this.failSplit;
      const target = args.at(-1)?.match(/attach-session -t '([^']+)'/)?.[1] ?? "unknown";
      this.events.push(`split:start:${target}`);
      if (this.nextSplit) {
        const pending = this.nextSplit;
        this.nextSplit = undefined;
        await pending;
      }
      const pane = { id: `%${this.nextPane++}`, tty: `/dev/ttys${this.nextPane + 100}`, session: target, active: false };
      this.panes.push(pane);
      this.events.push(`split:${target}`);
      return { stdout: `${pane.id}\n`, stderr: "" };
    }
    if (action === "kill-pane") {
      const id = args.at(-1)!;
      this.events.push(`kill:${id}`);
      const index = this.panes.findIndex((pane) => pane.id === id);
      if (index >= 0) this.panes.splice(index, 1);
      return { stdout: "", stderr: "" };
    }
    if (action === "select-pane" && args.includes("-T")) {
      const id = args[args.indexOf("-t") + 1]!;
      if (id === "%1") this.ownTitle = args.at(-1)!;
      else {
        if (this.failPinTitle) throw this.failPinTitle;
        const pane = this.panes.find((item) => item.id === id);
        if (pane) pane.title = args.at(-1)!;
      }
      return { stdout: "", stderr: "" };
    }
    if (action === "select-pane") {
      const id = args.at(-1)!;
      this.events.push(`focus:${id}`);
      this.ownActive = id === "%1";
      for (const pane of this.panes) pane.active = pane.id === id;
      return { stdout: "", stderr: "" };
    }
    if (action === "set-option" && args.includes("@pi_hub_slot")) {
      const pane = this.panes.find((item) => item.id === args[args.indexOf("-t") + 1]);
      if (pane) pane.slot = Number(args.at(-1)) as 1 | 2 | 3 | 4;
    }
    if (action === "set-option" && args.includes("status")) this.events.push(`status:${args[args.indexOf("-t") + 1]}:${args.at(-1)}`);
    if (action === "set-option" && args.includes("pane-border-status")) {
      this.events.push(`border:${args.at(-1)}`);
      if (this.failBorder && args.at(-1) === "top") throw this.failBorder;
    }
    if (action === "resize-pane") this.ownWidth = Number(args.at(-1));
    if (action === "switch-client") this.events.push(`switch:${args.at(-1)}`);
    if (action === "display-message") {
      const format = args.at(-1);
      if (format === "#{session_name}") return { stdout: "pi-agent-hub\n", stderr: "" };
      if (format === "#{client_name}") return { stdout: "/dev/ttys001\n", stderr: "" };
      if (format === "#{client_width} #{client_height}") return { stdout: "160 60\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function session(id: string, status: ManagedSession["status"] = "idle"): RuntimeSession {
  return { id, title: id.toUpperCase(), cwd: `/repo/${id}`, group: "test", tmuxSession: `pi-agent-hub-${id}`,
    status, createdAt: 1, updatedAt: 1 };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function harness(t: TestContext, options: {
  initial?: { session: string; slot?: 1 | 2 | 3 | 4; active?: boolean; title?: string }[];
  sessions?: RuntimeSession[];
  width?: number;
  activeRequestIds?: ReadonlyMap<string, string>;
  revealResult?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-hub-named-lifecycle-"));
  const sessions = options.sessions ?? [session("api"), session("docs")];
  const tmux = new NamedPaneTmux(options.initial);
  if (options.width) tmux.windowWidth = options.width;
  const events = tmux.events;
  const lifecycle = createSidePaneLifecycle({
    dashboardSession: "pi-agent-hub", dashboardCwd: "/repo", dashboardCommand: "pi-hub tui", dashboardEnv: () => ({}),
    ownPane: () => "%1", insideTmux: () => true, sessions: () => sessions, exec: tmux,
    revealSession: (id) => { events.push(`reveal:${id}`); return options.revealResult ?? true; },
    activeAttentionRequestId: (id) => options.activeRequestIds?.get(id),
    acknowledgeSession: async (id, requestId) => { events.push(`ack:${id}${requestId ? `:${requestId}` : ""}`); const found = sessions.find((item) => item.id === id); if (found) found.status = "idle"; },
    configureManagedSession: async (item, visible) => { events.push(`managed:${item.id}:${visible}`); },
    syncManagedSessionStatusBars: async (hidden) => { events.push(`sync:${[...hidden].join(",")}`); },
    currentChrome: () => darkTmuxChrome, render: () => { events.push("render"); },
    sidebarBindingStateDir: join(root, "sidebar"), switchBindingStateDir: join(root, "switch"), presenceIntervalMs: 10,
  });
  lifecycle.start();
  await waitFor(() => events.includes("inspect"));
  t.after(async () => { await lifecycle.stop(); await rm(root, { recursive: true, force: true }); });
  return { lifecycle, tmux, events, sessions };
}

function before(events: readonly string[], first: string, second: string) {
  assert.ok(events.indexOf(first) >= 0, `missing ${first}`);
  assert.ok(events.indexOf(first) < events.indexOf(second), `${first} must precede ${second}`);
}

test("presence adopts named pins and publishes the complete live snapshot", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api", active: true, title: "old" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  assert.deepEqual(value.lifecycle.snapshot(), {
    pins: [{ slot: 1, sessionId: "api", tmuxSession: "pi-agent-hub-api", paneId: "%2", title: "API", active: true,
      rect: { left: 43, top: 0, width: 117, height: 59 } }],
    activeSessionId: "api", capacity: 4, constrained: false, splitPercent: 50, dashboardStatusVisible: false,
  });
  assert.equal(value.tmux.ownTitle, "PI HUB / PINNED FLEET");
  assert.equal(value.tmux.panes[0]?.title, "LIVE 1 · API · Alt+1–4 · Ctrl+Q");
});

test("named pane title adds subagent owner and ticket when width permits", async (t) => {
  const parent = { ...session("parent"), workflow: { steps: [{ id: "execute", short: "EX", label: "Execute" }], activeIndex: 0, ticketId: "cockpit-007", updatedAt: 1 }, context: { version: 1 as const, updatedAt: 1, ticket: { id: "stale-001" } } as const };
  const child = { ...session("child"), kind: "subagent" as const, parentId: "parent" };
  const value = await harness(t, { sessions: [parent, child], initial: [{ session: "pi-agent-hub-child" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  assert.equal(value.tmux.panes[0]?.title, "LIVE 1 · CHILD ← PARENT #cockpit-007");
});

test("slot assignment preserves holes, refuses occupants, and numeric focus acknowledges", async (t) => {
  const api = session("api");
  const docs = session("docs", "waiting");
  const value = await harness(t, { sessions: [api, docs], initial: [{ session: "pi-agent-hub-api", slot: 1 }] });
  assert.deepEqual(await value.lifecycle.assign("docs", 1), { kind: "occupied", slot: 1, session: "pi-agent-hub-api" });
  assert.deepEqual(await value.lifecycle.assign("docs", 4), { kind: "pinned", slot: 4, session: "pi-agent-hub-docs" });
  assert.deepEqual(value.lifecycle.snapshot().pins.map((pin) => [pin.slot, pin.sessionId]), [[1, "api"], [4, "docs"]]);
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.focus(4), { kind: "focused" });
  before(value.events, "reveal:docs", "ack:docs");
  before(value.events, "ack:docs", value.events.find((event) => event.startsWith("focus:"))!);
});

test("exact-session focus re-inspects pin identity and never follows a replaced slot", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting, session("docs")], initial: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.focusPinnedSession("api"), { kind: "focused" });
  before(value.events, "reveal:api", "ack:api");
  before(value.events, "ack:api", "focus:%2");

  value.tmux.panes[0]!.session = "pi-agent-hub-docs";
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.focusPinnedSession("api"), { kind: "unavailable" });
  assert.equal(value.events.some((event) => event.startsWith("focus:")), false);
  assert.equal(value.events.some((event) => event.startsWith("ack:")), false);
});

test("existing idle pin acknowledges only the exact active delivered request", async (t) => {
  const idle = session("api", "idle");
  const value = await harness(t, { sessions: [idle], initial: [{ session: "pi-agent-hub-api" }], activeRequestIds: new Map([["api", "req-2"]]) });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.pin("api"), { kind: "focused", session: "pi-agent-hub-api", slot: 1 });
  before(value.events, "reveal:api", "ack:api:req-2");
  before(value.events, "ack:api:req-2", "focus:%2");
});

test("new pin does not acknowledge and keeps cockpit focus", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting] });
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.pin("api"), { kind: "pinned", session: "pi-agent-hub-api", slot: 1 });
  assert.equal(value.events.includes("ack:api"), false);
  assert.ok(value.events.includes("focus:%1"));
  assert.equal(value.lifecycle.snapshot().pins[0]?.sessionId, "api");
});

test("pinning an existing waiting identity reveals and acknowledges before pane focus", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting], initial: [{ session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.pin("api"), { kind: "focused", session: "pi-agent-hub-api", slot: 1 });
  before(value.events, "reveal:api", "ack:api");
  before(value.events, "ack:api", "focus:%2");
});

test("close and resize use managed identity and commit a re-inspected snapshot", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api" }, { session: "pi-agent-hub-docs" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 2);
  assert.deepEqual(await value.lifecycle.resize(1), { kind: "resized", splitPercent: 60 });
  assert.equal(value.lifecycle.snapshot().splitPercent, 50, "fake tmux does not apply split geometry");
  assert.deepEqual(await value.lifecycle.close("docs"), { kind: "closed" });
  assert.deepEqual(value.lifecycle.snapshot().pins.map((pin) => pin.sessionId), ["api"]);
  assert.ok(value.events.includes("status:pi-agent-hub-docs:on"));
});

test("spatial focus treats cockpit as a synthetic left neighbor", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting], initial: [{ session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.focusDirection("right"), { kind: "focused" });
  before(value.events, "reveal:api", "ack:api");
  before(value.events, "ack:api", "focus:%2");
  assert.deepEqual(await value.lifecycle.focusDirection("left"), { kind: "focused" });
  assert.equal(value.events.at(-2) === "focus:%1" || value.events.includes("focus:%1"), true);
});

test("presence follows externally focused pane identity and acknowledges waiting", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting], initial: [{ session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  value.tmux.ownActive = false;
  value.tmux.panes[0]!.active = true;
  await waitFor(() => value.lifecycle.snapshot().activeSessionId === "api");
  before(value.events, "reveal:api", "ack:api");
});

test("return to cockpit reveals the exact active managed session before focus", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api", active: true }] });
  await waitFor(() => value.lifecycle.snapshot().activeSessionId === "api");
  value.events.length = 0;
  assert.deepEqual(await value.lifecycle.returnToCockpit(), { kind: "focused" });
  before(value.events, "reveal:api", "focus:%1");
});

test("duplicate panes are removed before a named focus mutation", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api" }, { session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  await value.lifecycle.pin("api");
  before(value.events, "kill:%3", "focus:%2");
});

test("capacity refusal preserves chrome and existing pins", async (t) => {
  const value = await harness(t, { width: 100, initial: [{ session: "pi-agent-hub-api" }, { session: "pi-agent-hub-docs" }] });
  value.sessions.push(session("more"));
  await waitFor(() => value.lifecycle.snapshot().pins.length === 2);
  assert.deepEqual(await value.lifecycle.pin("more"), { kind: "capacity", capacity: 2, pins: 2 });
  assert.deepEqual(value.lifecycle.snapshot().pins.map((pin) => pin.sessionId), ["api", "docs"]);
  assert.equal(value.tmux.panes.length, 2);
});

test("handoff reveals and acknowledges before managed chrome and switch", async (t) => {
  const waiting = session("api", "waiting");
  const value = await harness(t, { sessions: [waiting], initial: [{ session: "pi-agent-hub-api" }] });
  value.events.length = 0;
  assert.equal(await value.lifecycle.handoff("pi-agent-hub-api"), true);
  before(value.events, "reveal:api", "ack:api");
  before(value.events, "ack:api", "managed:api:true");
  before(value.events, "managed:api:true", "switch:pi-agent-hub-api");
});

test("handoff reports unavailable when exact reveal fails", async (t) => {
  const value = await harness(t, { revealResult: false });
  value.events.length = 0;
  assert.equal(await value.lifecycle.handoff("pi-agent-hub-api"), false);
  assert.doesNotMatch(value.events.join("\n"), /switch:pi-agent-hub-api/);
});

test("failed first pin rolls panel chrome back without hiding the original failure", async (t) => {
  const value = await harness(t);
  value.events.length = 0;
  value.tmux.failSplit = new Error("split failed");
  await assert.rejects(() => value.lifecycle.pin("api"), /split failed/);
  before(value.events, "status:pi-agent-hub:off", "status:pi-agent-hub:on");
  before(value.events, "border:top", "border:off");
  assert.equal(value.lifecycle.snapshot().dashboardStatusVisible, true);
  assert.equal(value.tmux.ownTitle, "");
});

test("failed first-pin chrome setup restores dashboard visibility", async (t) => {
  const value = await harness(t);
  value.events.length = 0;
  value.tmux.failBorder = new Error("border failed");
  await assert.rejects(() => value.lifecycle.pin("api"), /border failed/);
  assert.deepEqual(value.tmux.panes, []);
  assert.equal(value.lifecycle.snapshot().dashboardStatusVisible, true);
  assert.equal(value.tmux.ownTitle, "");
  before(value.events, "status:pi-agent-hub:off", "status:pi-agent-hub:on");
});

test("failed first pin after pane creation removes the partial attachment", async (t) => {
  const value = await harness(t);
  value.events.length = 0;
  value.tmux.failPinTitle = new Error("title failed");
  await assert.rejects(() => value.lifecycle.pin("api"), /title failed/);
  assert.deepEqual(value.tmux.panes, []);
  assert.deepEqual(value.lifecycle.snapshot().pins, []);
  assert.equal(value.tmux.ownTitle, "");
  assert.ok(value.events.includes("status:pi-agent-hub:on"));
  assert.ok(value.events.includes("border:off"));
});

test("detach, theme refresh, and managed chrome sync stay on the serialized lifecycle", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api" }, { session: "pi-agent-hub-docs" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 2);
  value.events.length = 0;
  value.lifecycle.refreshPanelChrome();
  value.lifecycle.sync();
  await waitFor(() => value.events.includes("sync:pi-agent-hub-api,pi-agent-hub-docs"));
  before(value.events, "border:top", "sync:pi-agent-hub-api,pi-agent-hub-docs");
  assert.equal(await value.lifecycle.detach("pi-agent-hub-api"), true);
  assert.deepEqual(value.lifecycle.snapshot().pins.map((pin) => pin.sessionId), ["docs"]);
});

test("overlapping named mutations stay serialized behind one live split", async (t) => {
  const value = await harness(t);
  const gate = deferred<void>();
  value.tmux.nextSplit = gate.promise;
  value.events.length = 0;
  const first = value.lifecycle.pin("api");
  await waitFor(() => value.events.includes("split:start:pi-agent-hub-api"));
  const second = value.lifecycle.pin("docs");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(value.events.filter((event) => event.startsWith("split:start:")).length, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(value.lifecycle.snapshot().pins.map((pin) => pin.sessionId), ["api", "docs"]);
});

test("shutdown drains an in-flight pane mutation before restoring chrome", async (t) => {
  const value = await harness(t);
  const gate = deferred<void>();
  value.tmux.nextSplit = gate.promise;
  value.events.length = 0;
  const pinning = value.lifecycle.pin("api").then((result) => { value.events.push("pin:done"); return result; });
  await waitFor(() => value.events.includes("split:start:pi-agent-hub-api"));
  let stopped = false;
  const stopping = value.lifecycle.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  gate.resolve();
  assert.deepEqual(await pinning, { kind: "pinned", session: "pi-agent-hub-api", slot: 1 });
  await stopping;
  before(value.events, "pin:done", "status:pi-agent-hub:on");
});

test("shutdown drains an in-flight presence read before restoring chrome and panes", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  const gate = deferred<CommandResult>();
  value.tmux.nextListPanes = gate.promise;
  value.events.length = 0;
  await waitFor(() => value.events.includes("inspect"));
  let stopped = false;
  const stopping = value.lifecycle.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  gate.resolve({ stdout: value.tmux.paneOutput(), stderr: "" });
  await stopping;
  assert.equal(stopped, true);
  assert.ok(value.events.includes("kill:%2"));
});

test("shutdown rejects new mutations and restores footer, panes, and dashboard chrome", async (t) => {
  const value = await harness(t, { initial: [{ session: "pi-agent-hub-api" }] });
  await waitFor(() => value.lifecycle.snapshot().pins.length === 1);
  value.events.length = 0;
  await value.lifecycle.stop();
  assert.deepEqual(await value.lifecycle.close("api"), { kind: "unavailable" });
  before(value.events, "status:pi-agent-hub-api:on", "kill:%2");
  assert.ok(value.events.includes("status:pi-agent-hub:on"));
  assert.equal(value.tmux.ownTitle, "");
  assert.ok(value.events.includes("border:off"));
});
