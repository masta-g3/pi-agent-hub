import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { heartbeatDir, heartbeatPath } from "../src/core/paths.js";
import { loadRegistry, updateRegistry } from "../src/core/registry.js";
import type { ManagedSession, SessionsRegistry } from "../src/core/types.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { stripAnsi } from "../src/tui/theme.js";

function session(id: string, overrides: Partial<ManagedSession> = {}): ManagedSession {
  return { id, title: id, cwd: `/tmp/${id}`, group: "default", tmuxSession: `pi-agent-hub-${id}`, status: "idle", createdAt: 1, updatedAt: 1, ...overrides };
}

const text = (view: SessionsView, width = 120) => stripAnsi(view.render(width).join("\n"));
const saved = async (id: string) => (await loadRegistry()).sessions.find((row) => row.id === id);

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition not reached");
}

async function setup(sessions: ManagedSession[], actions: ConstructorParameters<typeof SessionsView>[2] = {}) {
  const registry: SessionsRegistry = { version: 1, sessions };
  await updateRegistry(() => registry);
  const controller = new SessionsController(registry, async () => "present");
  const calls: string[] = [];
  const view = new SessionsView(controller, () => {}, {
    attachOutsideTmux: async (tmux) => { calls.push(`attach:${tmux}`); },
    switchInsideTmux: async (tmux) => { calls.push(`switch:${tmux}`); return { kind: "switched" } as never; },
    acknowledgeSession: (id, requestId, dismiss) => { calls.push(`ack:${id}`); return controller.acknowledgeSession(id, Date.now(), requestId, dismiss); },
    ...actions,
  });
  view.render(120);
  return { controller, view, calls };
}

test("B shows a receipt; z restores, reveals, and empties the single entry", async () => {
  const { controller, view, calls } = await setup([session("api", { title: "Checkout flow" }), session("other")]);
  assert.equal(controller.selectSession("api"), true);

  view.handleInput("B");
  await until(() => /z Undo · Backlog → Checkout flow/.test(text(view)));
  assert.equal((await saved("api"))?.bucket, "backlog");

  view.handleInput("?");
  view.handleInput("\x1b");
  view.handleInput("z");
  await until(() => /Undone · Backlog → Checkout flow/.test(text(view)));
  assert.equal((await saved("api"))?.bucket, undefined);
  assert.equal(controller.selected()?.id, "api");
  assert.deepEqual(calls.filter((call) => !call.startsWith("ack:")), []);

  view.handleInput("z");
  assert.match(text(view), /nothing to undo/);
});

test("Archive Done, Restore, and Move group each undo exactly", async () => {
  const { controller, view } = await setup([session("api", { group: "core", order: 3 })]);
  controller.selectSession("api");

  view.handleInput("A");
  view.handleInput("d");
  await until(() => /z Undo · Archived · Done → api/.test(text(view)));
  assert.equal((await saved("api"))?.closure, "done");
  view.handleInput("z");
  await until(() => /Undone · Archived · Done → api/.test(text(view)));
  assert.equal((await saved("api"))?.closure, undefined);
  assert.equal((await saved("api"))?.bucket, undefined);

  await controller.closeSession("api", "abandoned", {});
  controller.selectSession("api");
  view.handleInput("U");
  await until(() => /z Undo · Reopened → api/.test(text(view)));
  assert.equal((await saved("api"))?.closure, undefined);
  view.handleInput("z");
  await until(() => /Undone · Reopened → api/.test(text(view)));
  assert.equal((await saved("api"))?.closure, "abandoned");
  assert.equal((await saved("api"))?.bucket, "archived");

  await controller.restoreSessionBucket("api");
  controller.selectSession("api");
  view.handleInput("g");
  for (const char of "backend") view.handleInput(char);
  view.handleInput("\r");
  await until(() => /z Undo · Group backend → api/.test(text(view)));
  assert.equal((await saved("api"))?.group, "backend");
  view.handleInput("z");
  await until(() => /Undone · Group backend → api/.test(text(view)));
  assert.equal((await saved("api"))?.group, "core");
  assert.equal((await saved("api"))?.order, 3);
});

test("Mark read undo returns the explicit request to NEEDS YOU", async () => {
  const now = Date.now();
  await mkdir(heartbeatDir(), { recursive: true });
  await writeFile(heartbeatPath("api"), `${JSON.stringify({
    managedSessionId: "api", cwd: "/tmp/api", piSessionId: "pi-1", state: "waiting", stateSince: 10, updatedAt: now,
    context: { version: 1, updatedAt: now, attention: { requestId: "req-1", kind: "blocked", text: "Need a schema decision" } },
  })}\n`, "utf8");
  const { controller, view } = await setup([session("api", { status: "waiting", piSessionId: "pi-1" })]);
  await controller.refresh(now);
  controller.selectSession("api");
  assert.match(text(view), /NEEDS YOU/);

  view.handleInput("a");
  await until(() => /z Undo · Marked read → api/.test(text(view)));
  assert.equal((await saved("api"))?.dismissedRequestId, "req-1");
  assert.doesNotMatch(text(view), /NEEDS YOU/);

  view.handleInput("z");
  await until(() => /Undone · Marked read → api/.test(text(view)));
  assert.equal((await saved("api"))?.dismissedRequestId, undefined);
  assert.equal((await saved("api"))?.status, "waiting");
  assert.match(text(view), /NEEDS YOU/);
});

test("a newer change replaces the entry and a changed session refuses undo", async () => {
  const { controller, view } = await setup([session("api"), session("web")]);
  controller.selectSession("api");
  view.handleInput("B");
  await until(() => /z Undo · Backlog → api/.test(text(view)));
  controller.selectSession("web");
  view.handleInput("B");
  await until(() => /z Undo · Backlog → web/.test(text(view)));
  view.handleInput("z");
  await until(() => /Undone · Backlog → web/.test(text(view)));
  assert.equal((await saved("web"))?.bucket, undefined);
  assert.equal((await saved("api"))?.bucket, "backlog");

  controller.selectSession("api");
  view.handleInput("U");
  await until(() => /z Undo · Active → api/.test(text(view)));
  await updateRegistry((latest) => ({ ...latest, sessions: latest.sessions.map((row) => row.id === "api" ? { ...row, bucket: "archived" as const, bucketChangedAt: 99 } : row) }));
  view.handleInput("z");
  await until(() => /api changed since; nothing undone/.test(text(view)));
  assert.equal((await saved("api"))?.bucket, "archived");
  view.handleInput("z");
  assert.match(text(view), /nothing to undo/);
});

test("undo works after B empties the workflow board", async () => {
  const { controller, view } = await setup([session("api")], { initialViewState: { grouping: "stage" } });
  controller.selectSession("api");
  view.handleInput("B");
  await until(() => /z Undo · Backlog → api/.test(text(view)));
  assert.match(text(view), /No Active sessions\./);
  view.handleInput("z");
  await until(() => /Undone · Backlog → api/.test(text(view)));
  assert.equal((await saved("api"))?.bucket, undefined);
});

test("z stays literal in the filter, palette, and reply editor", async () => {
  const live = session("api", { status: "idle", piSessionId: "pi-api", interaction: { version: 1, instanceId: "instance" } } as Partial<ManagedSession>);
  const sent: string[] = [];
  const { controller, view } = await setup([live, session("web")], {
    interactionTarget,
    loadInteractionState: async () => ({ questionProtocol: true, pending: [], messageDelivery: "idle" }),
    sendMessage: async (_target, message) => { sent.push(message); },
  });
  controller.selectSession("web");
  view.handleInput("B");
  await until(() => /z Undo · Backlog → web/.test(text(view)));

  view.handleInput("/");
  view.handleInput("z");
  assert.match(text(view), /FILTERING.*z/);
  view.handleInput("\x1b");

  view.handleInput(":");
  view.handleInput("z");
  assert.match(text(view), /: z/);
  assert.equal((await saved("web"))?.bucket, "backlog");
  view.handleInput("\x7f");
  for (const char of "undo") view.handleInput(char);
  assert.match(text(view), /Undo: Backlog → web/);
  view.handleInput("\x1b");

  controller.selectSession("api");
  view.render(120);
  await view.refreshInteraction();
  view.handleInput("p");
  view.handleInput("z");
  view.handleInput("\r");
  await until(() => sent.length === 1);
  assert.deepEqual(sent, ["z"]);
  assert.equal((await saved("web"))?.bucket, "backlog");
});
