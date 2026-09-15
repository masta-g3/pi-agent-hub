import test from "node:test";
import assert from "node:assert/strict";
import { SessionsView } from "../src/tui/sessions-view.js";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { stripAnsi } from "../src/tui/theme.js";
import { readConversation } from "../src/core/conversation.js";
import type { RuntimeSession } from "../src/core/types.js";
import type { AnswerInput, PendingQuestion } from "../src/core/session-interaction.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const session: RuntimeSession = { id: "panel-a", title: "Panel session", group: "default", cwd: "/repo", tmuxSession: "panel-a", status: "idle", createdAt: 1, updatedAt: 1, piSessionId: "pi-panel", interaction: { version: 1, instanceId: "instance-panel" } };
const request: PendingQuestion = { toolCallId: "drink", params: { questions: [{ header: "Drink", question: "Which drink would you like?", options: [{ label: "Tea", description: "A cup of tea" }, { label: "Coffee", description: "A cup of coffee" }] }] } };
async function setup(holdSubmission = false, height = 28, secondStatus: RuntimeSession["status"] = "idle") {
  let pending = [request];
  let release!: () => void;
  let now = 0;
  const later: unknown[] = [];
  const writes: { id: string; answers: readonly AnswerInput[] }[] = [];
  const second: RuntimeSession = { ...session, status: secondStatus, id: "panel-b", title: "Second session", tmuxSession: "panel-b", piSessionId: "pi-b", interaction: { version: 1, instanceId: "instance-b" } };
  const controller = new SessionsController({ version: 1, sessions: [session, second] });
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: true, pending }),
    loadConversation: async () => readConversation([{ type: "message", id: "message", message: { role: "assistant", content: [{ type: "text", text: "Here is the earlier conversation." }, { type: "toolCall", id: request.toolCallId, name: "ask_user_question", arguments: request.params }] } }, ...later], { branchId: "branch" }),
    submitAnswer: async (target, _request, answers) => { writes.push({ id: target.managedId, answers }); if (holdSubmission) await new Promise<void>(resolve => { release = resolve; }); pending = []; }, terminalRows: () => height, now: () => now,
  });
  view.render(120); view.handleInput("c"); await tick(); view.render(120);
  return { view, controller, writes, release: () => release(), appendReply: () => {
    later.push({ type: "message", id: "later", message: { role: "assistant", content: "A later reply" } });
    now += 2_000;
  } };
}

test("conversation appears below the fleet and exposes the pending question without opening a dialog", async () => {
  const { view } = await setup();
  const rows = view.render(120).map(stripAnsi);
  const conversation = rows.findIndex(line => line.includes("CONVERSATION"));
  assert.ok(conversation > 0, "conversation is below fleet");
  assert.ok(rows.slice(0, conversation).some(line => line.includes("Panel session")), "fleet stays above conversation");
  assert.equal(rows.filter(line => line.includes("Which drink would you like?")).length, 1, "pending question appears once, not repeated in history");
  assert.doesNotMatch(rows.join("\n"), /Review answers/);
});

test("number selects and the first Enter submits inline, without a review screen", async () => {
  const { view, writes } = await setup();
  view.handleInput("2");
  assert.equal(writes.length, 0);
  view.handleInput("\r"); await tick();
  assert.deepEqual(writes, [{ id: "panel-a", answers: [{ questionIndex: 0, kind: "option", optionIndex: 1 }] }]);
});

test("inline custom input treats c and numbers as text, not dashboard shortcuts", async () => {
  const { view, writes } = await setup();
  view.handleInput("t"); view.render(120);
  view.handleInput("c"); view.handleInput("2"); view.handleInput("\r"); await tick();
  assert.deepEqual(writes, [{ id: "panel-a", answers: [{ questionIndex: 0, kind: "custom", text: "c2" }] }]);
});

test("selection changes cannot send the previous session's inline answer", async () => {
  const { view, controller, writes } = await setup();
  view.handleInput("2");
  controller.selectSession("panel-b");
  view.handleInput("\r");
  assert.deepEqual(writes, []);
});

test("refresh cannot replace a submitting inline form and admit a second write", async () => {
  const { view, writes, release } = await setup(true);
  view.handleInput("2"); view.handleInput("\r");
  try {
    await view.refreshInteraction(); view.render(120);
    view.handleInput("1"); view.handleInput("\r");
    assert.equal(writes.length, 1);
  } finally { release(); await tick(); }
});

test("short bottom panels retain the visible Send control", async () => {
  const { view } = await setup(false, 12);
  const rows = view.render(40).map(stripAnsi);
  assert.ok(rows.length <= 12);
  assert.ok(rows.some(row => row.includes("Enter Send")));
});

test("mouse Send commits the selected inline option before dispatch", async () => {
  const { view, writes } = await setup();
  let rows = view.render(120).map(stripAnsi);
  const choice = rows.findIndex(row => row.includes("2 Coffee"));
  assert.ok(choice >= 0);
  view.handleInput(`\x1b[<0;3;${choice + 1}M`);
  assert.equal(writes.length, 0);
  rows = view.render(120).map(stripAnsi);
  const send = rows.findIndex(row => row.includes("Enter Send"));
  view.handleInput(`\x1b[<0;3;${send + 1}M`); await tick();
  assert.deepEqual(writes, [{ id: "panel-a", answers: [{ questionIndex: 0, kind: "option", optionIndex: 1 }] }]);
});

test("visible fleet tier navigation remains clickable above the conversation", async () => {
  const { view, controller } = await setup(false, 28, "running");
  controller.selectSession("panel-a");
  const rows = view.render(120).map(stripAnsi);
  const active = rows.findIndex(row => row.startsWith("│ACTIVE"));
  assert.ok(active >= 0);
  view.handleInput(`\x1b[<0;3;${active + 1}M`);
  assert.equal(controller.selected()?.id, "panel-b");
});

test("answer confirmation expires so detached readers see later-message cues", async () => {
  const { view, appendReply } = await setup();
  view.handleInput("\x1b"); view.handleInput("\t"); view.handleInput("\t");
  view.handleInput("\x1b[H"); view.handleInput("\x1b[Z");
  view.handleInput("2"); view.handleInput("\r"); await tick();
  appendReply(); await view.refreshInteraction();
  const text = stripAnsi(view.render(120).join("\n"));
  assert.match(text, /New messages/);
  assert.doesNotMatch(text, /Answer accepted/);
});

test("Escape releases answer focus without submitting or cancelling the question", async () => {
  const { view, writes } = await setup();
  view.handleInput("\x1b"); view.handleInput("2");
  assert.equal(writes.length, 0);
  assert.match(stripAnsi(view.render(120).join("\n")), /Which drink would you like\?/);
});
