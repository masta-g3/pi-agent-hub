import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { ConversationReader, renderMarkdown } from "../src/tui/conversation.js";
import { createQuestionDialog, handleQuestionInput } from "../src/tui/question-dialog.js";
import { buildDashboardCommands, selectWorkspaceCommands } from "../src/tui/dashboard-commands.js";
import { validateDashboardShortcuts } from "../src/core/dashboard-shortcuts.js";
import { SelectedInteractionObserver } from "../src/tui/conversation.js";
import { renderQuestionDialog } from "../src/tui/question-dialog.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import type { RuntimeSession } from "../src/core/types.js";
import type { SessionInteractionState, PendingQuestion } from "../src/core/session-interaction.js";
import { stripAnsi } from "../src/tui/theme.js";
const target = { managedId: "a", piSessionId: "pi-a", instanceId: "instance-a" };
test("conversation markdown is control safe and width bounded", () => {
  for (const width of [40, 80, 119, 120, 159, 160, 200]) {
    const lines = renderMarkdown("# Hello\n\n界".repeat(100) + "\n```ts\n" + "long".repeat(100) + "\n```\x1b]52;c;secret\x07", width);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.ok(!lines.join("\n").includes("52;c;secret"));
  }
});
test("a clipped message keeps its speaker visible without hiding the last content line", () => {
  const reader = new ConversationReader();
  reader.accept({ branchId: "b", revision: "1", items: [{ id: "reply", role: "assistant", text: Array.from({ length: 30 }, (_, index) => `Line ${index}`).join("\n\n") }] });
  const lines = reader.render(40, 5).map(stripAnsi);
  assert.match(lines[0]!, /^  PI ─+$/);
  assert.ok(lines.some(line => line.includes("Line 29")));
  assert.ok(lines.every(line => visibleWidth(line) <= 40));
});

test("reader preserves an item anchor during older insertion and append", () => {
  const reader = new ConversationReader();
  reader.accept({ branchId: "b", revision: "1", items: [{ id: "2", role: "user", text: "second" }], before: "2" });
  reader.render(40, 5);
  reader.scroll(-1);
  reader.accept({ branchId: "b", revision: "1", items: [{ id: "1", role: "user", text: "first" }], before: "1" }, true);
  assert.equal(reader.anchor?.id, "2");
  reader.accept({ branchId: "other", revision: "2", items: [{ id: "3", role: "assistant", text: "replacement" }] });
  assert.deepEqual(reader.items.map(item => item.id), ["3"]);
});
test("final question submits immediately without a review screen", () => {
  const dialog = createQuestionDialog(target, "Login", { toolCallId: "call", params: { questions: [{ header: "Auth", question: "Which?", options: [{ label: "Email", description: "Link" }] }] } });
  assert.deepEqual(dialog.answers, []);
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.equal(dialog.page, 0);
  dialog.submitting = true;
  assert.equal(handleQuestionInput(dialog, "\r"), "changed");
});
test("question escape is local and empty multi selections are deliberate", () => {
  const dialog = createQuestionDialog(target, "Login", { toolCallId: "call", params: { questions: [{ header: "Auth", question: "Which?", options: [{ label: "Email", description: "Link" }], multiSelect: true }] } });
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers, [{ questionIndex: 0, kind: "multi", optionIndices: [] }]);
  assert.equal(handleQuestionInput(dialog, "\x1b"), "close");
});
test("conversation is optional and pinned panes refuse it; c is reserved", () => {
  assert.throws(() => validateDashboardShortcuts([{ key: "c", send: "hello" }]), /conflicts/);
  const commands = buildDashboardCommands({ sessions: [], pinState: { slots: ["a"], count: 1, capacity: 2, constrained: false } });
  const command = commands.find(command => command.id === "view:conversation");
  assert.equal(command?.enabled, false);
  assert.equal(command?.disabledReason, "Close pinned panes to use Conversation");
});


function liveSession(id: string): RuntimeSession {
  return { id, title: `Session ${id}`, group: "default", cwd: "/repo", tmuxSession: `tmux-${id}`, status: "idle", createdAt: 1, updatedAt: 1, piSessionId: `pi-${id}`, interaction: { version: 1, instanceId: `instance-${id}` } };
}
const request: PendingQuestion = { toolCallId: "call", params: { questions: [{ header: "Auth", question: "Choose sign-in", options: [{ label: "Email", description: "Link", preview: "# Preview\n\n" + Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n\n") }, { label: "Password", description: "Secret" }] }] } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("observer permits one request and drops state from the previous target", async () => {
  const observer = new SelectedInteractionObserver();
  let resolve!: (state: SessionInteractionState) => void;
  let calls = 0;
  observer.setTarget(target);
  const pending = observer.poll(0, () => { calls++; return new Promise(done => { resolve = done; }); });
  observer.setTarget({ ...target, managedId: "b" });
  await observer.poll(1000, async () => { calls++; return { questionProtocol: false, pending: [] }; });
  assert.equal(calls, 1);
  resolve({ questionProtocol: true, pending: [request] });
  await pending;
  assert.equal(observer.state, undefined);
  await observer.poll(1000, async () => { calls++; return { questionProtocol: false, pending: [] }; });
  assert.equal(calls, 2);
});

test("Page Down reads every preview paragraph in a short answer panel", () => {
  const dialog = createQuestionDialog(target, "Login", { ...request, params: { questions: [{ ...request.params.questions[0]!, options: [{ label: "Email", description: "Link", preview: Array.from({ length: 20 }, (_, i) => `Preview${i}`).join("\n\n") }, { label: "Password", description: "Secret" }] }] } });
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const text = stripAnsi(renderQuestionDialog(dialog, 40, 7).join("\n"));
    for (const match of text.matchAll(/Preview\d+/g)) seen.add(match[0]);
    handleQuestionInput(dialog, "\x1b[6~");
  }
  assert.deepEqual([...seen], Array.from({ length: 20 }, (_, i) => `Preview${i}`));
});

test("Page Down reads every history paragraph in a short conversation panel", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [liveSession("a")] }), () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: false, pending: [] }),
    loadConversation: async () => ({ branchId: "b", revision: "1", items: [{ id: "long", role: "assistant", text: Array.from({ length: 40 }, (_, i) => `Paragraph${i}`).join("\n\n") }] }),
    terminalRows: () => 20,
  });
  view.render(80); view.handleInput("c"); await tick(); view.render(80);
  view.handleInput("\x1b[H");
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const text = stripAnsi(view.render(80).join("\n"));
    for (const match of text.matchAll(/Paragraph\d+/g)) seen.add(match[0]);
    view.handleInput("\x1b[6~");
  }
  assert.deepEqual([...seen], Array.from({ length: 40 }, (_, i) => `Paragraph${i}`));
});

test("question previews scroll fully and short layouts expose no hidden targets", () => {
  const dialog = createQuestionDialog(target, "Login", request);
  for (const width of [40, 80, 119, 120, 160, 200]) {
    for (const height of [5, 10, 24]) {
      const lines = renderQuestionDialog(dialog, width, height);
      assert.ok(lines.length <= height);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(dialog.rowTargets.length <= lines.length);
    }
  }
  renderQuestionDialog(dialog, 80, 12);
  for (let index = 0; index < 12; index++) handleQuestionInput(dialog, "\x1b[6~");
  assert.match(renderQuestionDialog(dialog, 80, 12).join("\n"), /line (2[0-9]|3[0-9]|4[0-9]|5[0-9])/);
});

test("custom input is literal, editable, and final Enter submits all four answers", () => {
  const dialog = createQuestionDialog(target, "Login", { toolCallId: "four", params: { questions: Array.from({ length: 4 }, () => request.params.questions[0]!) } });
  handleQuestionInput(dialog, "\x1b[B"); handleQuestionInput(dialog, "\x1b[B"); handleQuestionInput(dialog, "\r");
  handleQuestionInput(dialog, "\x1b[200~literal /skill:review\x1b[201~");
  handleQuestionInput(dialog, "\x1b[D"); handleQuestionInput(dialog, "!");
  handleQuestionInput(dialog, "\r");
  assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "custom", text: "literal /skill:revie!w" });
  for (let index = 0; index < 2; index++) assert.equal(handleQuestionInput(dialog, "\r"), "changed");
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.equal(dialog.answers.length, 4);
});

test("Conversation bounds every width, reads only selected live rows, and never acknowledges", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a"), liveSession("b")] });
  const reads: string[] = [];
  let acknowledgements = 0;
  let now = 0;
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: false, pending: [] }),
    loadConversation: async target => { reads.push(target.managedId); return { branchId: target.managedId, revision: "1", items: [{ id: "message", role: "assistant", text: `Only ${target.managedId}` }] }; },
    acknowledgeSession: () => { acknowledgements++; }, terminalRows: () => 24, now: () => now,
  });
  await view.refreshInteraction();
  assert.deepEqual(reads, []);
  view.render(120); view.handleInput("c"); await tick();
  assert.deepEqual(reads, ["a"]);
  for (const width of [39, 40, 80, 119, 120, 159, 160, 200]) {
    const lines = view.render(width);
    assert.ok(lines.length <= 24);
    assert.ok(lines.every(line => visibleWidth(line) <= width), `width ${width}`);
  }
  controller.selectSession("b"); now += 1000; view.render(120); await tick();
  assert.match(stripAnsi(view.render(120).join("\n")), /Only b/);
  assert.doesNotMatch(stripAnsi(view.render(120).join("\n")), /Only a/);
  assert.equal(acknowledgements, 0);
  view.handleInput("c"); now += 1000; await view.refreshInteraction();
  assert.deepEqual(reads, ["a", "b"]);
});

test("Answer is separate from Open and shortcut reasons are discoverable", () => {
  const selected = liveSession("a");
  const commands = buildDashboardCommands({ sessions: [selected], selectedId: "a", interactionState: { questionProtocol: true, pending: [request] }, capabilities: { answerQuestion: true, openSession: true, runConfiguredShortcut: true }, configuredShortcuts: [{ key: "z", send: "/skill:review" }] });
  assert.equal(commands.find(command => command.id.includes(":answer:"))?.label, "Answer");
  assert.equal(commands.find(command => command.id.startsWith("shortcut:"))?.enabled, false);
  const previous = commands.find(command => command.id.includes(":answer:"))!.id;
  const replaced = buildDashboardCommands({ sessions: [selected], selectedId: "a", interactionState: { questionProtocol: true, pending: [{ ...request, toolCallId: "replacement" }] }, capabilities: { answerQuestion: true } });
  assert.ok(!replaced.some(command => command.id === previous));
});

test("inline question submits once to its exact selected session", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a"), liveSession("b")] });
  const writes: string[] = [];
  let settle!: () => void;
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: true, pending: [request], shortcutDisabledReason: "Question open" }),
    loadConversation: async () => ({ branchId: "branch", revision: "1", items: [] }),
    submitAnswer: async target => { writes.push(target.managedId); await new Promise<void>(resolve => { settle = resolve; }); },
    terminalRows: () => 16,
  });
  await view.refreshInteraction(); view.render(80); view.handleInput("c"); await tick();
  assert.match(view.render(80).join("\n"), /ANSWER NEEDED.*Question 1 of 1/);
  view.handleInput("\r");
  assert.deepEqual(writes, ["a"]);
  settle(); await tick();
});

test("synthetic headers clear conversation data and cannot expose stale answer targets", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a")] });
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: true, pending: [request] }),
    loadConversation: async () => ({ branchId: "branch", revision: "1", items: [{ id: "m", role: "user", text: "Secret selected text" }] }),
    submitAnswer: async () => { assert.fail("synthetic header submitted an answer"); }, terminalRows: () => 20,
  });
  view.render(120); view.handleInput("c"); await tick();
  assert.match(view.render(120).join("\n"), /Secret selected text/);
  view.handleInput("\x1b");
  view.handleInput("\x1b[A");
  const lines = view.render(120).join("\n");
  assert.doesNotMatch(lines, /Secret selected text/);
  assert.match(lines, /Select a session/);
});

test("reader caps retained text and following reveals the beginning of a long new message", () => {
  const reader = new ConversationReader();
  reader.accept({ branchId: "branch", revision: "1", items: [{ id: "initial", role: "user", text: "first" }] });
  reader.render(40, 6);
  reader.accept({ branchId: "branch", revision: "2", items: [{ id: "new", role: "assistant", text: "Beginning\n\n" + "body\n\n".repeat(100) }] });
  assert.match(reader.render(40, 6).join("\n"), /Beginning/);
  reader.scroll(-1);
  for (let index = 0; index < 30; index++) reader.accept({ branchId: "branch", revision: String(index), items: [{ id: `large-${index}`, role: "assistant", text: "x".repeat(64 * 1024) }] });
  assert.ok(reader.items.reduce((bytes, item) => bytes + Buffer.byteLength(item.text), 0) <= 1024 * 1024);
});

test("conversation keeps the previous board presentation and selection", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a"), liveSession("b")] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 20, now: () => 0 });
  view.handleInput("S"); controller.selectSession("b");
  const before = view.render(120);
  view.handleInput("c"); view.render(120); view.handleInput("c");
  assert.equal(controller.selected()?.id, "b");
  assert.deepEqual(view.render(120), before);
});

test("mouse routes fleet and lower conversation panel by exact rows", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a"), liveSession("b")] });
  const view = new SessionsView(controller, () => {}, {
    interactionTarget, loadInteractionState: async () => ({ questionProtocol: false, pending: [] }),
    loadConversation: async () => ({ branchId: "b", revision: "1", items: [{ id: "m", role: "assistant", text: "body\n\n".repeat(50) }] }), terminalRows: () => 20,
  });
  view.render(120); view.handleInput("c"); await tick(); view.render(120);
  view.handleInput("\x1b[<64;80;12M");
  assert.equal(controller.selected()?.id, "a");
  const rows = view.render(120);
  const aRow = rows.findIndex(line => stripAnsi(line).includes("Session a"));
  assert.ok(aRow >= 0 && aRow < rows.findIndex(line => stripAnsi(line).includes("CONVERSATION")));
  view.handleInput(`\x1b[<0;30;${aRow + 1}M`);
  assert.equal(controller.selected()?.id, "a");
});

test("unconfirmed answer waits for fresh producer validity and native completion closes it", async () => {
  const controller = new SessionsController({ version: 1, sessions: [liveSession("a")] });
  let queries = 0;
  let writes = 0;
  let fresh!: (state: SessionInteractionState) => void;
  const view = new SessionsView(controller, () => {}, {
    interactionTarget,
    loadInteractionState: async () => { queries++; if (queries > 1) return new Promise(resolve => { fresh = resolve; }); return { questionProtocol: true, pending: [request] }; },
    submitAnswer: async () => { writes++; throw new Error("Delivery not confirmed; check Pi before retrying"); }, terminalRows: () => 16,
  });
  await view.refreshInteraction();
  view.handleInput(":"); for (const char of "answer") view.handleInput(char); view.handleInput("\r");
  view.render(80); view.handleInput("\r"); await tick();
  assert.equal(writes, 1);
  assert.match(view.render(80).join("\n"), /Delivery not confirmed/);
  view.handleInput("\r"); assert.equal(writes, 1);
  fresh({ questionProtocol: true, pending: [] }); await tick();
  assert.doesNotMatch(view.render(80).join("\n"), /ANSWER NEEDED/);
});

test("ready configured actions appear in the positive-only workspace", () => {
  const selected = liveSession("a");
  const input = { sessions: [selected], selectedId: selected.id, capabilities: { openSession: true, runConfiguredShortcut: true }, configuredShortcuts: [{ key: "z", label: "Review", send: "/skill:review" }] };
  const ready = buildDashboardCommands({ ...input, interactionState: { questionProtocol: false, pending: [] } });
  assert.ok(selectWorkspaceCommands(selected, ready, 3).actions.some(command => command.label === "Review"));
  const drafted = buildDashboardCommands({ ...input, interactionState: { questionProtocol: false, pending: [], shortcutDisabledReason: "Pi editor contains a draft" } });
  assert.ok(!selectWorkspaceCommands(selected, drafted, 3).actions.some(command => command.label === "Review"));
  assert.equal(drafted.find(command => command.label === "Review")?.disabledReason, "Pi editor contains a draft");
});

test("older paging at the cache cap evicts newer text instead of the requested page", () => {
  const reader = new ConversationReader();
  reader.accept({ branchId: "b", revision: "1", before: "20", items: Array.from({ length: 16 }, (_, index) => ({ id: String(20 + index), role: "assistant" as const, text: "x".repeat(64 * 1024) })) });
  reader.render(40, 10); reader.home();
  reader.accept({ branchId: "b", revision: "1", before: "19", items: [{ id: "19", role: "user", text: "Older page" }] }, true);
  assert.equal(reader.items[0]?.id, "19");
  assert.equal(reader.anchor?.id, "20");
  assert.equal(reader.before, "19");
});
