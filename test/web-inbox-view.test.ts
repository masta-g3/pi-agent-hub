import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../src/tui/theme.js";
import type { ManagedSession } from "../src/core/types.js";
import type { WebInboxActions } from "../src/tui/dialog.js";

const PUBLISHED = "https://rpotec-mini.taila4d4da.ts.net";
const row: ManagedSession = { id: "api", title: "api", cwd: "/repo/api", group: "default", tmuxSession: "pi-agent-hub-api", status: "idle", createdAt: 1, updatedAt: 1 };

function webView(options: { ports?: number[]; autostart?: boolean; start?: WebInboxActions["start"]; stop?: WebInboxActions["stop"]; sessions?: ManagedSession[]; address?: WebInboxActions["address"]; openAddress?: WebInboxActions["openAddress"]; rows?: number; copies?: string[] } = {}) {
  const events: string[] = [];
  let ports = options.ports ?? [];
  let autostart = options.autostart ?? false;
  const web: WebInboxActions = {
    ports: () => ports,
    start: options.start ?? (async () => { events.push("start"); ports = [4747]; return { port: 4747 }; }),
    stop: options.stop ?? (async () => { events.push("stop"); const stopped = ports.length; ports = []; return stopped; }),
    autostart: () => autostart,
    setAutostart: async (next) => { events.push(`autostart:${next}`); autostart = next; },
    address: options.address ?? (async () => (ports.length ? { address: PUBLISHED, published: true, port: ports[0]! } : undefined)),
    ...(options.openAddress ? { openAddress: options.openAddress } : {}),
  };
  const controller = new SessionsController({ version: 1, sessions: options.sessions ?? [row] });
  const view = new SessionsView(controller, () => {}, {
    webInbox: web,
    terminalRows: () => options.rows ?? 40,
    ...(options.copies ? { copy: (text: string) => { options.copies!.push(text); } } : {}),
  });
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

const settle = () => new Promise((done) => setImmediate(done));
const QR_SGR = "\u001b[38;2;0;0;0;48;2;255;255;255m";

async function openDialog(view: SessionsView, width = 100): Promise<string[]> {
  await palette(view, "phone inbox address");
  await settle();
  return view.render(width);
}

test("the address dialog shows a published address with a black-on-white QR code and copies it", async () => {
  const copies: string[] = [];
  const { view } = webView({ ports: [4747], copies });
  const lines = await openDialog(view);
  const text = stripAnsi(lines.join("\n"));
  assert.match(text, /Phone inbox/u);
  assert.match(text, /https:\/\/rpotec-mini\.taila4d4da\.ts\.net/u);
  assert.match(text, /Scan with the phone camera\./u);
  // Version 3 plus the quiet zone: 37 columns, 19 lines.
  const qr = lines.filter((line) => line.includes(QR_SGR));
  assert.equal(qr.length, 19);
  // The colored span is the code, quiet zone included.
  for (const line of qr) assert.equal(visibleWidth(line.slice(line.indexOf(QR_SGR) + QR_SGR.length, line.indexOf("\u001b[0m", line.indexOf(QR_SGR)))), 37);
  assert.deepEqual(copies, [PUBLISHED]);
  assert.doesNotMatch(text, /copied/iu);
});

test("the QR code shows only when the whole dialog fits; the footer always stays", async () => {
  for (const [width, rows, shown] of [[39, 27, true], [38, 27, false], [39, 26, false]] as const) {
    const { view } = webView({ ports: [4747], rows });
    const lines = await openDialog(view, width);
    const text = stripAnsi(lines.join("\n"));
    assert.equal(lines.some((line) => line.includes(QR_SGR)), shown, `${width}x${rows}`);
    if (!shown) assert.match(text, /Enlarge for QR code/u, `${width}x${rows}`);
    assert.match(text, /Esc Close/u, `${width}x${rows}`);
    assert.ok(lines.length <= rows, `${width}x${rows}: ${lines.length} rows`);
  }
});

test("an unpublished inbox shows the local address and how to publish it, without a QR code", async () => {
  const { view } = webView({ ports: [4747], address: async () => ({ address: "http://127.0.0.1:4747", published: false, port: 4747 }) });
  const lines = await openDialog(view);
  const text = stripAnsi(lines.join("\n"));
  assert.match(text, /http:\/\/127\.0\.0\.1:4747/u);
  assert.match(text, /Not published to your phone\./u);
  assert.match(text, /Run: tailscale serve --bg 4747/u);
  assert.ok(!lines.some((line) => line.includes(QR_SGR)));
});

test("NO_COLOR shows no QR code and says why", async () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const { view } = webView({ ports: [4747] });
    const lines = await openDialog(view);
    assert.ok(!lines.some((line) => line.includes(QR_SGR)));
    assert.match(stripAnsi(lines.join("\n")), /needs color/u);
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved;
  }
});

test("o opens the exact address once, reports the result in the dialog, and Esc closes", async () => {
  const opened: string[] = [];
  let finish!: (error?: Error) => void;
  const { view } = webView({ ports: [4747], openAddress: (address) => { opened.push(address); return new Promise((done, fail) => { finish = (error) => (error ? fail(error) : done()); }); } });
  await openDialog(view);
  view.handleInput("o");
  view.handleInput("o");
  assert.deepEqual(opened, [PUBLISHED]);
  assert.match(frame(view), /Opening in browser/u);
  finish();
  await settle();
  assert.match(frame(view), /Opened in browser/u);
  assert.match(frame(view), /o Open in browser · Esc Close/u);
  view.handleInput("\u001b");
  assert.doesNotMatch(frame(view), /Phone inbox\n/u);
  assert.doesNotMatch(frame(view), /Scan with the phone camera/u);
});

test("a failed open shows its error in the dialog, also for a local address", async () => {
  for (const published of [true, false]) {
    const { view } = webView({
      ports: [4747],
      address: async () => ({ address: published ? PUBLISHED : "http://127.0.0.1:4747", published, port: 4747 }),
      openAddress: async () => { throw new Error("open: no browser"); },
    });
    await openDialog(view);
    view.handleInput("o");
    await settle();
    const text = frame(view);
    assert.match(text, /open: no browser/u, String(published));
    assert.match(text, /Esc Close/u, String(published));
  }
});

test("a browser result after the dialog closed changes nothing", async () => {
  let finish!: () => void;
  const { view } = webView({ ports: [4747], openAddress: () => new Promise((done) => { finish = done; }) });
  await openDialog(view);
  view.handleInput("o");
  view.handleInput("\u001b");
  finish();
  await settle();
  assert.doesNotMatch(frame(view), /Opened in browser|Phone inbox\b.*\n.*https/su);
});

test("without a browser action the footer offers no o, and dashboard keys are consumed", async () => {
  const { view, events } = webView({ ports: [4747] });
  await openDialog(view);
  assert.doesNotMatch(frame(view), /o Open in browser/u);
  for (const key of ["d", "x", "q", "o"]) view.handleInput(key);
  assert.match(frame(view), /Scan with the phone camera/u);
  assert.deepEqual(events, []);
});

test("the address entry appears only while a server runs, and a vanished server reports off", async () => {
  const off = webView();
  assert.doesNotMatch(await palette(off.view, "phone inbox address"), /Phone inbox address/u);
  const gone = webView({ ports: [4747], address: async () => undefined });
  await openDialog(gone.view);
  assert.match(frame(gone.view), /phone inbox off/u);
  assert.doesNotMatch(frame(gone.view), /Scan with/u);
});

test("a lookup that finishes after another dialog opened neither copies nor replaces it", async () => {
  const copies: string[] = [];
  let finish!: (value: { address: string; published: boolean; port: number }) => void;
  const { view } = webView({ ports: [4747], copies, address: () => new Promise((done) => { finish = done; }) });
  view.render(100);
  view.handleInput(":");
  for (const char of "phone inbox address") view.handleInput(char);
  view.handleInput("\r");
  await settle();
  // In-session Alt+R hands the dashboard a Rename while the lookup still runs.
  assert.ok(view.openRenameForTmuxSession(row.tmuxSession));
  finish({ address: PUBLISHED, published: true, port: 4747 });
  await settle();
  assert.deepEqual(copies, []);
  const text = frame(view);
  assert.doesNotMatch(text, /Scan with the phone camera/u);
  assert.match(text, /Rename/u);
});

test("Esc during the lookup, or another dialog opened and closed meanwhile, discards the result", async () => {
  for (const interrupt of ["escape", "rename-and-close"] as const) {
    const copies: string[] = [];
    let finish!: (value: { address: string; published: boolean; port: number }) => void;
    const { view } = webView({ ports: [4747], copies, address: () => new Promise((done) => { finish = done; }) });
    await palette(view, "phone inbox address");
    assert.match(frame(view), /Reading the phone inbox address/u, interrupt);
    if (interrupt === "escape") view.handleInput("\u001b");
    else {
      assert.ok(view.openRenameForTmuxSession(row.tmuxSession));
      view.handleInput("\u001b");
    }
    finish({ address: PUBLISHED, published: true, port: 4747 });
    await settle();
    assert.deepEqual(copies, [], interrupt);
    assert.doesNotMatch(frame(view), /Phone inbox\b|Scan with the phone camera/u, interrupt);
  }
});

test("a multiline browser error stays on one line inside the frame", async () => {
  const { view } = webView({ ports: [4747], openAddress: async () => { throw Object.assign(new Error("Command failed: open"), { stderr: "LSOpenURLsWithRole() failed\nwith error -10814\n" }); } });
  await openDialog(view);
  view.handleInput("o");
  await settle();
  const lines = view.render(100).map(stripAnsi);
  assert.ok(lines.some((line) => line.includes("LSOpenURLsWithRole() failed with error -10814")));
  const top = lines.findIndex((line) => line.startsWith("╭"));
  const bottom = lines.findIndex((line) => line.startsWith("╰"));
  for (const line of lines.slice(top + 1, bottom)) assert.match(line, /^│.*│$/u);
});

test("very short windows keep the address and the footer", async () => {
  for (const rows of [10, 8, 7, 6]) {
    for (const published of [true, false]) {
      const { view } = webView({ ports: [4747], rows, address: async () => ({ address: published ? PUBLISHED : "http://127.0.0.1:4747", published, port: 4747 }) });
      const lines = await openDialog(view);
      const text = stripAnsi(lines.join("\n"));
      assert.ok(lines.length <= rows, `${rows} ${published}: ${lines.length}`);
      assert.match(text, /Esc Close/u, `${rows} ${published}`);
      assert.match(text, /(https:\/\/rpotec|http:\/\/127)/u, `${rows} ${published}`);
    }
  }
});
