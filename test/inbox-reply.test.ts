import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mkdtemp, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { startSessionInteraction } from "../src/extension/session-interaction.js";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { DELIVERY_UNCONFIRMED, requestSessionInteraction, type MessageDelivery, type SessionInteractionState } from "../src/core/session-interaction.js";
import type { RuntimeSession } from "../src/core/types.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { dashboardFooter } from "../src/tui/dashboard-commands.js";
import { stripAnsi } from "../src/tui/theme.js";

const session: RuntimeSession = { id: "s", title: "Dashboard UI polish", cwd: "/tmp/repo", group: "cards", tmuxSession: "s", status: "waiting", piSessionId: "pi-s", interaction: { version: 1, instanceId: "instance" }, createdAt: 1, updatedAt: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
const type = (view: SessionsView, value: string) => { for (const char of value) view.handleInput(char); };
const text = (view: SessionsView, width = 80) => stripAnsi(view.render(width).join("\n"));
async function setup(options: { busy?: boolean; error?: string; ready?: boolean; host?: string; height?: number } = {}) {
  const selected = structuredClone(session);
  if (options.ready) selected.context = { version: 1, updatedAt: 1, attention: { kind: "ready", text: "Review the change", recommendation: "Run the checks", requestId: "r" } };
  const controller = new SessionsController({ version: 1, sessions: [selected] });
  const sent: { target: unknown; message: string; delivery: MessageDelivery }[] = [];
  let delivery: "idle" | "busy" = options.busy ? "busy" : "idle";
  let now = 1;
  const view = new SessionsView(controller, () => { throw new Error("global quit fired"); }, {
    terminalRows: () => options.height ?? 24, interactionTarget, now: () => now,
    loadInteractionState: async () => ({ questionProtocol: true, pending: [], messageDelivery: delivery }),
    sendMessage: async (target, message, mode) => { sent.push({ target, message, delivery: mode }); if (options.error) throw new Error(options.error); },
    ...(options.host?.startsWith("board") ? { initialViewState: { grouping: "stage" as const } } : {}),
    ...(options.host === "pin" || options.host === "follow" ? { sidePaneState: () => ({ slots: [session.id], capacity: 2, constrained: false, splitPercent: 50, following: options.host === "follow" }) } : {}),
  });
  view.render(80); await view.refreshInteraction();
  return { view, controller, sent, busy: async () => { delivery = "busy"; now += 2000; await view.refreshInteraction(); } };
}

test("p opens the shared card editor; literal keys and paste submit to the exact idle parent", async () => {
  const { view, sent } = await setup();
  view.handleInput("p");
  assert.match(text(view), /REPLY · Dashboard UI polish · Send/);
  assert.match(text(view), /Enter Send.*Esc Keep draft/);
  assert.doesNotMatch(text(view), /Send to|Esc Cancel/);
  type(view, "qj:pS"); view.handleInput("\u001b[200~\nhello\tworld\u001b[201~");
  view.handleInput("\r"); await tick();
  assert.deepEqual(sent, [{ target: interactionTarget(session), message: "qj:pS hello world", delivery: "send" }]);
  assert.match(text(view), /Accepted · Sent/);
  view.handleInput("p"); assert.doesNotMatch(text(view), /qj:pS/);
});

test("ready handoff context stays visible above the focused reply editor", async () => {
  const { view } = await setup({ ready: true });
  view.handleInput("p");
  const rendered = text(view, 80);
  assert.match(rendered, /→ Run the checks/);
  assert.match(rendered, /Go ahead: Run the checks█/);
});

test("blank input stays focused; Esc preserves edited and intentionally empty drafts", async () => {
  const { view, sent } = await setup({ ready: true });
  view.handleInput("p"); assert.match(text(view), /Go ahead: Run the checks█/); assert.equal(sent.length, 0);
  view.handleInput("\u0015"); view.handleInput("\r"); assert.match(text(view), /message is required/);
  view.handleInput("\u001b"); view.handleInput("p"); assert.doesNotMatch(text(view), /Go ahead:/);
  type(view, "draft"); view.handleInput("\u001b"); view.handleInput("p"); assert.match(text(view), /draft█/);
  assert.equal(sent.length, 0);
});

test("ready prefill sends only on Enter and accepted draft is cleared without a second prefill", async () => {
  const { view, sent } = await setup({ ready: true });
  view.handleInput("p"); assert.equal(sent.length, 0);
  view.handleInput("\r"); await tick(); assert.equal(sent[0]?.message, "Go ahead: Run the checks");
  view.handleInput("p"); assert.doesNotMatch(text(view), /Go ahead:/);
});

for (const queue of [false, true]) test(`busy reply ${queue ? "queues" : "steers"} literal text`, async () => {
  const { view, sent } = await setup({ busy: true });
  view.handleInput("p"); type(view, "/template literal");
  assert.match(text(view), /Use before the next model call, after current tools/);
  if (queue) { view.handleInput("\t"); view.handleInput("\u001b[C"); view.handleInput("x"); }
  assert.match(text(view), queue ? /Queue for later/ : /Steer now/);
  view.handleInput("\r"); await tick();
  assert.equal(sent[0]?.delivery, queue ? "followUp" : "steer"); assert.equal(sent[0]?.message, "/template literal");
  assert.match(text(view), queue ? /Accepted · Queued/ : /Accepted · Steer requested/);
});

test("idle to busy rejects without a send, keeps draft, and requires an explicit resubmit", async () => {
  const { view, sent, busy } = await setup(); view.handleInput("p"); type(view, "keep me"); await busy();
  view.handleInput("\r"); await tick();
  assert.equal(sent.length, 0);
  assert.match(text(view, 120), /Rejected · Pi started working; choose Steer now or Queue for later/);
  assert.match(text(view), /keep me█/);
  view.handleInput("\t"); view.handleInput("\u001b[C"); view.handleInput("\r"); await tick();
  assert.equal(sent[0]?.delivery, "followUp");
});

for (const field of ["instanceId", "piSessionId"] as const) test(`${field} replacement invalidates the draft permanently`, async () => {
  const { view, controller, sent } = await setup(); view.handleInput("p"); type(view, "private draft"); view.handleInput("\u001b");
  const row = controller.snapshot().sessions[0]!;
  if (field === "instanceId") row.interaction = { version: 1, instanceId: "replacement" }; else row.piSessionId = "replacement";
  text(view); await view.refreshInteraction(); view.handleInput("p");
  assert.doesNotMatch(text(view), /private draft/); assert.equal(sent.length, 0);
});

test("drafts never move to another selected parent and restore only on the original target", async () => {
  const { view, controller, sent } = await setup(); view.handleInput("p"); type(view, "original draft");
  const other = { ...session, id: "other", title: "Other", piSessionId: "other-pi" };
  controller.snapshot().registry.sessions.push(other);
  controller.selectSession("other"); text(view); await view.refreshInteraction(); view.handleInput("p");
  assert.doesNotMatch(text(view), /original draft/); view.handleInput("\u001b");
  controller.selectSession("s"); await view.refreshInteraction(); view.handleInput("p"); assert.match(text(view), /original draft█/); assert.equal(sent.length, 0);
});

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"]) test(`p uses the shared panel in ${host}`, async () => {
  const { view } = await setup({ host }); view.handleInput("p");
  assert.match(text(view, host === "board-phone" ? 60 : 160), /REPLY/);
  type(view, "local"); assert.match(text(view, host === "board-phone" ? 60 : 160), /local█/);
});

for (const width of [80, 60, 30]) for (const busy of [false, true]) test(`reply fits ${width} columns (${busy ? "busy" : "idle"}) with a horizontal input`, async () => {
  const { view } = await setup({ busy, height: 24 }); view.handleInput("p"); type(view, "界".repeat(100));
  const rows = view.render(width); const rendered = stripAnsi(rows.join("\n"));
  assert.match(rendered, /REPLY/); assert.match(rendered, /….*█/); assert.match(rendered, /Enter (Send|Steer)/);
  assert.ok(rows.length <= 24); for (const row of rows) assert.ok(visibleWidth(row) <= width, row);
  assert.equal(rendered.split("\n").filter(line => line.includes("界")).length, 1);
});

for (const width of [30, 59, 60, 80]) for (const busy of [false, true]) test(`reply header preserves identity once at ${width} columns (${busy ? "busy" : "idle"})`, async () => {
  const { view } = await setup({ busy }); view.handleInput("p");
  const rendered = text(view, width);
  const header = rendered.split("\n").find(line => line.includes("REPLY"))!;
  assert.match(header, width < 60 ? new RegExp(`REPLY · ${busy ? "Steer now" : "Send"}`) : new RegExp(`REPLY · Dashboard UI polish · ${busy ? "Steer now" : "Send"}`));
  if (width < 60) assert.doesNotMatch(header, /Dashboard UI polish/);
});

test("30-column busy controls use the deck's complete reserved key rows, including after scrolling", async () => {
  const { view } = await setup({ busy: true, height: 12 }); view.handleInput("p");
  type(view, "local draft");
  const keys = ["Tab Delivery", "←/→ Steer/Queue", "Enter Steer now", "Esc Keep draft"];
  const rows = () => view.render(30).map(stripAnsi).map(line => line.trim());
  assert.ok(rows().includes("REPLY · Steer now"));
  for (const key of keys) assert.ok(rows().includes(key), key);
  view.handleInput("\u001b[6~");
  for (const key of keys) assert.ok(rows().includes(key), key);
  view.handleInput("\t"); view.handleInput("\u001b[C");
  assert.ok(rows().includes("REPLY · Queue for later"));
  assert.ok(rows().includes("Enter Queue for later"));
});

test("30-column fleet reply reserves its retained receipt ahead of optional card context", async () => {
  const { view, controller } = await setup({ busy: true, ready: true, error: DELIVERY_UNCONFIRMED, height: 12 });
  controller.snapshot().sessions[0]!.context!.ticket = { id: "cards-004", subtitle: "A long task subtitle that competes with the retained delivery receipt" };
  view.handleInput("p"); type(view, "keep this"); view.handleInput("\r"); await tick();
  const rendered = text(view, 30);
  assert.match(rendered, /Delivery unknown · Check Pi/);
  assert.match(rendered, /Enter Steer now/);
});

for (const [error, expected] of [["Producer refused", /Rejected · Producer refused/], [DELIVERY_UNCONFIRMED, /Delivery unknown · Check Pi before retrying/]] as const) test(`reply retains draft and receipt: ${error}`, async () => {
  const { view } = await setup({ error }); view.handleInput("p"); type(view, "keep this"); view.handleInput("\r"); await tick();
  assert.match(text(view, 120), expected); assert.match(text(view), /keep this█/);
  view.handleInput("\u001b"); assert.match(text(view, 120), expected); view.handleInput("p"); assert.match(text(view), /keep this█/);
});

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"]) test(`reply uses the shared receipt without a second panel-owned copy in ${host}`, async () => {
  const { view } = await setup({ host, error: "Producer refused" });
  view.handleInput("p"); type(view, "keep this"); view.handleInput("\r"); await tick();
  const rendered = text(view, host === "board-phone" || host === "fleet" ? 60 : 160);
  const receipts = rendered.match(/Rejected · Producer refused/g) ?? [];
  assert.equal(receipts.length, host === "board-wide" ? 2 : 1, "wide board retains its card receipt and its separate action-panel receipt");
});

for (const width of [160, 120, 80, 60, 30]) test(`footer puts Reply after Next at ${width}`, () => {
  assert.match(dashboardFooter(width), width === 30 ? /^\] Next · p Reply · : Actions/ : /^\] Next request · p Reply · : All actions/);
});

test("card replies reach the real guarded socket: idle expands, busy stays literal, and an unobserved busy race rejects", async () => {
  const dir = await mkdtemp("/tmp/inbox-reply.");
  const env = { PI_AGENT_HUB_DIR: dir };
  const events = new EventEmitter();
  let idle = true;
  const nativeDraft = "Untouched Pi editor draft";
  const received: unknown[] = [];
  const server = await startSessionInteraction({ managedId: session.id, piSessionId: session.piSessionId!, env,
    events: { on: (name, fn) => { events.on(name, fn); return () => { events.off(name, fn); }; }, emit: (name, value) => { events.emit(name, value); } },
    getPiSessionId: () => session.piSessionId!, getBranch: () => [], isIdle: () => idle, hasPendingMessages: () => false,
    getEditorText: () => nativeDraft, uiPromptOpen: () => false,
    sendUserMessage: (message, options) => { received.push({ message, options }); },
  });
  try {
    const live: RuntimeSession = { ...session, interaction: { version: 1, instanceId: server.target.instanceId } };
    const controller = new SessionsController({ version: 1, sessions: [live] });
    let now = 1;
    let completed: Promise<void> | undefined;
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 24, interactionTarget, now: () => now,
      loadInteractionState: async target => await requestSessionInteraction({ ...target, version: 1, id: crypto.randomUUID(), kind: "state" }, env) as SessionInteractionState,
      sendMessage: (target, message, delivery) => {
        completed = requestSessionInteraction({ ...target, version: 1, id: crypto.randomUUID(), kind: "send-message", text: message, delivery }, env).then(() => {});
        return completed;
      },
    });
    view.render(80); await view.refreshInteraction(); view.handleInput("p"); type(view, "/template idle"); view.handleInput("\r"); await completed; await tick();
    assert.match(text(view), /Accepted · Sent/);
    view.handleInput("p"); type(view, "/template busy"); idle = false; view.handleInput("\r");
    await assert.rejects(completed!, /Pi started working; choose Steer now or Queue for later/); await tick();
    assert.match(text(view, 120), /Rejected · Pi started working/);
    view.handleInput("\t"); view.handleInput("\u001b[C"); view.handleInput("\r"); await completed; await tick();
    now += 2000; await view.refreshInteraction(); view.handleInput("p"); type(view, "/template steer"); view.handleInput("\r"); await completed; await tick();
    assert.deepEqual(received, [
      { message: "/template idle", options: { deliverAs: "steer", expandPromptTemplates: true } },
      { message: "/template busy", options: { deliverAs: "followUp", expandPromptTemplates: false } },
      { message: "/template steer", options: { deliverAs: "steer", expandPromptTemplates: false } },
    ]);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});
