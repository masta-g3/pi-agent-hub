import test from "node:test";
import assert from "node:assert/strict";
import { formatQuestionText, createQuestionDialog, handleQuestionInput, renderQuestionPanel } from "../src/tui/question-dialog.js";
import type { PendingQuestion } from "../src/core/session-interaction.js";

const target = { managedId: "s", piSessionId: "pi", instanceId: "instance" };
const options = [{ label: "Keep it (Recommended)", description: "Keep the task visible." }, { label: "Other", description: "Tell me what to change." }];
const request: PendingQuestion = { toolCallId: "call", params: { questions: [{ header: "Scope", question: "Background here. Should we ship when: (1) tests pass; (2) both repos are clean? Show results before writing.", options }] } };

test("the screenshot question keeps all seven conditions and the dry-run promise", () => {
  const original = "Plan: agent-work/plans/costs-004.md. One change touches the shared logger: pi-logged would write a small 'llm-usage' marker entry into each automated session file when the session starts. This is the only reliable way to tell an automated session from an interactive one before its first database row exists. Is the plan 'done' when: (1) every interactive message from the last 90 days is exactly one row and re-runs add nothing; (2) no message is counted as both automated and interactive, and no existing row changes; (3) Claude interactive cost uses the same estimate as automated, Codex uses Pi's cost; (4) llmpedia_workflows sessions are skipped; (5) an hourly wf job imports new sessions; (6) /costs has a source filter [all] [automated] [interactive] that scopes everything, plus an automated/interactive split line; (7) tests pass in both repos? Before any write, I'll show you the dry-run per-project numbers.";
  const formatted = formatQuestionText(original);
  assert.equal(formatted.ask, "Is the plan 'done' when:");
  assert.equal(formatted.conditions.length, 7);
  assert.equal(formatted.conditions[6], "(7) tests pass in both repos?");
  assert.match(formatted.context, /Before any write, I'll show you the dry-run per-project numbers\./);
  assert.equal(formatted.original, original);
});

test("question structure preserves the ask, conditions and all folded context", () => {
  assert.deepEqual(formatQuestionText(request.params.questions[0]!.question), {
    ask: "Should we ship when:", conditions: ["(1) tests pass;", "(2) both repos are clean?"],
    context: "Background here. Show results before writing.", original: request.params.questions[0]!.question,
  });
  const long = "Should we " + "keep every word ".repeat(200) + "?";
  assert.equal(formatQuestionText(long).ask, long);
  assert.equal(formatQuestionText("First question? Some context. Last question?").ask, "Last question?");
  assert.equal(formatQuestionText("Should the subtitle stay above the request?").context, "");
  for (const original of ["No question here.", 'Read "which?" before answering. Ship now?', "Read `file?name` then ship?", "Read https://example.com/?q=x then ship?", "(1) Keep the condition. Shall we ship?"]) {
    assert.deepEqual(formatQuestionText(original), { ask: original, conditions: [], context: "", original });
  }
});

test("ambiguous abbreviations, parentheses and quoted punctuation keep the decision as written", () => {
  for (const original of [
    "May I delete the backup in the U.S. region?",
    "Should Dr. Smith approve deletion?",
    "Should the backup (e.g. the old copy) be deleted?",
    "Should we use the first option (keep it. No writes) or the second?",
    'Should we keep the "Done. Pending" labels?',
    "Should we keep the 'Done. Pending' labels?",
    "Should we keep the `Done. Pending` labels?",
  ]) assert.deepEqual(formatQuestionText(original), { ask: original, conditions: [], context: "", original });
});

test("C/O are local display toggles and never mutate the official answer", () => {
  const dialog = createQuestionDialog(target, "Card", request);
  const text = () => renderQuestionPanel(dialog, 120).body.join("\n");
  assert.ok(text().indexOf("Should we ship") < text().indexOf("(1) tests"));
  assert.doesNotMatch(text(), /Background here/); assert.match(text(), /C Context ▸/);
  handleQuestionInput(dialog, "C"); assert.match(text(), /Background here/);
  handleQuestionInput(dialog, "O"); assert.ok(text().includes(request.params.questions[0]!.question));
  assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers, [{ questionIndex: 0, kind: "option", optionIndex: 0 }]);
});

test("tiles use key caps and only explicit standalone markers become badges", () => {
  const dialog = createQuestionDialog(target, "Card", { ...request, params: { questions: [{ header: "Scope", question: "Ship?", options: [
    { label: "The best", description: "NotRecommended" }, { label: "Keep (rEcOmMeNdEd)", description: "Reason [Recommended]" },
    { label: "x(Recommended)y", description: "No marker" },
  ] }] } });
  let panel = renderQuestionPanel(dialog, 120);
  assert.match(panel.body.join("\n"), /▶ \[1\] The best/);
  assert.equal(panel.body.join("\n").match(/\[Recommended\]/g)?.length, 1);
  assert.match(panel.body.join("\n"), /x\(Recommended\)y/);
  assert.ok(panel.focusRows?.length);
  assert.match(panel.body.join("\n"), /No marker/);
  panel = renderQuestionPanel(dialog, 80);
  assert.doesNotMatch(panel.body.join("\n"), /No marker/);
  handleQuestionInput(dialog, "2"); assert.match(renderQuestionPanel(dialog, 80).body.join("\n"), /Reason/);
});

test("catch-all co-location follows the exact allowlist and retains both routes", () => {
  const cases: [Partial<PendingQuestion["params"]["questions"][number]>, boolean][] = [
    [{}, true], [{ options: [options[0]!, { label: " OTHER. ", description: "" }] }, true],
    [{ options: [options[0]!, { label: "Tell me what to change", description: "" }] }, true],
    [{ multiSelect: true }, false], [{ options: [options[0]!, { label: "Other", description: "Keep both adapters" }] }, false],
    [{ options: [options[0]!, { label: "Other (Recommended)", description: "" }] }, false],
    [{ options: [options[0]!, { label: "Other", description: "", hasPreview: false }] }, true],
    [{ options: [options[0]!, { label: "Other", description: "", preview: "" }] }, true],
    [{ options: [options[0]!, { label: "Other", description: "", hasPreview: true }] }, false],
    [{ options: [options[0]!, { label: "Other", description: "", hasPreview: false, preview: "Real preview" }] }, false],
    [{ options: [{ label: "Other", description: "" }, { label: "Other", description: "" }] }, false],
    [{ options: [{ label: "Other", description: "" }, options[0]!] }, false],
    [{ options: [options[0]!, { label: "Change the migration order", description: "Run primary last" }] }, false],
  ];
  for (const [change, colocate] of cases) {
    const pending = { ...request, params: { questions: [{ ...request.params.questions[0]!, ...change }] } };
    const dialog = createQuestionDialog(target, "Card", pending);
    const panel = renderQuestionPanel(dialog, 120);
    assert.equal(panel.body.some(row => typeof row === "string" && row.includes("[2]") && row.includes("[3/t] Type something.")), colocate, JSON.stringify(change));
  }
  const dialog = createQuestionDialog(target, "Card", request);
  handleQuestionInput(dialog, "2"); assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "option", optionIndex: 1 });
  handleQuestionInput(dialog, "3"); handleQuestionInput(dialog, "custom"); assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "custom", text: "custom" });
});

test("stock-shaped screenshot catch-all co-locates without changing either answer route", () => {
  const pending: PendingQuestion = { toolCallId: "stock", params: { questions: [{ header: "Scope", question: "Is the plan done?", options: [
    { label: "Approve, including the marker (Recommended)", description: "Keep the marker.", hasPreview: false },
    { label: "Approve, but no change to pi-logged", description: "Keep the logger unchanged.", hasPreview: false },
    { label: "Change something first", description: "Tell me what to change.", hasPreview: false },
  ] }] } };
  for (const preview of [undefined, ""]) {
    pending.params.questions[0]!.options[2]!.preview = preview;
    const dialog = createQuestionDialog(target, "Card", pending);
    const panel = renderQuestionPanel(dialog, 120);
    assert.ok(panel.body.some(row => typeof row === "string" && row.includes("[3] Change something first") && row.includes("[4/t] Type something.")));
    handleQuestionInput(dialog, "3"); assert.equal(handleQuestionInput(dialog, "\r"), "submit");
    assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "option", optionIndex: 2 });
    handleQuestionInput(dialog, "4"); handleQuestionInput(dialog, "Change the validation order");
    assert.equal(handleQuestionInput(dialog, "\r"), "submit");
    assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "custom", text: "Change the validation order" });
  }
});

test("saving a multi-select note alone does not complete the question", () => {
  const dialog = createQuestionDialog(target, "Card", { ...request, params: { questions: [{ ...request.params.questions[0]!, multiSelect: true }] } });
  handleQuestionInput(dialog, "n"); handleQuestionInput(dialog, "Only a note"); handleQuestionInput(dialog, "\r");
  assert.equal(dialog.answers.length, 0);
  handleQuestionInput(dialog, "1"); assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers[0], { questionIndex: 0, kind: "multi", optionIndices: [0], notes: "Only a note" });
});

test("per-question notes survive pages and Escape without answering or consuming literal keys", () => {
  const dialog = createQuestionDialog(target, "Card", { ...request, params: { questions: [request.params.questions[0]!, request.params.questions[0]!] } });
  handleQuestionInput(dialog, "n"); handleQuestionInput(dialog, "nCO literal"); handleQuestionInput(dialog, "\x1b");
  assert.equal(dialog.answers.length, 0);
  assert.match(renderQuestionPanel(dialog, 120).body.join("\n"), /✎ nCO literal/);
  handleQuestionInput(dialog, "\x1b[C"); handleQuestionInput(dialog, "n"); handleQuestionInput(dialog, "Second note"); handleQuestionInput(dialog, "\r");
  handleQuestionInput(dialog, "\x1b[D"); assert.match(renderQuestionPanel(dialog, 120).body.join("\n"), /✎ nCO literal/);
  handleQuestionInput(dialog, "\r"); assert.equal(handleQuestionInput(dialog, "\r"), "submit");
  assert.deepEqual(dialog.answers.map(answer => answer.notes), ["nCO literal", "Second note"]);
});
