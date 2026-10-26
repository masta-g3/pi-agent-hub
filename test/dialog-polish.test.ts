import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderForm } from "../src/tui/layout.js";
import { darkTheme, stripAnsi, styleToken } from "../src/tui/theme.js";
import { handleNewSessionInput, openNewSessionDialog, renderNewSessionDialog } from "../src/tui/new-session-dialog.js";
import { setRepoValue, toggleWorktree } from "../src/tui/new-form.js";
import type { NewSessionDialogContext } from "../src/tui/dialog.js";
import { createQuestionDialog, handleQuestionInput, renderQuestionDialog } from "../src/tui/question-dialog.js";

function newSessionContext(): NewSessionDialogContext {
  return { actions: { newFormContext: () => ({ cwd: "/code/web" }) }, viewport: { width: 100, height: 28 }, theme: darkTheme } as NewSessionDialogContext;
}

test("new-session primary action reflects existing form validation without moving focus", () => {
  const ctx = newSessionContext();
  const dialog = openNewSessionDialog(ctx);
  const enabled = renderNewSessionDialog(dialog, 100, ctx).join("\n");
  assert.ok(enabled.includes(styleToken(darkTheme, "accent", "[ Create session ]")));
  assert.ok(enabled.includes(styleToken(darkTheme, "muted", "Cancel")));
  for (const form of [setRepoValue(dialog.form, "repo:0", ""), toggleWorktree(dialog.form)]) {
    const invalid = renderNewSessionDialog({ ...dialog, form }, 100, ctx).join("\n");
    assert.ok(invalid.includes(styleToken(darkTheme, "muted", "[ Create session ]")));
    assert.ok(!invalid.includes(styleToken(darkTheme, "accent", "[ Create session ]")));
  }
  assert.equal(dialog.form.focus, "repo:0");
  assert.equal(dialog.form.fields["repo:0"].error, undefined);
});

test("shared form primary styling is opt-in and leaves focused actions unchanged", () => {
  const spec = { title: "Form", fields: [{ key: "name", label: "Name", value: "value" }, { key: "submit", label: "", value: "[ Submit ]", readonly: true }], focus: "name", footer: "Esc Cancel" };
  const ordinary = renderForm(spec, 80, darkTheme).join("\n");
  assert.ok(ordinary.includes(styleToken(darkTheme, "muted", "[ Submit ]")));
  const primary = { ...spec, fields: spec.fields.map(field => field.key === "submit" ? { ...field, primary: true } : field) };
  assert.equal(renderForm({ ...primary, focus: "submit" }, 80, darkTheme).join("\n"), renderForm({ ...spec, focus: "submit" }, 80, darkTheme).join("\n"));
});

test("new-session action heading aligns with labels and directory hints do not repeat", () => {
  const ctx = newSessionContext();
  for (const width of [80, 100, 160]) {
    const lines = renderNewSessionDialog(openNewSessionDialog(ctx), width, ctx).map(stripAnsi);
    const heading = lines.find(line => line.includes("Actions"))!;
    const field = lines.find(line => line.includes("Save favorite…"))!;
    assert.equal(heading.indexOf("Actions"), field.indexOf("Save favorite…"));
    const footer = lines.filter(line => line.includes("Enter Create"));
    assert.equal(footer.length, 1);
    assert.equal(footer[0]!.replace(/^[│ ]+|[│ ]+$/g, ""), "Enter Create · Ctrl+O Choose directory · Esc Cancel");
    assert.equal(lines.filter(line => line.includes("Ctrl+O")).length, 1);
    assert.ok(lines.some(line => line.includes("Project Skills/MCP use this directory")));
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
});

test("Ctrl+Y still creates from any new-session action", () => {
  const created: unknown[] = [];
  const ctx = { ...newSessionContext(), actions: { newFormContext: () => ({ cwd: "/code/web" }), createSession: (input: unknown) => { created.push(input); return "created"; } }, setMessage: () => {}, runAction: (fn: () => unknown) => fn() } as unknown as NewSessionDialogContext;
  assert.equal(handleNewSessionInput({ ...openNewSessionDialog(ctx), actionFocus: "cancel" }, "\x19", ctx), undefined);
  assert.equal(created.length, 1);
});

const target = { managedId: "m", piSessionId: "p", instanceId: "i" };
function questionDialog() {
  return createQuestionDialog(target, "Session", { toolCallId: "call", params: { questions: [{ question: "Which?", header: "Choice", options: [{ label: "First", description: "One" }, { label: "Second", description: "Two" }] }] } });
}

test("question card has one fitted hint line and only real status adds a row", () => {
  const allHints = ["Enter Send", "1–2 Choose", "t Type", "Tab Focus", "Esc Fleet", "PgUp/PgDn Read", "← Previous question"];
  for (const width of [40, 80, 160]) {
    const dialog = questionDialog();
    const lines = renderQuestionDialog(dialog, width, 20).map(stripAnsi);
    assert.equal(lines.length, 6, `no idle status row at ${width}`);
    const hint = lines.at(-1)!;
    const items = hint.split(" · ");
    assert.deepEqual(items, allHints.slice(0, items.length));
    assert.equal(lines.filter(line => /Enter Send|Tab Focus|Esc Fleet|PgUp\/PgDn Read/.test(line)).length, 1);
    assert.equal(dialog.rowTargets.length, lines.length);
    assert.deepEqual(dialog.rowTargets, [undefined, undefined, 0, 1, 2, "submit"]);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    dialog.error = "Try again";
    const errorLines = renderQuestionDialog(dialog, width, 20).map(stripAnsi);
    assert.equal(errorLines.length, lines.length + 1);
    assert.equal(errorLines.at(-2), "Try again");
    assert.deepEqual(dialog.rowTargets.slice(-2), [undefined, "submit"]);
    dialog.submitting = true;
    assert.equal(renderQuestionDialog(dialog, width, 20).map(stripAnsi).at(-2), "Submitting…");
    assert.equal(dialog.rowTargets.at(-1), undefined);
  }
});

test("custom answer keeps only the outer hint and unfocused question hints stay on one row", () => {
  for (const width of [40, 80, 160]) {
    const dialog = questionDialog();
    handleQuestionInput(dialog, "t");
    const lines = renderQuestionDialog(dialog, width, 30).map(stripAnsi);
    assert.equal(lines.filter(line => /Enter (Send|Next)|Esc (Fleet|Back)|Tab Focus/.test(line)).length, 1);
    assert.match(lines.at(-1)!, /^Enter Send · Editing answer/);
    const unfocused = renderQuestionDialog(questionDialog(), width, 20, undefined, false).map(stripAnsi);
    assert.match(unfocused.at(-1)!, /^Tab Answer · c Hide/);
    assert.equal(unfocused.filter(line => /Tab Answer|Esc Fleet|Tab Focus/.test(line)).length, 1);
  }
});
