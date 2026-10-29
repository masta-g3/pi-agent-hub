import test from "node:test";
import assert from "node:assert/strict";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { stripAnsi } from "../src/tui/theme.js";
import { DELIVERY_UNCONFIRMED } from "../src/core/session-interaction.js";
import type { RuntimeSession } from "../src/core/types.js";

const session: RuntimeSession = { id: "s", title: "Request", cwd: "/tmp/repo", group: "cards", tmuxSession: "s", status: "waiting", piSessionId: "pi-s", interaction: { version: 1, instanceId: "instance" }, createdAt: 1, updatedAt: 1 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function text(view: SessionsView) { return stripAnsi(view.render(120).join("\n")); }
function send(view: SessionsView) { view.handleInput("p"); for (const ch of "Hello") view.handleInput(ch); view.handleInput("\r"); }

test("send result remains Accepted if interaction bookkeeping fails", async () => {
  const controller = new SessionsController({ version: 1, sessions: [session] });
  let accept!: () => void;
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget,
    loadInteractionState: async () => ({ questionProtocol: true, pending: [], messageDelivery: "idle" }),
    sendMessage: () => new Promise<void>(resolve => { accept = resolve; }),
    afterInteractionWrite: async () => { throw new Error("disk full"); },
  });
  view.render(120); await view.refreshInteraction(); send(view);
  assert.match(text(view), /Submitting…/);
  await tick(); accept(); await tick();
  assert.match(text(view), /Accepted · Sent/);
  assert.match(text(view), /Accepted, but activity update failed: disk full/);
});

test("shortcut receipt clears only on a new running transition and exact target changes invalidate it", async () => {
  const running = { ...session, status: "running" as const };
  const controller = new SessionsController({ version: 1, sessions: [running] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget,
    loadInteractionState: async () => ({ questionProtocol: true, pending: [] }),
    dashboardShortcuts: [{ key: "C-n", label: "Refresh", send: "/refresh" }], runDashboardShortcut: async () => {},
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\u000e"); await tick();
  assert.match(text(view), /Accepted · Refresh/);
  assert.match(text(view), /Accepted · Refresh/);
  controller.snapshot().sessions[0]!.status = "waiting"; text(view);
  controller.snapshot().sessions[0]!.status = "running";
  assert.doesNotMatch(text(view), /Accepted · Refresh/);
  view.handleInput("\u000e"); await tick(); assert.match(text(view), /Accepted · Refresh/);
  controller.snapshot().sessions[0]!.interaction = { version: 1, instanceId: "replacement" };
  assert.doesNotMatch(text(view), /Accepted · Refresh/);
});

test("Accepted clears when running is observed behind a modal", async () => {
  const controller = new SessionsController({ version: 1, sessions: [{ ...session, status: "waiting" }] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget });
  view.render(120);
  await view.writeInteraction(interactionTarget(controller.selected()!)!, "Message sent", () => {});
  assert.match(text(view), /Accepted · Message sent/);
  view.handleInput("?");
  controller.snapshot().sessions[0]!.status = "running";
  view.render(120);
  controller.snapshot().sessions[0]!.status = "waiting";
  view.render(120);
  view.handleInput("\u001b");
  assert.doesNotMatch(text(view), /Accepted · Message sent/);
});

test("an early-return narrow notice clears expanded-card action hits", async () => {
  const opened: string[] = [];
  const controller = new SessionsController({ version: 1, sessions: [session] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30,
    attachOutsideTmux: target => { opened.push(target); }, switchInsideTmux: target => { opened.push(target); },
    acknowledgeSession: async () => {},
  });
  const wide = view.render(120).map(stripAnsi);
  const row = wide.findIndex(line => line.includes("Enter Open in Pi"));
  assert.ok(row >= 0);
  const x = wide[row]!.indexOf("Enter Open in Pi") + 1;
  view.render(29);
  view.handleInput(`\u001b[<0;${x};${row + 1}M`);
  await tick();
  assert.deepEqual(opened, []);
});

test("writes time out once and do not resubmit while delivery is pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new SessionsController({ version: 1, sessions: [session] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget });
  let writes = 0;
  const pending = view.writeInteraction(interactionTarget(session)!, "Message sent", () => { writes += 1; return new Promise(() => {}); });
  const verdict = assert.rejects(pending, /Delivery not confirmed/);
  await assert.rejects(view.writeInteraction(interactionTarget(session)!, "Duplicate", () => { writes += 1; }), /write is submitting/);
  t.mock.timers.tick(5_000);
  await verdict;
  assert.equal(writes, 1);
  assert.match(text(view), /Delivery unknown · Check Pi before retrying/);
});

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"] as const) {
  test(`one panel API owns input and scrolling in ${host}`, () => {
    const controller = new SessionsController({ version: 1, sessions: [session] });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 22, interactionTarget,
      ...(host.startsWith("board") ? { initialViewState: { grouping: "stage" as const } } : {}),
      ...(host === "pin" || host === "follow" ? { sidePaneState: () => ({ slots: [session.id], capacity: 2, constrained: false, splitPercent: 50, following: host === "follow" }) } : {}),
    });
    const input: string[] = [];
    view.setCardPanel(interactionTarget(session)!, { body: Array.from({ length: 60 }, (_, index) => `panel paragraph ${index}`), keyLine: "Enter Send   Esc Keep draft", offset: 0 }, data => { input.push(data); });
    const width = host === "fleet" || host === "board-phone" ? 60 : 160;
    const render = () => stripAnsi(view.render(width).join("\n"));
    assert.match(render(), /panel paragraph 0/);
    view.handleInput("\u001b[6~");
    assert.doesNotMatch(render(), /panel paragraph 0\s/);
    view.handleInput("\u001b[5~");
    assert.match(render(), /panel paragraph 0/);
    for (let page = 0; page < 100; page += 1) { view.handleInput("\u001b[6~"); render(); }
    assert.match(render(), /panel paragraph 59/);
    assert.match(render(), /Enter Send/);
    view.handleInput("t");
    assert.deepEqual(input, ["t"], "local focus owns literal input at every host");
    controller.snapshot().sessions[0]!.interaction = { version: 1, instanceId: `${host}-replacement` };
    assert.doesNotMatch(render(), /panel paragraph/);
  });
}

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"] as const) {
  test(`mixed string/cursor panel rows and reserved key rows share the renderer in ${host}`, () => {
    const controller = new SessionsController({ version: 1, sessions: [session] });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 22, interactionTarget,
      ...(host.startsWith("board") ? { initialViewState: { grouping: "stage" as const } } : {}),
      ...(host === "pin" || host === "follow" ? { sidePaneState: () => ({ slots: [session.id], capacity: 2, constrained: false, splitPercent: 50, following: host === "follow" }) } : {}),
    });
    view.setCardPanel(interactionTarget(session)!, {
      body: ["String before", { value: "界".repeat(100), cursor: 100 }, "String after"],
      keyLine: "Tab Delivery\n←/→ Steer/Queue\nEnter Steer now\nEsc Keep draft", offset: 0,
    }, () => {});
    const rows = view.render(host === "fleet" || host === "board-phone" ? 60 : 160).map(stripAnsi);
    assert.ok(rows.some(row => row.includes("String before")));
    assert.ok(rows.some(row => row.includes("String after")));
    const input = rows.filter(row => row.includes("界"));
    assert.equal(input.length, 1); assert.match(input[0]!, /….*█/);
    for (const key of ["Tab Delivery", "←/→ Steer/Queue", "Enter Steer now", "Esc Keep draft"]) assert.equal(rows.filter(row => row.includes(key)).length, 1, key);
  });
}

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"] as const) for (const status of ["message", "flash"] as const) {
  test(`focused local keys survive a ${status} in ${host}`, () => {
    const target = { ...session, context: { version: 1 as const, updatedAt: 1,
      attention: { kind: "ready" as const, text: "Review", requestId: "ready", artifact: "/tmp/evidence.md" } } };
    const controller = new SessionsController({ version: 1, sessions: [target] });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 12, interactionTarget, copy: () => {},
      ...(host.startsWith("board") ? { initialViewState: { grouping: "stage" as const } } : {}),
      ...(host === "pin" || host === "follow" ? { sidePaneState: () => ({ slots: [target.id], capacity: 2, constrained: false, splitPercent: 50, following: host === "follow" }) } : {}),
    });
    if (status === "message") view.setMessage("Fixture status");
    else view.handleInput("y");
    view.setCardPanel(interactionTarget(target)!, { body: Array.from({ length: 30 }, (_, index) => `panel body ${index}`), keyLine: "Enter Send   Esc Keep draft", offset: 0 }, () => {});
    const width = host === "fleet" || host === "board-phone" ? 60 : 160;
    const rendered = stripAnsi(view.render(width).join("\n"));
    assert.match(rendered, /Enter Send\s+Esc Keep draft/);
    assert.match(rendered, status === "message" ? /Fixture status/ : /Copied path/);
  });
}

for (const host of ["board", "pin"] as const) {
  test(`delivery receipt stays visible in the ${host} selected-session surface`, async () => {
    const controller = new SessionsController({ version: 1, sessions: [session] });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget,
      ...(host === "board" ? { initialViewState: { grouping: "stage" as const } } : { sidePaneState: () => ({ slots: [session.id], capacity: 2, constrained: false, splitPercent: 50 }) }),
    });
    view.render(160);
    await view.writeInteraction(interactionTarget(session)!, "Message sent", () => {});
    assert.match(stripAnsi(view.render(160).join("\n")), /Accepted · Message sent/);
  });
}

for (const [error, expected] of [["Producer refused", /Rejected · Producer refused/], [DELIVERY_UNCONFIRMED, /Delivery unknown · Check Pi before retrying/]] as const) {
  test(`persistent receipt: ${error}`, async () => {
    const other = { ...session, id: "other", title: "Other", piSessionId: "other-pi" };
    const controller = new SessionsController({ version: 1, sessions: [session, other] });
    const view = new SessionsView(controller, () => {}, { terminalRows: () => 40, interactionTarget,
      loadInteractionState: async () => ({ questionProtocol: true, pending: [], messageDelivery: "idle" }),
      sendMessage: async () => { throw new Error(error); },
    });
    view.render(120); await view.refreshInteraction(); send(view); await tick();
    assert.match(text(view), expected);
    controller.selectSession("other"); text(view); controller.selectSession("s");
    assert.match(text(view), expected);
    view.handleInput(":"); for (const ch of "Dismiss result") view.handleInput(ch); view.handleInput("\r");
    assert.doesNotMatch(text(view), expected);
  });
}
