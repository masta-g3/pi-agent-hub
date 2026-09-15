import assert from "node:assert/strict";
import test from "node:test";
import { createQuestionDialog, handleQuestionInput, renderQuestionDialog } from "../src/tui/question-dialog.js";
import type { PendingQuestion } from "../src/core/session-interaction.js";

const target = { managedId: "m", piSessionId: "p", instanceId: "i" };
const options = [{ label: "First", description: "First option" }, { label: "Second", description: "Second option" }];

test("every part of a long option description remains readable by scrolling", () => {
  const request: PendingQuestion = { toolCallId: "call", params: { questions: [{ question: "Which?", header: "Choice", options: [{ label: "Long choice", description: "Important detail. ".repeat(50) + "END_OF_DESCRIPTION" }, options[1]!] }] } };
  const dialog = createQuestionDialog(target, "Session", request);
  let seen = "";
  for (let i = 0; i < 30; i++) {
    seen += renderQuestionDialog(dialog, 60, 12).join("\n");
    handleQuestionInput(dialog, "\x1b[6~");
  }
  assert.match(seen, /END_OF_DESCRIPTION/);
});

test("back navigation restores selected answers without a review screen", () => {
  const request: PendingQuestion = { toolCallId: "call", params: { questions: [
    { question: "Which?", header: "Choice", options },
    { question: "Which checks?", header: "Checks", options, multiSelect: true },
  ] } };
  const dialog = createQuestionDialog(target, "Session", request);
  handleQuestionInput(dialog, "\x1b[B");
  handleQuestionInput(dialog, "\r");
  handleQuestionInput(dialog, " ");
  handleQuestionInput(dialog, "\x1b[B");
  handleQuestionInput(dialog, " ");
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.equal(dialog.page, 1);
  handleQuestionInput(dialog, "\x1b[D");
  assert.equal(dialog.choice, 1);
  handleQuestionInput(dialog, "\r");
  assert.deepEqual([...dialog.selected].sort(), [0, 1]);
});
