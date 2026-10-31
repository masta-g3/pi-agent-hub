import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SessionsController } from "../src/app/controller.js";
import { interactionTarget } from "../src/app/session-interaction.js";
import { SessionsView } from "../src/tui/sessions-view.js";
import { createQuestionDialog, handleQuestionInput, renderQuestionPanel } from "../src/tui/question-dialog.js";
import { COCKPIT_RELEASE_CUE, releaseCueVisible } from "../src/tui/cockpit-onboarding.js";
import { stripAnsi } from "../src/tui/theme.js";
import type { RuntimeSession } from "../src/core/types.js";
import type { AnswerInput, PendingQuestion } from "../src/core/session-interaction.js";

const session: RuntimeSession = { id: "s", title: "Answer card", cwd: "/tmp/repo", group: "cards", tmuxSession: "s", status: "waiting", piSessionId: "pi-s", interaction: { version: 1, instanceId: "instance" }, createdAt: 1, updatedAt: 1 };
const question = { header: "Scope", question: "Which change should ship?", options: [{ label: "First", description: "First description", preview: "Real option preview", hasPreview: true }, { label: "Second", description: "Second description" }] };
const request: PendingQuestion = { toolCallId: "call", params: { questions: [question] } };
const target = interactionTarget(session)!;
const tick = () => new Promise(resolve => setImmediate(resolve));
const text = (view: SessionsView, width = 120) => stripAnsi(view.render(width).join("\n"));

test("the inbox cue teaches all three keys once, including new users", () => {
  assert.notEqual(COCKPIT_RELEASE_CUE.id as string, "cockpit-daily-loop-v1");
  assert.equal(releaseCueVisible({ cohort: "new", phase: "complete" }, undefined), true);
  assert.equal(releaseCueVisible({ cohort: "new", phase: "learning" }, undefined), false);
  assert.equal(releaseCueVisible(undefined, COCKPIT_RELEASE_CUE.id), false);
  assert.match(COCKPIT_RELEASE_CUE.text, /Tab opens an answer; p writes a reply; Enter opens Pi/);
  assert.match(COCKPIT_RELEASE_CUE.text, /Esc leaves answer focus without declining/);
  assert.match(COCKPIT_RELEASE_CUE.text, /Alt\+W finds the next request/);
});

test("question pages preserve staged single, multi and custom choices; last page cannot skip unanswered questions", () => {
  const dialog = createQuestionDialog(target, session.title, { toolCallId: "call", params: { questions: [question, { ...question, multiSelect: true }, question] } });
  handleQuestionInput(dialog, "2"); handleQuestionInput(dialog, "\x1b[C");
  handleQuestionInput(dialog, "1"); handleQuestionInput(dialog, "2"); handleQuestionInput(dialog, "\x1b[C");
  assert.equal(handleQuestionInput(dialog, "\r"), "changed");
  assert.equal(dialog.page, 0);
  assert.match(dialog.error!, /unanswered/i);
  assert.equal(dialog.choice, 1);
  handleQuestionInput(dialog, "\r");
  assert.deepEqual([...dialog.selected], [0, 1]);
  handleQuestionInput(dialog, "\r");
  handleQuestionInput(dialog, "t"); handleQuestionInput(dialog, "literal c1q?");
  assert.equal(handleQuestionInput(dialog, "\x1b"), "changed", "Esc exits text editing, not answer focus");
  handleQuestionInput(dialog, "t");
  assert.equal(dialog.custom?.fields.answer.value, "literal c1q?");
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers, [{ questionIndex: 0, kind: "option", optionIndex: 1 }, { questionIndex: 1, kind: "multi", optionIndices: [0, 1] }, { questionIndex: 2, kind: "custom", text: "literal c1q?" }]);
});

test("moving a confirmed single choice requires confirmation again before sending", () => {
  const dialog = createQuestionDialog(target, session.title, { ...request, params: { questions: [question, question] } });
  handleQuestionInput(dialog, "\r");
  handleQuestionInput(dialog, "\x1b[D"); handleQuestionInput(dialog, "\x1b[B"); handleQuestionInput(dialog, "\x1b[C");
  assert.equal(handleQuestionInput(dialog, "\r"), "changed");
  assert.equal(dialog.page, 0);
  assert.equal(dialog.choice, 1);
  handleQuestionInput(dialog, "\r");
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "option", optionIndex: 1 });
});

test("supported questions use the approved key line without fallback guidance", async () => {
  const selected = { ...session, context: { version: 1 as const, updatedAt: 1,
    attention: { kind: "question" as const, text: "Should the card shell own the answer form?", requestId: "request" } } };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [selected] }), () => {}, { terminalRows: () => 28, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [request], messageDelivery: "idle" }), submitAnswer: async () => {}, sendMessage: async () => {}, attachOutsideTmux: () => {},
  });
  view.render(80); await view.refreshInteraction();
  const rendered = text(view, 80);
  assert.match(rendered, /Tab Answer\s+p Reply\s+Enter Open in Pi/);
  assert.doesNotMatch(rendered, /Answer in the Pi session/);
  assert.doesNotMatch(rendered, /a Mark read/);
});

test("focused answers replace the collapsed question and restore it after Escape", async () => {
  const selected = { ...session, context: { version: 1 as const, updatedAt: 1,
    attention: { kind: "question" as const, text: "Should the card shell own the answer form?", requestId: "request" } } };
  const pending = { ...request, params: { questions: [{ ...question, header: "Boundary", question: "Should the card shell own the answer form?" }] } };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [selected] }), () => {}, { terminalRows: () => 28, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [pending] }), submitAnswer: async () => {}, sendMessage: async () => {}, attachOutsideTmux: () => {},
  });
  view.render(80); await view.refreshInteraction();
  assert.match(text(view, 80), /\? Boundary · Should the card shell own the answer form\?/);
  view.handleInput("\t");
  const focused = text(view, 80);
  assert.doesNotMatch(focused, /\? Boundary · Should the card shell own the answer form\?/);
  assert.equal(focused.match(/Should the card shell own the answer form\?/g)?.length, 1);
  view.handleInput("\x1b");
  assert.match(text(view, 80), /\? Boundary · Should the card shell own the answer form\?/);
});

test("the shared panel wraps question prose at words without clipping or word fragments", async () => {
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 28, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [{ ...request, params: { questions: [{ ...question, question: "Should we keep the ticket subtitle above the request line, even when the request is long?" }] } }] }), submitAnswer: async () => {},
  });
  view.render(80); await view.refreshInteraction(); view.handleInput("\t");
  const lines = text(view, 80).split("\n");
  assert.ok(lines.some(line => line.includes("request is long?")));
});

test("wrapped answer labels, descriptions and previews keep their hanging indent", async () => {
  const wrapped = { ...request, params: { questions: [{ ...question, options: [{
    label: "One shared shell (Recommended) with a deliberately long label tail",
    description: "Reply and answer reuse one panel, so every view behaves the same.",
    preview: "One preview line stays aligned when its deliberately long content reaches the preview tail.", hasPreview: true,
  }, question.options[1]!] }] } };
  for (const width of [60, 30]) {
    const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 40, interactionTarget,
      loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [wrapped] }), submitAnswer: async () => {},
    });
    view.render(width); await view.refreshInteraction(); view.handleInput("\t");
    const lines = text(view, width).split("\n");
    const range = (start: string, end: string) => {
      const first = lines.findIndex(line => line.includes(start));
      const last = lines.findIndex((line, index) => index > first && line.includes(end));
      assert.ok(first >= 0 && last > first, `${width}: missing ${start}..${end}\n${lines.join("\n")}`);
      return lines.slice(first, last).map(line => line.replace(/│/gu, " ")).filter(line => line.trim());
    };
    const label = range("▶ [1]", "Reply and answer");
    const description = range("Reply and answer", "[2] Second");
    const preview = range("One preview line", "Enter Send");
    for (const line of label.slice(1)) assert.equal(line.search(/\S/), label[0]!.indexOf("One shared shell"), `${width}: option label`);
    for (const line of description.slice(1)) assert.equal(line.search(/\S/), description[0]!.indexOf("Reply and answer"), `${width}: description`);
    for (const line of preview.slice(1)) assert.equal(line.search(/\S/), preview[0]!.indexOf("One preview line"), `${width}: preview`);
    assert.ok(view.render(width).every(line => visibleWidth(line) <= width));
  }
});

test("rpiv-style numbered options, question tabs, descriptions and real previews", () => {
  const dialog = createQuestionDialog(target, session.title, { ...request, params: { questions: [question, question] } });
  const wide = stripAnsi(renderQuestionPanel(dialog, 120).body.join("\n"));
  assert.match(wide, /←.*\[□ Scope\].*□ Scope.*→/);
  assert.match(wide, /▶ \[1\] First/);
  assert.match(wide, /\[3\] Type something\./);
  assert.match(wide, /First description/); assert.match(wide, /Second description/);
  assert.match(wide, /Preview\n  Real option preview/);
  const narrow = stripAnsi(renderQuestionPanel(dialog, 80).body.join("\n"));
  assert.match(narrow, /First description/); assert.doesNotMatch(narrow, /Second description/);
  handleQuestionInput(dialog, "2");
  assert.match(renderQuestionPanel(dialog, 80).body.join("\n"), /Second description/);
  handleQuestionInput(dialog, "3"); assert.ok(dialog.custom, "numbered custom row enters text editing");
});

for (const host of ["fleet", "board-wide", "board-phone", "pin", "follow"] as const) test(`Tab answers through the shared slot in ${host}`, async () => {
  const controller = new SessionsController({ version: 1, sessions: [structuredClone(session)] });
  const writes: AnswerInput[][] = [];
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget,
    ...(host.startsWith("board") ? { initialViewState: { grouping: "stage" as const } } : {}),
    ...(host === "pin" || host === "follow" ? { sidePaneState: () => ({ slots: [session.id], capacity: 2, constrained: false, splitPercent: 50, following: host === "follow" }) } : {}),
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: writes.length ? [] : [request] }),
    submitAnswer: async (bound, call, answers) => { assert.deepEqual(bound, target); assert.equal(call, "call"); writes.push(answers); },
  });
  const width = host === "board-phone" ? 60 : 160;
  view.render(width); await view.refreshInteraction();
  view.handleInput("\t"); assert.match(text(view, width), /\[1\] First/);
  view.handleInput("2"); view.handleInput("\x1b");
  assert.equal(writes.length, 0);
  view.handleInput("\t"); assert.match(text(view, width), /▶ \[2\] Second/);
  view.handleInput("\r"); await tick();
  assert.deepEqual(writes, [[{ questionIndex: 0, kind: "option", optionIndex: 1 }]]);
  assert.match(text(view, width), /Accepted · Answer sent/);
  assert.doesNotMatch(text(view, width), /CONVERSATION/);
});

for (const width of [120, 80, 60, 30]) test(`answer form is width-exact and scrollable at ${width}`, async () => {
  const long = { ...request, params: { questions: [{ ...question, question: "Full untruncated question. ".repeat(30) + "QUESTION END" }] } };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 24, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [long] }), submitAnswer: async () => {},
  });
  view.render(width); await view.refreshInteraction(); view.handleInput("\t");
  let seen = "";
  for (let i = 0; i < 20; i++) {
    const lines = view.render(width);
    assert.equal(lines.length, 24);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    seen += stripAnsi(lines.join("\n"));
    view.handleInput("\x1b[6~");
  }
  assert.match(seen.replace(/[│\s]/g, ""), /QUESTIONEND/);
  assert.match(seen, /\[1\] First/);
  assert.match(seen, /Enter Send/);
});

for (const [reason, receipt, retained] of [
  ["Question stale; answered elsewhere or closed", "Rejected · Question stale", false],
  ["Answer rejected: choose an option", "Rejected · Answer rejected", true],
  ["This prompt can only be answered in Pi", "Rejected · This prompt", false],
  ["Delivery not confirmed; check Pi before retrying", "Delivery unknown · Check Pi before retrying", true],
] as const) test(`card receipt: ${reason}`, async () => {
  let writes = 0;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 30, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [request] }),
    submitAnswer: async () => { writes++; throw new Error(reason); },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\t"); view.render(120); view.handleInput("\r"); await tick();
  assert.ok(text(view).includes(receipt), text(view));
  assert.equal(text(view).includes("[1] First"), retained);
  if (reason.startsWith("Delivery")) { view.handleInput("\r"); view.handleInput("\x1b"); view.handleInput("\t"); view.handleInput("\r"); await tick(); assert.equal(writes, 1); }
});

test("opening a note on a long question reveals the editor on a phone", async () => {
  const long = { ...request, params: { questions: [{ ...question, question: "A long condition ".repeat(80) + "Ship?" }] } };
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 24, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [long] }), submitAnswer: async () => {},
  });
  view.render(30); await view.refreshInteraction(); view.handleInput("\t"); view.handleInput("n"); view.handleInput("Visible note");
  const rendered = text(view, 30);
  assert.match(rendered, /Question note/); assert.match(rendered, /Visible note/); assert.match(rendered, /Enter Save note/);
});

test("notes use the real card input path, survive page/selection/Escape, and reset with the tool call", async () => {
  let pending = { ...request, params: { questions: [question, question] } };
  let now = 0;
  const writes: AnswerInput[][] = [];
  const controller = new SessionsController({ version: 1, sessions: [structuredClone(session), { ...session, id: "other", piSessionId: "other-pi" }] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget, now: () => now,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [pending] }),
    submitAnswer: async (_target, _call, answers) => { writes.push(answers); },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\t");
  view.handleInput("2"); view.handleInput("n"); view.handleInput("nCO exact note"); view.handleInput("\x1b");
  assert.equal(writes.length, 0); assert.match(text(view), /✎ nCO exact note/);
  view.handleInput("\x1b[C"); view.handleInput("n"); view.handleInput("Second note"); view.handleInput("\r");
  view.handleInput("\x1b"); controller.selectSession("other"); view.render(120); await view.refreshInteraction();
  controller.selectSession("s"); view.render(120); await view.refreshInteraction(); view.handleInput("\t");
  view.handleInput("\x1b[D"); assert.match(text(view), /✎ nCO exact note/);
  view.handleInput("\r"); view.handleInput("\r"); await tick();
  assert.deepEqual(writes[0], [{ questionIndex: 0, kind: "option", optionIndex: 1, notes: "nCO exact note" }, { questionIndex: 1, kind: "option", optionIndex: 0, notes: "Second note" }]);
  view.handleInput("\t"); view.handleInput("n"); view.handleInput("Old note"); view.handleInput("\r"); view.handleInput("\x1b");
  pending = { ...pending, toolCallId: "replacement" }; now += 2000; await view.refreshInteraction(); view.handleInput("\t");
  assert.doesNotMatch(text(view), /Old note|Second note|nCO exact note/);
  view.handleInput("n"); view.handleInput("Old instance"); view.handleInput("\r"); view.handleInput("\x1b");
  controller.snapshot().sessions.find(row => row.id === "s")!.interaction = { version: 1, instanceId: "new-instance" };
  view.render(120); now += 2000; await view.refreshInteraction(); view.handleInput("\t");
  assert.doesNotMatch(text(view), /Old instance/);
});

test("staged answers and uncertainty are exact-target bound across selection and restarts", async () => {
  const other = { ...session, id: "other", piSessionId: "pi-other", title: "Other card" };
  const controller = new SessionsController({ version: 1, sessions: [structuredClone(session), other] });
  let writes = 0;
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 30, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [request] }),
    submitAnswer: async () => { writes++; throw new Error("Delivery not confirmed; check Pi before retrying"); },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\t"); view.handleInput("2"); view.handleInput("\r"); await tick();
  view.handleInput("\x1b"); controller.selectSession("other"); view.render(120); await view.refreshInteraction();
  view.handleInput("\t"); view.render(120); view.handleInput("\x1b"); controller.selectSession("s"); view.render(120); await view.refreshInteraction();
  view.handleInput("\t"); view.render(120); view.handleInput("\r"); await tick();
  assert.equal(writes, 1, "observing the same pending request never licenses retry after uncertainty");
  view.handleInput("\x1b"); controller.snapshot().sessions.find(row => row.id === "s")!.interaction = { version: 1, instanceId: "restarted" };
  view.render(120); await view.refreshInteraction(); view.handleInput("\t");
  assert.match(text(view), /▶ \[1\] First/, "restart drops old staged choice");
});

for (const editor of ["answer", "reply"]) test(`Escape releases the narrow-board ${editor} workspace so fleet navigation works immediately`, async () => {
  const controller = new SessionsController({ version: 1, sessions: [structuredClone(session), { ...session, id: "other", piSessionId: "pi-other" }] });
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 24, interactionTarget, initialViewState: { grouping: "stage" },
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [request], messageDelivery: "idle" }),
    submitAnswer: async () => { assert.fail("Escape must not answer"); }, sendMessage: async () => { assert.fail("Escape must not reply"); },
  });
  view.render(60); await view.refreshInteraction(); view.handleInput(editor === "answer" ? "\t" : "p"); view.render(60); view.handleInput("\x1b");
  view.handleInput("j");
  assert.equal(controller.selected()?.id, "other");
});

test("a fresh pending snapshot restores an unavailable staged form after visiting another answer", async () => {
  const controller = new SessionsController({ version: 1, sessions: [structuredClone(session), { ...session, id: "other", piSessionId: "pi-other" }] });
  let now = 0;
  let disconnected = false;
  let writes = 0;
  const view = new SessionsView(controller, () => {}, { terminalRows: () => 24, interactionTarget, now: () => now,
    loadInteractionState: async () => { if (disconnected) throw new Error("temporary disconnect"); return { answerChannel: "rpiv-events", questionProtocol: true, pending: [request] }; },
    submitAnswer: async () => { writes++; },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\t"); view.handleInput("2"); view.render(120);
  disconnected = true; now += 1000; await view.refreshInteraction(); view.handleInput("\x1b");
  disconnected = false; controller.selectSession("other"); view.render(120); await view.refreshInteraction(); view.handleInput("\t"); view.render(120); view.handleInput("\x1b");
  controller.selectSession("s"); view.render(120); await view.refreshInteraction(); view.handleInput("\t");
  assert.match(text(view), /▶ \[2\] Second/, "fresh availability keeps the exact staged choice");
  view.handleInput("\r"); await tick();
  assert.equal(writes, 1);
});

test("new toolCallId drops staged answers; native closure removes a focused form", async () => {
  let pending = [request];
  let now = 0;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 30, interactionTarget, now: () => now,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending }), submitAnswer: async () => { assert.fail("native closure must not submit"); },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("\t"); view.handleInput("2"); view.handleInput("\x1b");
  pending = [{ ...request, toolCallId: "next-call" }]; now += 1000; await view.refreshInteraction(); view.handleInput("\t");
  assert.match(text(view), /▶ \[1\] First/);
  pending = []; now += 1000; await view.refreshInteraction();
  assert.doesNotMatch(text(view), /\[1\] First/);
});

for (const width of [30, 80, 120]) test(`too-short answer panel opens Pi, not an invisible answer at ${width}`, async () => {
  const opened: string[] = [];
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 3, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: [request] }), submitAnswer: async () => { assert.fail("invisible answer submitted"); },
    acknowledgeSession: () => {}, attachOutsideTmux: tmux => { opened.push(tmux); }, switchInsideTmux: tmux => { opened.push(tmux); },
  });
  view.render(width); await view.refreshInteraction(); view.handleInput("\t");
  assert.match(text(view, width), /Open in Pi/);
  view.handleInput("\r"); await tick(); assert.deepEqual(opened, [session.tmuxSession]);
});

test("Accepted stays Accepted when activity bookkeeping fails; Conversation is read-only", async () => {
  let writes = 0;
  const view = new SessionsView(new SessionsController({ version: 1, sessions: [structuredClone(session)] }), () => {}, { terminalRows: () => 30, interactionTarget,
    loadInteractionState: async () => ({ answerChannel: "rpiv-events", questionProtocol: true, pending: writes ? [] : [request] }),
    loadConversation: async () => ({ branchId: "b", revision: "1", items: [{ id: "m", role: "assistant", text: "Completed history" }] }),
    submitAnswer: async () => { writes++; }, afterInteractionWrite: async () => { throw new Error("disk full"); },
  });
  view.render(120); await view.refreshInteraction(); view.handleInput("c"); await tick();
  assert.match(text(view), /Completed history/); assert.doesNotMatch(text(view), /ANSWER NEEDED|\[1\] First/);
  view.handleInput("\x1b"); view.handleInput("\t"); assert.match(text(view), /\[1\] First/);
  view.handleInput("\r"); await tick();
  assert.match(text(view), /Accepted · Answer sent/);
  assert.match(text(view), /activity update failed: disk full/);
});
