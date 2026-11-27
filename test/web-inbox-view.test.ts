import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";
import type { WebInboxActions } from "../src/tui/dialog.js";

const row: ManagedSession = { id: "api", title: "api", cwd: "/repo/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "idle", createdAt: 1, updatedAt: 1 };

function webView(options: { ports?: number[]; autostart?: boolean; start?: WebInboxActions["start"]; stop?: WebInboxActions["stop"]; sessions?: ManagedSession[] } = {}) {
  const events: string[] = [];
  let ports = options.ports ?? [];
  let autostart = options.autostart ?? false;
  const web: WebInboxActions = {
    ports: () => ports,
    start: options.start ?? (async () => { events.push("start"); ports = [4747]; return { port: 4747 }; }),
    stop: options.stop ?? (async () => { events.push("stop"); const stopped = ports.length; ports = []; return stopped; }),
    autostart: () => autostart,
    setAutostart: async (next) => { events.push(`autostart:${next}`); autostart = next; },
  };
  const controller = new SessionsController({ version: 1, sessions: options.sessions ?? [row] });
  const view = new SessionsView(controller, () => {}, { webInbox: web });
  return { view, events, setPorts: (next: number[]) => { ports = next; } };
}

async function palette(view: SessionsView, query: string): Promise<string> {
  view.render(100);
  view.handleInput(":");
  for (const char of query) view.handleInput(char);
  const shown = stripAnsi(view.render(100).join("\n"));
  view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  return shown;
}

const frame = (view: SessionsView) => stripAnsi(view.render(100).join("\n"));

test("palette starts the phone inbox when off and stops it when on", async () => {
  const { view, events } = webView();
  assert.match(await palette(view, "phone inbox"), /Phone inbox: Off/);
  assert.deepEqual(events, ["start"]);
  assert.match(frame(view), /phone inbox on 127\.0\.0\.1:4747/);
  assert.match(await palette(view, "phone inbox"), /Phone inbox: On/);
  assert.deepEqual(events, ["start", "stop"]);
  assert.match(frame(view), /phone inbox off/);
});

test("a stale entry is refused instead of reversing the state", async () => {
  // Shown Off, but a server came up (autostart) before Enter: the palette refuses, nothing is stopped or started.
  const started = webView();
  started.view.render(100);
  started.view.handleInput(":");
  for (const char of "phone inbox") started.view.handleInput(char);
  assert.match(frame(started.view), /Phone inbox: Off/);
  started.setPorts([4747]);
  started.view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(started.events, []);
  assert.match(frame(started.view), /command target changed/);

  // Shown On, but the server already exited: same refusal, no start.
  const gone = webView({ ports: [4747] });
  gone.view.render(100);
  gone.view.handleInput(":");
  for (const char of "phone inbox") gone.view.handleInput(char);
  gone.setPorts([]);
  gone.view.handleInput("\r");
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(gone.events, []);
});

test("stop reports when the server exited on its own meanwhile", async () => {
  const { view } = webView({ ports: [4747], stop: async () => 0 });
  await palette(view, "phone inbox");
  assert.match(frame(view), /phone inbox already off/);
});

test("a failed start shows its error and the dashboard keeps working", async () => {
  const { view } = webView({ start: async () => { throw new Error("phone inbox did not start; check tmux attach -t pi-hub-web"); } });
  await palette(view, "phone inbox");
  assert.match(frame(view), /phone inbox did not start/);
  view.handleInput("j");
  assert.ok(view.render(100).length > 0);
});

test("palette toggles the saved autostart setting", async () => {
  const { view, events } = webView();
  assert.match(await palette(view, "start phone inbox with"), /Start phone inbox with dashboard: Off/);
  assert.deepEqual(events, ["autostart:true"]);
  assert.match(frame(view), /start phone inbox with dashboard · On/);
});

test("the toggle works with no session to select", async () => {
  const { view, events } = webView({ sessions: [] });
  await palette(view, "phone inbox");
  assert.deepEqual(events, ["start"]);
});
