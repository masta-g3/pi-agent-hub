import test from "node:test";
import assert from "node:assert/strict";
import { appendChar, backspace, createForm, moveFocus, validateRequired, value } from "../src/tui/form.js";

test("generic form edits focused field and clears field errors", () => {
  const form = createForm([
    { key: "title", label: "title", value: "api", error: "title is required" },
  ]);

  const edited = appendChar(form, "x");

  assert.equal(value(edited, "title"), "apix");
  assert.equal(edited.fields.title.error, undefined);
});

test("generic form cycles focus and backspaces selected field", () => {
  const form = createForm([
    { key: "group", label: "group", value: "default" },
    { key: "title", label: "title", value: "api fork" },
  ]);

  const edited = backspace(moveFocus(form, 1));

  assert.equal(edited.focus, "title");
  assert.equal(value(edited, "group"), "default");
  assert.equal(value(edited, "title"), "api for");
});

test("validateRequired trims values and focuses first missing field", () => {
  const form = createForm<"group" | "title">([
    { key: "group", label: "group", value: "   " },
    { key: "title", label: "title", value: "  api fork  " },
  ], "title");

  const result = validateRequired(form, ["group", "title"]);

  assert.equal(result.ok, false);
  assert.equal(result.state.focus, "group");
  assert.equal(result.state.fields.group.error, "group is required");
  assert.equal(value(result.state, "title"), "api fork");
});
