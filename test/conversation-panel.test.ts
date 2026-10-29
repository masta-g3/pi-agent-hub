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
  const writes: { id: string; answers: readonly AnswerInput[] }[] = [];
  const second: RuntimeSession = { ...session, status: secondStatus, id: "panel-b", title: "Second session", tmuxSession: "panel-b", piSessionId: "pi-b", interaction: { version: 1, instanceId: "instance-b" } };
  const controller = new SessionsController({ version: 1, sessions: [session, second] });
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: true, pending }),
    loadConversation: async () => readConversation([{ type: "message", id: "message", message: { role: "assistant", content: [{ type: "text", text: "Here is the earlier conversation." }, { type: "toolCall", id: request.toolCallId, name: "ask_user_question", arguments: request.params }] } }], { branchId: "branch" }),
    submitAnswer: async (target, _request, answers) => { writes.push({ id: target.managedId, answers }); if (holdSubmission) await new Promise<void>(resolve => { release = resolve; }); pending = []; }, terminalRows: () => height,
  });
  view.render(120); view.handleInput("c"); await tick(); view.render(120);
  return { view, controller, writes, release: () => release() };
}
const answer = (view: SessionsView) => { view.handleInput("\x1b"); view.handleInput("\t"); view.render(120); };

test("Conversation shows completed messages and typed questionnaire history, never an answer area", async () => {
  const { view } = await setup();
  const rows = view.render(120).map(stripAnsi);
  const conversation = rows.findIndex(line => line.includes("CONVERSATION"));
  assert.ok(conversation > 0);
  assert.ok(rows.slice(0, conversation).some(line => line.includes("Panel session")));
  assert.equal(rows.filter(line => line.includes("Which drink would you like?")).length, 1);
  assert.doesNotMatch(rows.join("\n"), /ANSWER NEEDED|Enter Send|Review answers/);
});

test("Tab from the fleet opens the card answer, not a Conversation focus target", async () => {
  const { view, writes } = await setup();
  answer(view);
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /CONVERSATION/);
  view.handleInput("2");
  assert.equal(writes.length, 0);
  view.handleInput("\r"); await tick();
  assert.deepEqual(writes, [{ id: "panel-a", answers: [{ questionIndex: 0, kind: "option", optionIndex: 1 }] }]);
});

test("card custom input treats c and numbers as literal text", async () => {
  const { view, writes } = await setup();
  answer(view); view.handleInput("t"); view.render(120);
  view.handleInput("c"); view.handleInput("2"); view.handleInput("\r"); await tick();
  assert.deepEqual(writes, [{ id: "panel-a", answers: [{ questionIndex: 0, kind: "custom", text: "c2" }] }]);
});

test("selection changes cannot send the previous session's card answer", async () => {
  const { view, controller, writes } = await setup();
  answer(view); view.handleInput("2");
  controller.selectSession("panel-b");
  view.handleInput("\r");
  assert.deepEqual(writes, []);
});

test("refresh cannot replace a submitting card form and admit a second write", async () => {
  const { view, writes, release } = await setup(true);
  answer(view); view.handleInput("2"); view.handleInput("\r");
  try {
    await view.refreshInteraction(); view.render(120);
    view.handleInput("1"); view.handleInput("\r");
    assert.equal(writes.length, 1);
  } finally { release(); await tick(); }
});

test("short card panels retain the visible Send control", async () => {
  const { view } = await setup(false, 12);
  answer(view);
  const rows = view.render(30).map(stripAnsi);
  assert.ok(rows.length <= 12);
  assert.ok(rows.some(row => row.includes("Enter Send")));
});

test("visible fleet tier navigation remains clickable above Conversation", async () => {
  const { view, controller } = await setup(false, 28, "running");
  controller.selectSession("panel-a");
  const rows = view.render(120).map(stripAnsi);
  const header = rows.findIndex(row => row.startsWith("│FLEET"));
  const x = rows[header]!.indexOf("ACTIVE 1") + 1;
  assert.ok(header >= 0 && x > 0);
  view.handleInput(`\x1b[<0;${x};${header + 1}M`);
  assert.equal(controller.selected()?.id, "panel-b");
});

test("Escape releases answer focus without submitting or declining; Tab restores its staged choice", async () => {
  const { view, writes } = await setup();
  answer(view); view.handleInput("2"); view.handleInput("\x1b");
  assert.equal(writes.length, 0);
  view.handleInput("\t");
  assert.match(stripAnsi(view.render(120).join("\n")), /▶ 2\. Coffee/);
});
