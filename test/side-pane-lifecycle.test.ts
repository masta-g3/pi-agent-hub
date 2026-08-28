import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSidePaneLifecycle } from "../src/app/side-pane-lifecycle.js";
import { darkTmuxChrome } from "../src/core/chrome.js";
import type { TmuxExec } from "../src/core/tmux.js";
import type { CommandResult, ManagedSession } from "../src/core/types.js";

interface FakePane {
  id: string;
  tty: string;
  session: string;
  slot?: number;
  title?: string;
  active: boolean;
}

interface InitialPane {
  session: string;
  slot?: number;
  title?: string;
  active?: boolean;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class SidePaneTmux implements TmuxExec {
  readonly events: string[];
  readonly commands: string[] = [];
  readonly panes: FakePane[];
  ownActive: boolean;
  ownTitle = "";
  ownWidth = 42;
  windowWidth = 160;
  splitFailure?: { afterCreate: boolean; error: Error };
  failCommand?: (args: readonly string[]) => Error | undefined;
  nextListPanes?: Promise<CommandResult>;
  private nextPane = 10;

  constructor(events: string[], initial: InitialPane[] = []) {
    this.events = events;
    this.panes = initial.map((pane, index) => ({
      id: `%${index + 2}`,
      tty: `/dev/ttys00${index + 2}`,
      session: pane.session,
      ...(pane.slot === undefined ? {} : { slot: pane.slot }),
      ...(pane.title === undefined ? {} : { title: pane.title }),
      active: pane.active ?? false,
    }));
    this.ownActive = !this.panes.some((pane) => pane.active);
  }

  paneOutput(): string {
    const own = `%1\t/dev/ttys001\t${this.ownActive ? 1 : 0}\t0\t0\t${this.ownWidth}\t59\t${this.windowWidth}\t60\t\t${this.ownTitle}\n`;
    return own + this.panes.map((pane, index) =>
      `${pane.id}\t${pane.tty}\t${pane.active ? 1 : 0}\t${this.ownWidth + 1}\t${index * 30}\t${this.windowWidth - this.ownWidth - 1}\t${this.panes.length > 1 ? 29 : 59}\t${this.windowWidth}\t60\t${pane.slot ?? ""}\t${pane.title ?? ""}\n`,
    ).join("");
  }

  async exec(command: string, args: string[]): Promise<CommandResult> {
    assert.equal(command, "tmux");
    this.commands.push(args.join(" "));
    const failure = this.failCommand?.(args);
    if (failure) throw failure;
    const action = args[0];
    if (action === "list-panes") {
      this.events.push("inspect:panes");
      if (this.nextListPanes) {
        const pending = this.nextListPanes;
        this.nextListPanes = undefined;
        return pending;
      }
      return { stdout: this.paneOutput(), stderr: "" };
    }
    if (action === "list-clients") {
      this.events.push("inspect:clients");
      return { stdout: this.panes.map((pane) => `${pane.tty} ${pane.session}\n`).join(""), stderr: "" };
    }
    if (action === "list-keys") {
      this.events.push(`keys:${args.at(-1)}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "split-window") {
      const attach = args.at(-1)?.match(/attach-session -t '([^']+)'/);
      const target = attach?.[1] ?? "unknown";
      this.events.push(`split:${target}`);
      if (this.splitFailure && !this.splitFailure.afterCreate) throw this.splitFailure.error;
      const pane: FakePane = {
        id: `%${this.nextPane++}`,
        tty: `/dev/ttys${this.nextPane + 100}`,
        session: target,
        active: false,
      };
      this.panes.push(pane);
      if (this.splitFailure?.afterCreate) throw this.splitFailure.error;
      return { stdout: `${pane.id}\n`, stderr: "" };
    }
    if (action === "kill-pane") {
      const paneId = args.at(-1)!;
      this.events.push(`kill:${paneId}`);
      const index = this.panes.findIndex((pane) => pane.id === paneId);
      if (index >= 0) this.panes.splice(index, 1);
      return { stdout: "", stderr: "" };
    }
    if (action === "select-pane" && args.includes("-T")) {
      const paneId = args[args.indexOf("-t") + 1]!;
      const title = args.at(-1)!;
      if (paneId === "%1") this.ownTitle = title;
      else this.panes.find((pane) => pane.id === paneId)!.title = title;
      this.events.push(`title:${paneId}:${title}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "select-pane") {
      const paneId = args.at(-1)!;
      this.events.push(`focus:${paneId}`);
      this.ownActive = paneId === "%1";
      for (const pane of this.panes) pane.active = pane.id === paneId;
      return { stdout: "", stderr: "" };
    }
    if (action === "switch-client" && args.includes("-c")) {
      const tty = args[args.indexOf("-c") + 1];
      const target = args.at(-1)!;
      const pane = this.panes.find((item) => item.tty === tty);
      if (pane) {
        this.events.push(`retarget:${target}`);
        pane.session = target;
      } else {
        this.events.push(`switch:${target}`);
      }
      return { stdout: "", stderr: "" };
    }
    if (action === "resize-pane") {
      this.events.push(`resize:${args.at(-1)}`);
      if (args[args.indexOf("-t") + 1] === "%1") this.ownWidth = Number(args.at(-1));
      return { stdout: "", stderr: "" };
    }
    if (action === "set-option" && args.includes("@pi_hub_slot")) {
      const paneId = args[args.indexOf("-t") + 1]!;
      const slot = Number(args.at(-1));
      this.events.push(`slot:${paneId}:${slot}`);
      const pane = this.panes.find((item) => item.id === paneId);
      if (pane) pane.slot = slot;
      return { stdout: "", stderr: "" };
    }
    if (action === "set-option" && args.includes("pane-border-status")) {
      this.events.push(`border:${args.at(-1)}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "set-option" && args.includes("status")) {
      const target = args[args.indexOf("-t") + 1]!;
      this.events.push(`status:${target}:${args.at(-1)}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "bind-key") {
      this.events.push(`bind:${args[2]}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "unbind-key") {
      this.events.push(`unbind:${args.at(-1)}`);
      return { stdout: "", stderr: "" };
    }
    if (action === "display-message") {
      const format = args.at(-1);
      if (format === "#{session_name}") return { stdout: "pi-agent-hub\n", stderr: "" };
      if (format === "#{client_name}") return { stdout: "/dev/ttys001\n", stderr: "" };
      if (format === "#{client_width} #{client_height}") return { stdout: "160 60\n", stderr: "" };
    }
    this.events.push(`tmux:${args.join(" ")}`);
    return { stdout: "", stderr: "" };
  }
}

function managedSession(id: string, status: ManagedSession["status"] = "idle"): ManagedSession {
  return {
    id,
    title: id.toUpperCase(),
    cwd: `/repo/${id}`,
    group: "test",
    tmuxSession: `pi-agent-hub-${id}`,
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for lifecycle event");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function harness(t: TestContext, options: {
  initialPanes?: InitialPane[];
  sessions?: ManagedSession[];
  windowWidth?: number;
  presenceIntervalMs?: number;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-agent-hub-lifecycle-"));
  const events: string[] = [];
  const sessions = options.sessions ?? [managedSession("api"), managedSession("docs")];
  const exec = new SidePaneTmux(events, options.initialPanes);
  if (options.windowWidth !== undefined) exec.windowWidth = options.windowWidth;
  const sidebarStateDir = join(root, "sidebar-return");
  const switchStateDir = join(root, "switch-return");
  const lifecycle = createSidePaneLifecycle({
    exec,
    ownPane: () => "%1",
    insideTmux: () => true,
    dashboardSession: "pi-agent-hub",
    dashboardCwd: "/repo/dashboard",
    dashboardCommand: "pi-agent-hub tui",
    dashboardEnv: () => ({ PI_AGENT_HUB_DIR: "/tmp/hub" }),
    sidebarBindingStateDir: sidebarStateDir,
    switchBindingStateDir: switchStateDir,
    render: () => { events.push("render"); },
    sessions: () => sessions,
    acknowledgeSession: async (id: string) => {
      events.push(`ack:${id}`);
      const session = sessions.find((item) => item.id === id);
      if (session) session.status = "idle";
    },
    configureManagedSession: async (session: ManagedSession, visible: boolean) => {
      events.push(`managed:${session.id}:${visible ? "on" : "off"}`);
    },
    syncManagedSessionStatusBars: async (openTargets: ReadonlySet<string>) => {
      events.push(`sync:${[...openTargets].join(",")}`);
    },
    currentChrome: () => darkTmuxChrome,
    presenceIntervalMs: options.presenceIntervalMs,
  });
  t.after(async () => {
    await lifecycle.stop();
    await rm(root, { recursive: true, force: true });
  });
  return { events, sessions, exec, lifecycle, sidebarStateDir, switchStateDir };
}

async function startAndSettle(value: Awaited<ReturnType<typeof harness>>): Promise<void> {
  value.lifecycle.start();
  await waitFor(() => value.events.includes("inspect:panes"));
  await waitFor(() => value.events.includes("render") || !value.exec.panes.length);
}

function eventIndex(events: readonly string[], event: string): number {
  const index = events.indexOf(event);
  assert.notEqual(index, -1, `missing event ${event}\n${events.join("\n")}`);
  return index;
}

async function seedSwitchBinding(stateDir: string): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const returnRestore = join(stateDir, "previous.tmux");
  const renameRestore = join(stateDir, "rename.previous.tmux");
  await writeFile(returnRestore, "");
  await writeFile(renameRestore, "");
  await writeFile(join(stateDir, "active.json"), JSON.stringify({
    ownerPid: process.pid,
    controlSession: "pi-agent-hub",
    targetSession: "pi-agent-hub-api",
    returnKey: "C-q",
    restorePath: returnRestore,
    keyBindings: [
      { key: "C-q", restorePath: returnRestore },
      { key: "M-r", restorePath: renameRestore },
    ],
  }));
}

test("startup restores managed chrome before immediately adopting inherited panes", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  value.exec.ownWidth = 70;

  await startAndSettle(value);

  assert.ok(eventIndex(value.events, "sync:") < eventIndex(value.events, "inspect:panes"));
  assert.ok(eventIndex(value.events, "resize:60") < eventIndex(value.events, "title:%2:[1] API"));
  assert.ok(eventIndex(value.events, "status:pi-agent-hub:off") < eventIndex(value.events, "status:pi-agent-hub-api:off"));
  assert.ok(eventIndex(value.events, "status:pi-agent-hub-api:off") < eventIndex(value.events, "render"));
  assert.deepEqual(value.lifecycle.snapshot(), {
    slots: ["pi-agent-hub-api", undefined, undefined, undefined],
    dashboardStatusVisible: false,
  });
});

test("presence reconciliation repairs changed titles without repeating stable writes", async (t) => {
  const value = await harness(t, {
    initialPanes: [{ session: "pi-agent-hub-api", slot: 1, title: "[1] API" }],
    presenceIntervalMs: 5,
  });
  await startAndSettle(value);
  value.events.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(value.events.some((event) => event.startsWith("title:")), false);

  value.exec.ownTitle = "changed sidebar";
  value.exec.panes[0]!.title = "changed panel";
  await waitFor(() => value.events.includes("title:%1:") && value.events.includes("title:%2:[1] API"));
  value.events.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(value.events.some((event) => event.startsWith("title:")), false);
});

test("presence reconciliation restores removed footers before hiding additions and renders the committed state", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.assign("docs", 1), { kind: "retargeted", slot: 1 });

  const restored = eventIndex(value.events, "status:pi-agent-hub-api:on");
  const hidden = eventIndex(value.events, "status:pi-agent-hub-docs:off");
  const rendered = eventIndex(value.events, "render");
  assert.ok(restored < hidden && hidden < rendered);
  assert.deepEqual(value.lifecycle.snapshot().slots, ["pi-agent-hub-docs", undefined, undefined, undefined]);
  assert.ok(rendered < eventIndex(value.events, "managed:docs:off"));
});

test("assigning a session to its current slot closes the panel", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.assign("api", 1), { kind: "closed" });

  assert.ok(value.events.includes("render"));
  assert.equal(value.events.some((event) => event.startsWith("managed:")), false);
  assert.deepEqual(value.lifecycle.snapshot().slots, [undefined, undefined, undefined, undefined]);
});

test("assign acknowledges waiting before first-panel chrome and opens with actual tmux operations", async (t) => {
  const waiting = managedSession("api", "waiting");
  const value = await harness(t, { sessions: [waiting] });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.assign("api", 4), { kind: "opened", slot: 4 });

  assert.ok(eventIndex(value.events, "ack:api") < eventIndex(value.events, "status:pi-agent-hub:off"));
  assert.ok(eventIndex(value.events, "status:pi-agent-hub:off") < eventIndex(value.events, "split:pi-agent-hub-api"));
  assert.ok(eventIndex(value.events, "split:pi-agent-hub-api") < eventIndex(value.events, "focus:%1"));
  assert.deepEqual(value.lifecycle.snapshot().slots, [undefined, undefined, undefined, "pi-agent-hub-api"]);
  assert.equal(value.exec.ownActive, true);
});

test("close rebuilds survivors, restores the removed footer, and commits sparse state", async (t) => {
  const value = await harness(t, {
    initialPanes: [
      { session: "pi-agent-hub-api", slot: 1 },
      { session: "pi-agent-hub-docs", slot: 4 },
    ],
  });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.close(4), { kind: "closed" });

  assert.equal(value.events.filter((event) => event.startsWith("kill:")).length, 2);
  assert.ok(value.events.includes("split:pi-agent-hub-api"));
  assert.ok(value.events.includes("status:pi-agent-hub-docs:on"));
  assert.deepEqual(value.lifecycle.snapshot().slots, ["pi-agent-hub-api", undefined, undefined, undefined]);
  assert.ok(value.events.includes("render"));
});

test("closing the final pane restores dashboard chrome, bindings, and the managed footer", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.close(1), { kind: "closed" });

  assert.ok(value.events.includes("status:pi-agent-hub:on"));
  assert.ok(value.events.includes("border:off"));
  assert.ok(value.events.includes("unbind:C-q"));
  assert.ok(value.events.includes("status:pi-agent-hub-api:on"));
  assert.ok(value.events.includes("render"));
  assert.deepEqual(value.lifecycle.snapshot(), {
    slots: [undefined, undefined, undefined, undefined],
    dashboardStatusVisible: true,
  });
});

test("focus remains serialized and usable after a rejected operation", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 4 }] });
  await startAndSettle(value);
  value.events.length = 0;

  await assert.rejects(() => value.lifecycle.assign("missing", 1), /session not found/);
  assert.deepEqual(await value.lifecycle.focus(4), { kind: "focused" });

  assert.ok(value.events.includes("focus:%2"));
});

test("a failed first open with no surviving pane rolls panel chrome back and preserves the original error", async (t) => {
  const value = await harness(t);
  await startAndSettle(value);
  value.events.length = 0;
  value.exec.splitFailure = { afterCreate: false, error: new Error("split failed") };

  await assert.rejects(() => value.lifecycle.assign("api", 1), /split failed/);

  assert.ok(eventIndex(value.events, "status:pi-agent-hub:off") < eventIndex(value.events, "status:pi-agent-hub:on"));
  assert.ok(eventIndex(value.events, "border:top") < eventIndex(value.events, "border:off"));
  assert.deepEqual(value.lifecycle.snapshot().slots, [undefined, undefined, undefined, undefined]);
  assert.equal(value.lifecycle.snapshot().dashboardStatusVisible, true);
});

test("a failed first open keeps panel mode and bindings when tmux reports a surviving pane", async (t) => {
  const value = await harness(t);
  await startAndSettle(value);
  value.events.length = 0;
  value.exec.splitFailure = { afterCreate: true, error: new Error("attach failed") };

  await assert.rejects(() => value.lifecycle.assign("api", 1), /attach failed/);

  assert.deepEqual(value.lifecycle.snapshot().slots, ["pi-agent-hub-api", undefined, undefined, undefined]);
  assert.equal(value.lifecycle.snapshot().dashboardStatusVisible, false);
  assert.equal(value.events.includes("status:pi-agent-hub:on"), false);
  assert.equal(value.events.includes("border:off"), false);
  assert.ok(value.events.includes("bind:C-q"));
});

test("too-narrow first assignment restores normal dashboard chrome without opening a pane", async (t) => {
  const value = await harness(t, { windowWidth: 80 });
  await startAndSettle(value);
  value.events.length = 0;

  assert.deepEqual(await value.lifecycle.assign("api", 1), { kind: "too-narrow", panels: 1 });

  assert.equal(value.events.some((event) => event.startsWith("split:")), false);
  assert.ok(value.events.includes("status:pi-agent-hub:on"));
  assert.ok(value.events.includes("border:off"));
  assert.equal(value.lifecycle.snapshot().dashboardStatusVisible, true);
});

test("handoff restores managed chrome before switching and keeps the matching panel", async (t) => {
  const value = await harness(t, {
    initialPanes: [
      { session: "pi-agent-hub-api", slot: 1 },
      { session: "pi-agent-hub-docs", slot: 4 },
    ],
  });
  await startAndSettle(value);
  value.events.length = 0;
  value.exec.commands.length = 0;

  await value.lifecycle.handoff("pi-agent-hub-api");

  const managed = eventIndex(value.events, "managed:api:on");
  const unbound = eventIndex(value.events, "unbind:C-q");
  const switched = eventIndex(value.events, "switch:pi-agent-hub-api");
  assert.ok(managed < unbound && unbound < switched);
  assert.equal(value.events.some((event) => event.startsWith("kill:")), false);
  assert.deepEqual(value.lifecycle.snapshot().slots, ["pi-agent-hub-api", undefined, undefined, "pi-agent-hub-docs"]);
  assert.ok(value.exec.commands.includes("switch-client -c /dev/ttys001 -t pi-agent-hub-api"));
  assert.ok(value.exec.commands.includes("resize-window -t pi-agent-hub-api -x 160 -y 59"));
  assert.ok(value.exec.commands.includes("set-option -w -t pi-agent-hub-api window-size latest"));
  const returnBinding = value.exec.commands.find((command) => command.startsWith("bind-key -n C-q "));
  const renameBinding = value.exec.commands.find((command) => command.startsWith("bind-key -n M-r "));
  assert.match(returnBinding ?? "", /pi-agent-hub tui/);
  assert.match(returnBinding ?? "", /\/repo\/dashboard/);
  assert.match(returnBinding ?? "", /PI_AGENT_HUB_DIR/);
  assert.match(returnBinding ?? "", /\/tmp\/hub/);
  assert.match(renameBinding ?? "", /dashboard-action\.json/);
});

test("detach closes only the panel showing the target session", async (t) => {
  const value = await harness(t, {
    initialPanes: [
      { session: "pi-agent-hub-api", slot: 1 },
      { session: "pi-agent-hub-docs", slot: 4 },
    ],
  });
  await startAndSettle(value);
  value.events.length = 0;

  assert.equal(await value.lifecycle.detach("pi-agent-hub-api"), true);

  assert.ok(value.events.includes("kill:%2"));
  assert.equal(value.events.includes("kill:%3"), false);
  assert.deepEqual(value.lifecycle.snapshot().slots, [undefined, undefined, undefined, "pi-agent-hub-docs"]);
});

test("handoff preserves the full-screen binding and resumes presence after reset failure", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  value.events.length = 0;
  value.exec.commands.length = 0;
  value.exec.failCommand = (args) => args.join(" ") === "set-option -w -t pi-agent-hub-api window-size latest"
    ? new Error("reset failed")
    : undefined;

  await assert.rejects(() => value.lifecycle.handoff("pi-agent-hub-api"), /reset failed/);
  await access(join(value.switchStateDir, "active.json"));
  await waitFor(() => value.events.includes("inspect:panes"));

  assert.ok(value.events.includes("switch:pi-agent-hub-api"));
  assert.equal(value.events.includes("kill:%2"), false);
  value.exec.failCommand = undefined;
});

test("theme hooks keep border preview separate from queued managed-session synchronization", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  value.events.length = 0;

  value.lifecycle.refreshPanelChrome();
  value.lifecycle.syncOpenSessionChrome();
  await waitFor(() => value.events.includes("sync:pi-agent-hub-api"));

  assert.ok(eventIndex(value.events, "border:top") < eventIndex(value.events, "sync:pi-agent-hub-api"));
  assert.equal(value.events.some((event) => event.startsWith("managed:")), false);
});

test("teardown restores both bindings then continues past footer failure through pane and chrome cleanup", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  await startAndSettle(value);
  await seedSwitchBinding(value.switchStateDir);
  value.events.length = 0;
  value.exec.commands.length = 0;
  value.exec.failCommand = (args) => args.join(" ") === "set-option -t pi-agent-hub-api status on"
    ? new Error("footer failed")
    : undefined;

  await value.lifecycle.stop();

  const firstReturnUnbind = eventIndex(value.events, "unbind:C-q");
  const renameUnbind = eventIndex(value.events, "unbind:M-r");
  const sidebarReturnUnbind = value.events.indexOf("unbind:C-q", firstReturnUnbind + 1);
  assert.ok(firstReturnUnbind < renameUnbind && renameUnbind < sidebarReturnUnbind);
  const footerAttempt = value.exec.commands.indexOf("set-option -t pi-agent-hub-api status on");
  const killed = eventIndex(value.events, "kill:%2");
  const dashboardShown = eventIndex(value.events, "status:pi-agent-hub:on");
  const borderCleared = eventIndex(value.events, "border:off");
  assert.ok(sidebarReturnUnbind < footerAttempt && footerAttempt < killed && killed < dashboardShown && dashboardShown < borderCleared);
  await assert.rejects(() => access(join(value.switchStateDir, "active.json")));
  await assert.rejects(() => access(join(value.sidebarStateDir, "active.json")));
});

test("stop waits for a close intent that is still draining presence", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  const gate = deferred<CommandResult>();
  value.exec.nextListPanes = gate.promise;
  value.lifecycle.start();
  await waitFor(() => value.events.includes("inspect:panes"));

  const closing = value.lifecycle.close(1).then((result) => {
    value.events.push("close:done");
    return result;
  });
  await seedSwitchBinding(value.switchStateDir);
  const stopping = value.lifecycle.stop();
  gate.resolve({ stdout: value.exec.paneOutput(), stderr: "" });

  assert.deepEqual(await closing, { kind: "closed" });
  await stopping;
  assert.ok(eventIndex(value.events, "close:done") < eventIndex(value.events, "unbind:M-r"));
});

test("stop drains an in-flight presence refresh and performs teardown only once", async (t) => {
  const value = await harness(t, { initialPanes: [{ session: "pi-agent-hub-api", slot: 1 }] });
  const gate = deferred<CommandResult>();
  value.exec.nextListPanes = gate.promise;
  value.lifecycle.start();
  await waitFor(() => value.events.includes("inspect:panes"));

  let stopped = false;
  const first = value.lifecycle.stop().then(() => { stopped = true; });
  const second = value.lifecycle.stop();
  assert.deepEqual(await value.lifecycle.close(1), { kind: "unavailable" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);

  gate.resolve({ stdout: value.exec.paneOutput(), stderr: "" });
  await Promise.all([first, second]);

  assert.equal(stopped, true);
  assert.ok(value.events.includes("status:pi-agent-hub-api:on"));
  assert.ok(value.events.includes("kill:%2"));
  assert.ok(value.events.includes("status:pi-agent-hub:on"));
  assert.ok(value.events.includes("border:off"));
  const commandCount = value.events.length;
  await value.lifecycle.stop();
  assert.equal(value.events.length, commandCount);
});
